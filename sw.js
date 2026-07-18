importScripts('./uv/uv.bundle.js');
importScripts('./uv/uv.config.js');
importScripts('./uv/uv.sw.js');

const sw = new UVServiceWorker();

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

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.type !== 'SYNC_PORT_STATE') return;

  const response = {
    type: 'PORT_STATE_SYNC',
    portReady: true,
    bareMuxReady: true,
    status: 'ready',
    reinitCount: 0
  };

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
      const response = await sw.fetch(event);
      const duration = Date.now() - start;
      console.log('[UV REQUEST]', event.request.url, 'decoded:', decodedUrl, 'dest:', event.request.destination, 'status:', response.status, 'duration:', duration + 'ms');
      if (duration > 5000) {
        console.log('[SLOW UV REQUEST]', duration + 'ms', 'url:', event.request.url, 'decoded:', decodedUrl, 'dest:', event.request.destination, 'status:', response.status);
      }
      return response;
    } catch (error) {
      const duration = Date.now() - start;
      console.error('[UV REQUEST FAILED]', event.request.url, 'decoded:', decodedUrl, 'dest:', event.request.destination, 'duration:', duration + 'ms', 'error:', error && error.message ? error.message : error);
      throw error;
    }
  })());
});
