importScripts('./uv/uv.bundle.js');
importScripts('./uv/uv.config.js');
importScripts('./uv/uv.sw.js');

const sw = new UVServiceWorker();

const proxyState = {
  portReady: false,
  bareMuxReady: false,
  status: 'unknown',
  reinitCount: 0,
  reason: ''
};

async function broadcastProxyState() {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: 'PORT_STATE_SYNC', ...proxyState });
  }
}

function reportProxyFailure(reason) {
  proxyState.portReady = false;
  proxyState.bareMuxReady = false;
  proxyState.status = 'failed';
  proxyState.reason = reason || 'unknown';
  proxyState.reinitCount += 1;
  broadcastProxyState();
}

function redactUrlForLog(value) {
  try {
    const url = new URL(value);
    if (url.search) url.search = '?...';
    if (url.hash) url.hash = '#...';
    return url.href;
  } catch {
    return String(value || '').slice(0, 180);
  }
}

async function broadcastResourceFailure(detail) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const message = { type: 'UV_RESOURCE_FAILURE', ...detail };
  for (const client of clients) client.postMessage(message);
}

function decodeUvUrl(requestUrl) {
  try {
    const url = new URL(requestUrl);
    if (!url.pathname.startsWith(__uv$config.prefix)) return requestUrl;
    const uv = new self.Ultraviolet(__uv$config);
    return uv.sourceUrl(url.pathname + url.search + url.hash);
  } catch (error) {
    return '[decode failed] ' + (error && error.message ? error.message : String(error));
  }
}

function repairEscapedServiceRequest(request, decodedUrl) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  try {
    const decoded = new URL(decodedUrl);
    if (decoded.origin !== self.location.origin) return null;
    if (!decoded.pathname.startsWith(__uv$config.prefix)) return null;
    if (!request.referrer) return null;

    const referrer = new URL(request.referrer);
    if (referrer.origin !== self.location.origin || !referrer.pathname.startsWith(__uv$config.prefix)) return null;

    const uv = new self.Ultraviolet(__uv$config);
    const referrerRemote = new URL(uv.sourceUrl(referrer.pathname + referrer.search + referrer.hash));
    const correctedRemote = new URL(decoded.pathname + decoded.search + decoded.hash, referrerRemote);
    const repairedUrl = self.location.origin + __uv$config.prefix + __uv$config.encodeUrl(correctedRemote.href);
    console.warn('[UV REPAIR] escaped service resource', redactUrlForLog(decoded.href), '->', redactUrlForLog(correctedRemote.href));
    return new Request(repairedUrl, request);
  } catch {
    return null;
  }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.type !== 'SYNC_PORT_STATE') return;

  const response = { type: 'PORT_STATE_SYNC', ...proxyState };

  if (event.ports && event.ports[0]) {
    event.ports[0].postMessage(response);
  } else if (event.source) {
    event.source.postMessage(response);
  }
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith(__uv$config.prefix)) return;

  const start = Date.now();
  const decodedUrl = decodeUvUrl(event.request.url);

  event.respondWith((async () => {
    try {
      const repairedRequest = repairEscapedServiceRequest(event.request, decodedUrl);
      const response = await sw.fetch(repairedRequest ? { request: repairedRequest } : event);
      const duration = Date.now() - start;
      console.log('[UV REQUEST]', event.request.url, 'decoded:', decodedUrl, 'dest:', event.request.destination, 'status:', response.status, 'duration:', duration + 'ms');
      if (response.status >= 500) {
        response.clone().text().then((body) => {
          broadcastResourceFailure({
            method: event.request.method,
            destination: event.request.destination || 'fetch',
            status: response.status,
            original: redactUrlForLog(decodedUrl),
            proxied: redactUrlForLog(event.request.url),
            layer: /invalid MessagePort|All clients returned an invalid MessagePort/i.test(body) ? 'bare-mux-port' : 'uv-or-bare'
          });
          if (/invalid MessagePort|All clients returned an invalid MessagePort/i.test(body)) {
            console.warn('[PROXY] port invalid/disconnected', decodedUrl);
            reportProxyFailure('invalid MessagePort');
          }
        }).catch(() => {});
      }
      if (duration > 5000) {
        console.log('[SLOW UV REQUEST]', duration + 'ms', 'url:', event.request.url, 'decoded:', decodedUrl, 'dest:', event.request.destination, 'status:', response.status);
      }
      return response;
    } catch (error) {
      const duration = Date.now() - start;
      console.error('[UV REQUEST FAILED]', event.request.url, 'decoded:', decodedUrl, 'dest:', event.request.destination, 'duration:', duration + 'ms', 'error:', error && error.message ? error.message : error);
      broadcastResourceFailure({
        method: event.request.method,
        destination: event.request.destination || 'fetch',
        status: 500,
        original: redactUrlForLog(decodedUrl),
        proxied: redactUrlForLog(event.request.url),
        layer: /invalid MessagePort|All clients returned an invalid MessagePort/i.test(error && error.message ? error.message : String(error)) ? 'bare-mux-port' : 'uv-runtime',
        error: error && error.message ? error.message : String(error)
      });
      if (/invalid MessagePort|All clients returned an invalid MessagePort/i.test(error && error.message ? error.message : String(error))) {
        reportProxyFailure('invalid MessagePort');
      }
      throw error;
    }
  })());
});
