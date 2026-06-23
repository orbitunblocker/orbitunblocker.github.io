import http from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createBareServer } from '@tomphttp/bare-server-node';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT, 10) || 8080;
const bare = createBareServer('/bare/', { connectionLimiter: { maxConnectionsPerIP: 99999 } });

const MIME = {
  '.html':'text/html','.js':'application/javascript','.mjs':'application/javascript',
  '.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml',
  '.json':'application/json','.wasm':'application/wasm','.woff':'font/woff',
  '.woff2':'font/woff2','.map':'application/json'
};

function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.join(__dirname, urlPath);
  // Security: prevent path traversal
  if (!filePath.startsWith(__dirname)) { res.statusCode = 403; res.end('Forbidden'); return; }
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // Fallback to index.html for SPA
      fs.readFile(path.join(__dirname, 'index.html'), (err2, data2) => {
        if (err2) { res.statusCode = 404; res.end('Not found'); return; }
        res.setHeader('Content-Type', 'text/html');
        res.end(data2);
      });
      return;
    }
    if (filePath.endsWith('sw.js') || filePath.endsWith('uv.sw.js')) {
      res.setHeader('Service-Worker-Allowed', '/');
    }
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const isBare = bare.shouldRoute(req);
  const originalUrl = req.url;
  const method = req.method;

  // Log wrapper without interfering with res.end
  const origEnd = res.end.bind(res);
  let ended = false;
  res.end = function(chunk, encoding, cb) {
    if (ended) return; // prevent double-end crashes
    ended = true;
    if (!chunk && !encoding && !cb) {
      console.log('[SERVER]', method, originalUrl, '->', res.statusCode, '(bare:', isBare, ')');
    }
    return origEnd(chunk, encoding, cb);
  };

  try {
    if (isBare) {
      bare.routeRequest(req, res);
    } else {
      serveStatic(req, res);
    }
  } catch (e) {
    console.error('[SERVER-ERROR]', method, originalUrl, e.message);
    if (!ended) { res.statusCode = 500; res.end('Server error'); }
  }
});

server.on('upgrade', (req, socket, head) => {
  if (bare.shouldRoute(req)) bare.routeUpgrade(req, socket, head);
  else socket.end();
});

server.listen(PORT, () => {
  console.log('ORBIT SERVER RUNNING ON 8080');
  console.log('Stable server + bare proxy ready');
});
