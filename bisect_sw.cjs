const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');

const SW_REDUCED = (additional) => `importScripts('./uv/uv.bundle.js');
importScripts('./uv/uv.config.js');
importScripts('./uv/uv.sw.js');

const _B = (msg, ...rest) => console.log('[BOOT-SW]', msg, 'at', Date.now(), ...rest);
_B('SW starting');

const portState = { port: null, status: 'pending', reinitCount: 0, lastPingOK: 0, lastPingFail: 0 };

function trackPort(client) {
  const bc = client && client.bareClient;
  if (!bc || !bc.worker) { _B('[TRACKPORT] no bc/worker'); return; }
  const p = bc.worker.port;
  _B('[TRACKPORT] port type:', typeof p, 'isPromise:', p instanceof Promise);
  if (p instanceof Promise) {
    portState.status = 'pending';
    p.then(async (port) => {
      _B('[TRACKPORT] PROMISE RESOLVED');
      portState.port = port;
      portState.status = 'ready';
    }).catch(err => {
      portState.status = 'failed';
      _B('[TRACKPORT] PROMISE REJECTED:', err && err.message);
    });
  } else {
    portState.port = p;
    portState.status = 'ready';
    _B('[TRACKPORT] direct port, status=ready');
  }
}
function broadcastState(source) {
  _B('[BROADCAST] source:', source, 'status:', portState.status);
  self.clients.matchAll().then(clients => {
    for (const c of clients) {
      c.postMessage({
        type: 'PORT_STATE_SYNC',
        portReady: portState.status === 'ready',
        status: portState.status,
      });
    }
  });
}

${additional}

const sw = new UVServiceWorker();
_B('UVServiceWorker constructed');
trackPort(sw);
_B('trackPort done');
`;

// Different versions to test
const VERSIONS = [
  { name: 'fetch-wrap only', code: `const _origUVProtoFetch = UVServiceWorker.prototype.fetch;
UVServiceWorker.prototype.fetch = async function(event) {
  _B('[FETCH-WRAP] fetch:', event.request.url);
  return _origUVProtoFetch.call(this, event);
};
_B('fetch wrap done');` },
  { name: 'fetch-wrap + install/activate', code: `const _origUVProtoFetch = UVServiceWorker.prototype.fetch;
UVServiceWorker.prototype.fetch = async function(event) {
  return _origUVProtoFetch.call(this, event);
};
self.addEventListener('install', (e) => { _B('install'); self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  _B('activate');
  event.waitUntil(
    self.clients.claim().then(async () => {
      _B('clients claimed');
      broadcastState('activate');
    })
  );
});
_B('handlers registered');` },
  { name: 'with message handler (SYNC_PORT_STATE + GET_DIAG)', code: `self.addEventListener('install', (e) => { _B('install'); self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  _B('activate');
  event.waitUntil(self.clients.claim().then(() => { broadcastState('activate'); }));
});

// Message handler
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;
  if (msg.type === 'SYNC_PORT_STATE') {
    const _replyState = () => {
      const resp = { type: 'PORT_STATE_SYNC', portReady: portState.status === 'ready', status: portState.status };
      if (event.ports && event.ports[0]) event.ports[0].postMessage(resp);
      else event.source.postMessage(resp);
    };
    _replyState();
    return;
  }
  if (msg.type === 'GET_DIAG') {
    const diag = { type: 'DIAG_RESPONSE', portState: { status: portState.status } };
    if (event.ports && event.ports[0]) event.ports[0].postMessage(diag);
    else event.source.postMessage(diag);
    return;
  }
});
_B('message handler registered');` },
  { name: 'with DIAG functions', code: `self.__SW_DIAG__ = [];
function _DIAG(context, msg, extra) {
  const entry = { t: Date.now(), context, msg, extra: extra || null };
  self.__SW_DIAG__.push(entry);
  console.log('[' + context + ']', msg, extra ? JSON.stringify(extra) : '', 'at', entry.t);
}
let _ORIG_DN_PORT_PROMISE = null;
function _CAPTURE_DN_PORT(dnInstance) {
  if (dnInstance && dnInstance.port) {
    _ORIG_DN_PORT_PROMISE = dnInstance.port;
    _DIAG('DN-PORT', 'captured original Dn.port', {});
  }
}
function _IS_SAME_PORT(dnInstance) {
  return dnInstance && dnInstance.port === _ORIG_DN_PORT_PROMISE;
}
function _PORT_ID(dnInstance) {
  if (!dnInstance || !dnInstance.port) return 'null';
  if (dnInstance.port === _ORIG_DN_PORT_PROMISE) return 'ORIGINAL-REJECTED';
  if (dnInstance.port instanceof Promise) return 'NEW-PROMISE';
  return typeof dnInstance.port;
}

self.addEventListener('install', (e) => { _B('install'); self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  _B('activate');
  event.waitUntil(self.clients.claim().then(() => { broadcastState('activate'); }));
});
self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;
  if (msg.type === 'SYNC_PORT_STATE') {
    const _replyState = () => {
      const resp = { type: 'PORT_STATE_SYNC', portReady: portState.status === 'ready', status: portState.status };
      if (event.ports && event.ports[0]) event.ports[0].postMessage(resp);
      else event.source.postMessage(resp);
    };
    _replyState();
    return;
  }
  if (msg.type === 'GET_DIAG') {
    try {
      const worker = sw.bareClient && sw.bareClient.worker;
      const diag = { type: 'DIAG_RESPONSE', portState: { status: portState.status, portIsNull: portState.port === null }, portIdentity: worker ? _PORT_ID(worker) : null, diagLog: (self.__SW_DIAG__ || []).slice(-100) };
      if (event.ports && event.ports[0]) event.ports[0].postMessage(diag);
      else event.source.postMessage(diag);
    } catch(e) {
      if (event.ports && event.ports[0]) event.ports[0].postMessage({ type: 'DIAG_RESPONSE', error: e.message });
      else event.source.postMessage({ type: 'DIAG_RESPONSE', error: e.message });
    }
    return;
  }
});
_B('message handler with DIAG registered');` },
  { name: 'full (all code after imports)', code: fs.readFileSync('sw.js', 'utf8').replace(/importScripts\('.+?'\);\n?/g, '') },
];

function startServer(swCode, port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(swCode);
        return;
      }
      if (req.url.startsWith('/uv/')) {
        const fullPath = '.' + req.url;
        if (fs.existsSync(fullPath)) {
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(fs.readFileSync(fullPath, 'utf8'));
          return;
        }
      }
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><head><title>Test</title></head><body><script>navigator.serviceWorker.register("/sw.js",{scope:"/"}).then(function(r){console.log("[PAGE] SW registered");}).catch(function(e){console.error("[PAGE] SW FAILED:",e.message);});</script></body></html>');
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(port, () => resolve(server));
  });
}

async function testVersion(version, port) {
  const server = await startServer(SW_REDUCED(version.code), port);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  const result = await new Promise((resolve) => {
    const logs = [];
    page.on('console', msg => { logs.push(`[${msg.type()}] ${msg.text()}`); });
    page.on('pageerror', err => logs.push(`[ERR] ${err.message}`));
    
    page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 10000 }).then(async () => {
      await new Promise(r => setTimeout(r, 3000));
      page.evaluate(async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          if (regs.length === 0) return { registered: false };
          const r = regs[0];
          return { registered: true, active: !!r.active };
        } catch(e) { return { error: e.message }; }
      }).then(info => resolve({ name: version.name, logs, info }));
    }).catch(err => resolve({ name: version.name, logs, info: { error: err.message } }));
  });
  
  const swResult = result.logs.find(l => l.includes('[PAGE] SW'));
  console.log(`${result.name}: ${result.info.registered ? 'OK' : 'FAIL'} | ${swResult || 'no SW log'}`);
  if (!result.info.registered) {
    result.logs.filter(l => l.includes('FAILED')).forEach(l => console.log(`  ${l}`));
  }
  
  await page.close();
  await new Promise(r => server.close(r));
  return result;
}

async function main() {
  let basePort = 8100;
  for (const version of VERSIONS) {
    await testVersion(version, basePort++);
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
