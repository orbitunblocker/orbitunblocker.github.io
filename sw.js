importScripts('./uv/uv.bundle.js');
importScripts('./uv/uv.config.js');
importScripts('./uv/uv.sw.js');

const _B = (msg, ...rest) => console.log('[BOOT-SW]', msg, 'at', Date.now(), ...rest);
const _FETCH_LOG = (url, portStatus, responseStatus, reason, ...rest) => console.log('[SW-FETCH] url:', url, 'portStatus:', portStatus, 'responseStatus:', responseStatus, 'reason:', reason, 'at', Date.now(), ...rest);
const _HOP = (hop, url, status, detail) => console.log('[HOP] hop:', hop, 'status:', status, 'url:', url, 'detail:', detail, 'at', Date.now());
_B('SW script evaluated');

// Helper to decode UV-proxied URLs back to original target URLs
function _DECODE_UV_URL(encodedUrl) {
  try {
    const prefix = '/service/';
    const idx = encodedUrl.indexOf(prefix);
    if (idx === -1) return { encoded: encodedUrl, decoded: encodedUrl };
    const svcPath = encodedUrl.substring(idx);
    const uv = new self.Ultraviolet(__uv$config);
    const decoded = uv.sourceUrl(svcPath);
    return { encoded: encodedUrl, decoded: decoded };
  } catch(e) {
    return { encoded: encodedUrl, decoded: '[DECODE-FAIL] ' + e.message };
  }
}

// Helper: safely stringify an unknown error for logging
function _SAFE_ERR(e) {
  if (e === undefined || e === null) return String(e);
  if (typeof e === 'object' && e.message) return e.message;
  return String(e);
}

// ============================================================
// PORT STATE — single source of truth, owned by SW
// Roles: SW = routing only, Page = initialization only, Worker = transport only
// ============================================================
const _portStateData = {
  status: 'none',       // 'none' | 'pending' | 'ready' | 'failed'
  port: null,           // the SharedWorker MessagePort (set only when ready)
  lastPingOK: 0,
  lastPingFail: 0,
  reinitCount: 0
};
const portState = new Proxy(_portStateData, {
  set(target, prop, value) {
    if (prop === 'status' || prop === 'port' || prop === 'reinitCount') {
      const oldVal = target[prop];
      const displayOld = prop === 'port' ? (oldVal ? '[MessagePort]' : 'null') : oldVal;
      const displayNew = prop === 'port' ? (value ? '[MessagePort]' : 'null') : value;
      const stack = (new Error()).stack || '';
      const frames = stack.split('\n').slice(2, 5).map(s => s.trim()).join(' → ');
      console.log('[PORT_STATE_CHANGE] field:', prop, 'oldValue:', displayOld, 'newValue:', displayNew, 'source:', frames, 'at', Date.now());
    }
    target[prop] = value;
    return true;
  }
});

// Ping the SharedWorker to verify port is alive at initialization time.
// NOT called during request handling.
async function checkPortHealth(timeoutMs = 1000, updateState = true) {
  _B('[CPH] enter at', Date.now(), 'port:', !!portState.port, 'timeoutMs:', timeoutMs, 'updateState:', updateState);
  if (!portState.port) { _B('[CPH] no port, returning false'); return false; }
  try {
    const channel = new MessageChannel();
    _B('[CPH] ping START at', Date.now(), 'to port type:', typeof portState.port, 'isMessagePort:', portState.port instanceof MessagePort);
    const pong = await Promise.race([
      new Promise(resolve => {
        channel.port1.onmessage = e => {
          channel.port1.close();
          resolve(e.data && e.data.type === 'pong');
        };
        portState.port.postMessage(
          { message: { type: 'ping' }, port: channel.port2 },
          [channel.port2]
        );
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('ping timeout')), timeoutMs))
    ]);
    if (pong) {
      portState.lastPingOK = Date.now();
      portState.status = 'ready';
      _B('[CPH] pong SUCCESS at', portState.lastPingOK, 'stack:', new Error().stack);
      return true;
    }
  } catch (e) { _B('[CPH] catch at', Date.now(), 'message:', e.message, 'stack:', e.stack); }
  portState.lastPingFail = Date.now();
  if (updateState) {
    portState.status = 'failed';
    _B('[CPH] TIMEOUT/FAIL — setting status=failed at', portState.lastPingFail, 'pingOK:', portState.lastPingOK, 'stack:', new Error().stack);
  } else {
    _B('[CPH] TIMEOUT/FAIL — state unchanged at', portState.lastPingFail, 'pingOK:', portState.lastPingOK);
  }
  return false;
}

// Track port acquisition from a BareClient instance.
// Called at init time after constructing BareClient.
function trackPort(client) {
  // UVServiceWorker stores BareClient at .bareClient, not .worker
  const bc = client && client.bareClient;
  if (!bc || !bc.worker) { _B('[TRACKPORT] no bc/worker at', Date.now()); return; }
  const p = bc.worker.port;
  _B('[TRACKPORT] port type:', typeof p, 'isPromise:', p instanceof Promise, 'at', Date.now());
  if (p instanceof Promise) {
    portState.status = 'pending';
    _B('[STATE] portState.status → pending (trackPort) at', Date.now(), 'stack:', new Error().stack);
    _B('[TRACKPORT] PROMISE CREATED at', Date.now());
    p.then(async (port) => {
      _B('[TRACKPORT] PROMISE RESOLVED at', Date.now(), 'port type:', typeof port, 'isMessagePort:', port instanceof MessagePort);
      portState.port = port;
      await checkPortHealth();
      _B('port acquired, status:', portState.status);
      broadcastState('trackPort-health-check');
    }).catch(err => {
      portState.status = 'failed';
      _B('[TRACKPORT] PROMISE REJECTED at', Date.now());
      _B('[TRACKPORT] rejection object type:', typeof err, 'constructor:', err && err.constructor.name);
      _B('[TRACKPORT] rejection message:', err && err.message);
      _B('[TRACKPORT] rejection stack:', err && err.stack);
      _B('[STATE] portState.status → failed (trackPort catch) at', Date.now(), 'stack:', new Error().stack);
      broadcastState('trackPort-failure');
    });
  } else {
    portState.port = p;
    portState.status = 'ready';
    _B('[TRACKPORT] direct port, status=ready at', Date.now(), 'port type:', typeof p);
    broadcastState('trackPort-direct');
  }
}

// Force re-initialization: create a fresh BareClient.
// Only called from init context (activate failure recovery, page message).
// NEVER from request handling.
async function reinitPort() {
  portState.reinitCount++;
  _B('[REINIT] reinitPort #' + portState.reinitCount + ' at', Date.now(), 'stack:', new Error().stack);
  portState.status = 'pending';
  _B('[STATE] portState.status → pending (reinitPort #' + portState.reinitCount + ') at', Date.now());
  portState.port = null;
  const bc = sw.bareClient;
  if (bc && bc.worker) {
    const p = bc.worker.port;
    _B('[REINIT] port type:', typeof p, 'isPromise:', p instanceof Promise);
    if (p instanceof Promise) {
      _B('[REINIT] PROMISE CREATED at', Date.now());
      p.then(async (port) => {
        _B('[REINIT] PROMISE RESOLVED at', Date.now(), 'port type:', typeof port, 'isMessagePort:', port instanceof MessagePort);
        portState.port = port;
        await checkPortHealth();
        _B('[REINIT] SUCCESS, status:', portState.status);
        broadcastState('reinitPort-health-check');
      }).catch(err => {
        portState.status = 'failed';
        _B('[REINIT] PROMISE REJECTED at', Date.now());
        _B('[REINIT] rejection type:', typeof err, 'constructor:', err && err.constructor.name);
        _B('[REINIT] rejection message:', err && err.message);
        _B('[REINIT] rejection stack:', err && err.stack);
        _B('[STATE] portState.status → failed (reinitPort catch) at', Date.now(), 'stack:', new Error().stack);
        broadcastState('reinitPort-failure');
      });
    } else {
      portState.port = p;
      portState.status = 'ready';
      _B('[REINIT] direct port, status=ready at', Date.now(), 'port type:', typeof p);
      broadcastState('reinitPort-direct');
    }
  } else {
    portState.status = 'failed';
    _B('[REINIT] FAILED: no BareClient worker at', Date.now(), 'bc:', !!bc, 'bc.worker:', bc && !!bc.worker);
    _B('[STATE] portState.status → failed (reinitPort no worker) at', Date.now(), 'stack:', new Error().stack);
    broadcastState('reinitPort-no-worker');
  }
  return portState;
}

// Broadcast current port state to all window clients.
function broadcastState(source) {
  const src = source || 'unknown';
  _B('[PORT_STATE_BROADCAST] source:', src, 'status:', portState.status, 'portReady:', portState.status === 'ready', 'reinitCount:', portState.reinitCount, 'at', Date.now());
  self.clients.matchAll().then(clients => {
    for (const c of clients) {
      c.postMessage({
        type: 'PORT_STATE_SYNC',
        portReady: portState.status === 'ready',
        bareMuxReady: portState.status === 'ready',
        status: portState.status,
        reinitCount: portState.reinitCount,
        lastPingOK: portState.lastPingOK,
        lastPingFail: portState.lastPingFail
      });
    }
  });
}

// Wrap UVServiceWorker.prototype.fetch for HOP 2 (entry) and HOP 5 (exit) tracing
const _origUVProtoFetch = UVServiceWorker.prototype.fetch;
UVServiceWorker.prototype.fetch = async function(event) {
  const url = event.request.url;
  const dest = event.request.destination;
  const dec = _DECODE_UV_URL(url);
  _HOP('2-uv-fetch-entry', url, 0, 'dest:' + dest + ' decoded:' + dec.decoded);
  try {
    const resp = await _origUVProtoFetch.call(this, event);
    _HOP('5-uv-fetch-exit', url, resp.status, 'dest:' + dest);
    return resp;
  } catch(e) {
    _HOP('5-uv-fetch-exit', url, 0, 'threw:' + e.message + ' dest:' + dest);
    throw e;
  }
};
_B('UVServiceWorker.prototype.fetch wrapped for HOP tracing');

// ============================================================
// UV INSTANCE
// ============================================================
const sw = new UVServiceWorker();
_B('UVServiceWorker constructed');

// Track port acquisition via UV's internal yn() mechanism.
// yn() sends getPort to the page, the page creates the SharedWorker and
// transfers the port back. trackPort hooks into the Promise resolution.
trackPort(sw);
_B('trackPort attached to UV BareClient');

// Wrap bareClient.fetch for per-hop tracing (HOP 3: before bare fetch, HOP 4: after bare fetch)
function wrapBareClient(bc) {
  if (!bc || bc.__hop_traced) return;
  const origFetch = bc.fetch.bind(bc);
  bc.fetch = async function(url, options) {
    const bodyType = url.body ? typeof url.body : (options?.body ? typeof options.body : 'no-body');
    _HOP('3-bareClient-fetch', url, 0, 'method:' + (options?.method || 'GET') + ' body:' + bodyType);
    try {
      const resp = await origFetch(url, options);
      _HOP('4-bareClient-response', url, resp.status, 'ok:' + resp.ok);
      return resp;
    } catch(e) {
      const safeMsg = e === undefined ? 'undefined' : (e === null ? 'null' : (typeof e === 'object' && e.message ? e.message : String(e)));
      const stack = e && e.stack ? (e.stack.split('\n').slice(0, 3).join(' | ')) : 'no-stack';
      _HOP('4-bareClient-response', url, 0, 'threw:' + safeMsg + ' typeof:' + (typeof e) + ' stack:' + stack);
      throw e;
    }
  };
  bc.__hop_traced = true;
  _B('bareClient.fetch wrapped for HOP tracing');
}
wrapBareClient(sw.bareClient);

// Wrap Dn.sendMessage to trace body transfer at SharedWorker boundary
(function wrapDnSendMessage() {
  try {
    const dnProto = sw.bareClient && sw.bareClient.worker && Object.getPrototypeOf(sw.bareClient.worker);
    if (!dnProto || typeof dnProto.sendMessage !== 'function') {
      _B('Dn.sendMessage wrap FAILED - cannot find prototype');
      return;
    }
    const origSend = dnProto.sendMessage;
    dnProto.sendMessage = async function(msg, transferables) {
      const fetchInfo = msg && msg.fetch;
      const bodyRaw = fetchInfo && fetchInfo.body;
      const method = fetchInfo && fetchInfo.method || 'unknown';
      const url = fetchInfo && fetchInfo.remote || 'unknown';
      const bodyType = bodyRaw === undefined ? 'undefined' : (bodyRaw === null ? 'null' : typeof bodyRaw);
      const isRS = bodyRaw instanceof ReadableStream;
      const isAB = bodyRaw instanceof ArrayBuffer;
      const bodyConstructor = bodyRaw === undefined ? 'undefined' : (bodyRaw === null ? 'null' : bodyRaw.constructor.name);
      let bodyByteLen = 'N/A';
      if (bodyRaw instanceof ArrayBuffer) bodyByteLen = bodyRaw.byteLength;
      else if (bodyRaw instanceof Blob) bodyByteLen = bodyRaw.size;
      else if (typeof bodyRaw === 'string') bodyByteLen = bodyRaw.length;
      else if (bodyRaw instanceof ReadableStream) bodyByteLen = 'ReadableStream(unread)';
      const transferType = transferables ? (Array.isArray(transferables) ? transferables.map(t => t instanceof ReadableStream ? 'RS' : t instanceof ArrayBuffer ? 'AB' : t instanceof MessagePort ? 'MP' : typeof t).join(',') : typeof transferables) : 'none';
      _B('[DN-SEND] msg type:', msg && msg.type, 'method:', method, 'url:', url, 'bodyConstructor:', bodyConstructor, 'bodyByteLen:', bodyByteLen, 'isRS:', isRS, 'isAB:', isAB, 'transferables:', transferType, 'transferLen:', transferables ? (Array.isArray(transferables) ? transferables.length : 1) : 0);
      try {
        const result = await origSend.call(this, msg, transferables);
        _B('[DN-SEND] RESOLVED method:', method, 'url:', url);
        return result;
      } catch(e) {
        const safeMsg = e === undefined ? 'undefined' : (e === null ? 'null' : (typeof e === 'object' && e.message ? e.message : String(e)));
        const stack = e && e.stack ? e.stack.split('\n').slice(0, 5).join(' | ') : 'no-stack';
        const eConstr = e && e.constructor ? e.constructor.name : (e === undefined ? 'undefined' : (e === null ? 'null' : typeof e));
        _B('[DN-SEND] REJECTED method:', method, 'url:', url, 'errorConstructor:', eConstr, 'error:', safeMsg, 'typeof:', typeof e, 'stack:', stack);
        throw e;
      }
    };
    _B('Dn.sendMessage wrapped for tracing');
  } catch(e) {
    _B('Dn.sendMessage wrap threw:', e.message);
  }
})();

const _origFetch = sw.fetch.bind(sw);
sw.fetch = async function (event) {
  const url = event.request.url;
  const dest = event.request.destination;
  const ct = event.request.headers.get('content-type');
  const direct = event.request.headers.get('X-SW-Direct');
  const dec = _DECODE_UV_URL(url);
  _HOP('1-sw-wrapper', url, 0, 'dest:' + dest + ' decoded:' + dec.decoded);
  if (portState.status !== 'ready') {
    _FETCH_LOG(url, portState.status, 503, 'port-not-ready', 'dest:', dest);
    _HOP('1-sw-wrapper', url, 503, 'port-not-ready dest:' + dest + ' decoded:' + dec.decoded);
    return new Response(null, { status: 503, statusText: 'Service Unavailable' });
  }
  try {
    const resp = await _origFetch(event);
    const is503 = resp.status === 503;
    _FETCH_LOG(url, portState.status, is503 ? 503 : resp.status, is503 ? 'origFetch-returned-503' : 'origFetch-ok', 'dest:', dest, 'decoded:', dec.decoded);
    _HOP('6-sw-wrapper-response', url, resp.status, 'dest:' + dest + ' decoded:' + dec.decoded);
    if (resp.status >= 400) {
      _HOP('FAIL', url, resp.status, 'dest:' + dest + ' decoded:' + dec.decoded);
    }
    return resp;
  } catch (err) {
    _FETCH_LOG(url, portState.status, 503, 'origFetch-threw', 'message:', err.message, 'dest:', dest, 'decoded:', dec.decoded);
    _HOP('6-sw-wrapper-response', url, 503, 'threw:' + err.message + ' dest:' + dest + ' decoded:' + dec.decoded);
    return new Response(null, { status: 503, statusText: 'Service Unavailable' });
  }
};

// ============================================================
// LIFECYCLE
// ============================================================
self.addEventListener('install', (e) => {
  _B('install event');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  _B('activate event');
  event.waitUntil(
    self.clients.claim().then(async () => {
      _B('clients claimed');
      // Re-validate port health at activate time (init scope, not request scope)
      if (portState.port) {
        await checkPortHealth();
        _B('activate health check, status:', portState.status);
      }
      broadcastState('activate');
    })
  );
});

// ============================================================
// MESSAGE HANDLER — SYNC_PORT_STATE from page (manual trigger)
// ============================================================
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'SYNC_PORT_STATE') {
    _B('SYNC_PORT_STATE received from page');
    // Build response — reply through transferred MessageChannel port if available
    const _replyState = () => {
      const resp = {
        type: 'PORT_STATE_SYNC',
        portReady: portState.status === 'ready',
        bareMuxReady: portState.status === 'ready',
        status: portState.status,
        reinitCount: portState.reinitCount,
        lastPingOK: portState.lastPingOK,
        lastPingFail: portState.lastPingFail
      };
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage(resp);
      } else {
        event.source.postMessage(resp);
      }
    };
    if (msg.checkHealth && portState.port) {
      const wasReady = portState.status === 'ready';
      _B('[SYNC] checkHealth starting, wasReady:', wasReady, 'at', Date.now());
      checkPortHealth(1000, false).then(async (isHealthy) => {
        if (isHealthy) {
          portState.status = 'ready';
          _B('[STATE] portState.status → ready (SYNC_PORT_STATE health check) at', Date.now(), 'stack:', new Error().stack);
          _replyState();
          broadcastState('sync-port-state');
        } else if (wasReady) {
          _B('[SYNC] stale port detected at', Date.now(), 'triggering proactive refresh', 'stack:', new Error().stack);
          try {
            const bc = new BroadcastChannel('bare-mux');
            bc.postMessage({ type: 'refreshPort' });
            bc.close();
          } catch(e) {
            _B('[SYNC] BroadcastChannel refreshPort failed:', e.message);
          }
          const bm = sw.bareClient;
          if (bm && bm.worker && bm.worker.port instanceof Promise) {
            try {
              const newPort = await bm.worker.port;
              portState.port = newPort;
              _B('[SYNC] new port received from refresh at', Date.now(), 'validating');
              await checkPortHealth();
            } catch(err) {
              portState.status = 'failed';
              _B('[STATE] portState.status → failed (SYNC refresh acquisition) at', Date.now(), 'err:', err.message, 'stack:', new Error().stack);
            }
          } else {
            portState.status = 'failed';
            _B('[STATE] portState.status → failed (SYNC no worker promise) at', Date.now(), 'stack:', new Error().stack);
          }
          _replyState();
          broadcastState('sync-port-state');
        } else {
          portState.status = 'failed';
          _B('[STATE] portState.status → failed (SYNC not healthy and not ready) at', Date.now(), 'stack:', new Error().stack);
          _replyState();
          broadcastState('sync-port-state');
        }
      });
      return;
    }
    _replyState();
    return;
  }

  if (msg.type === 'GET_DIAG') {
    _B('GET_DIAG received');
    try {
      const diag = {
        type: 'DIAG_RESPONSE',
        portState: { status: portState.status, lastPingOK: portState.lastPingOK, lastPingFail: portState.lastPingFail, reinitCount: portState.reinitCount },
        hasBareClient: !!sw.bareClient,
        hasWorker: !!(sw.bareClient && sw.bareClient.worker),
        workerPortType: sw.bareClient && sw.bareClient.worker ? typeof sw.bareClient.worker.port : 'no worker',
        isPromise: sw.bareClient && sw.bareClient.worker ? (sw.bareClient.worker.port instanceof Promise) : false,
        swExists: typeof sw !== 'undefined',
      };
      _B('GET_DIAG response:', JSON.stringify(diag));
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage(diag);
      } else {
        event.source.postMessage(diag);
      }
    } catch (e) {
      _B('GET_DIAG error:', e.message);
      const errResp = { type: 'DIAG_RESPONSE', error: e.message };
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage(errResp);
      } else {
        event.source.postMessage(errResp);
      }
    }
    return;
  }

  if (msg.type === 'REINIT_PORT') {
    _B('REINIT_PORT received from page');
    reinitPort().then(() => {
      event.source.postMessage({
        type: 'PORT_STATE_SYNC',
        portReady: portState.status === 'ready',
        bareMuxReady: portState.status === 'ready',
        status: portState.status,
        reinitCount: portState.reinitCount
      });
    });
    return;
  }
});

// ============================================================
// FETCH HANDLER
// ============================================================
let fetchCount = 0;
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const isService = url.pathname.startsWith('/service/');
  fetchCount++;
  _B('fetch #' + fetchCount + ':', url.pathname, isService ? '/service/* ROUTE' : 'static route (bypassed)');
  if (!isService) return;
  _B('[TRACE] UV_PROXY_ACTIVE — intercepting:', url.pathname);
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('UV proxy timeout')), 5000)
  );
  event.respondWith(
    Promise.race([sw.fetch(event), timeout]).then((resp) => {
      return resp;
    }).catch((err) => {
      _FETCH_LOG(event.request.url, portState.status, 503, 'timeout-or-race-rejection', 'err:', err.message);
      return new Response(null, { status: 503, statusText: 'Service Unavailable' });
    })
  );
});
