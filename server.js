import express from 'express';
import { createBareServer } from '@tomphttp/bare-server-node';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT, 10) || 8080;

const bare = createBareServer('/bare/', {
  connectionLimiter: { maxConnectionsPerIP: 99999 },
});
const app = express();

// Serve static files from the orbit root directory
app.use(express.static(__dirname, {
  setHeaders: (res, filePath) => {
    // Required for the UV service worker to have scope over the entire origin
    if (filePath.endsWith('sw.js') || filePath.endsWith('uv.sw.js')) {
      res.set('Service-Worker-Allowed', '/');
    }
  }
}));

// Game compatibility probe — fetches a URL server-side to bypass CORS restrictions
// Returns first 256KB of HTML for client-side engine detection
app.get('/game-probe', (req, res) => {
  const url = req.query.url;
  if (!url) { res.status(400).json({ error: 'Missing url parameter' }); return; }

  let urlObj;
  try { urlObj = new URL(url); } catch(e) { res.status(400).json({ error: 'Invalid URL' }); return; }

  const mod = urlObj.protocol === 'https:' ? https : http;
  const TIMEOUT_MS = 6000;
  const MAX_BYTES = 256 * 1024;

  const proxyReq = mod.get(urlObj, {
    headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
    timeout: TIMEOUT_MS,
    rejectUnauthorized: false,
  }, (proxyRes) => {
    const ct = proxyRes.headers['content-type'] || '';

    res.set('Access-Control-Allow-Origin', '*');
    res.set('X-Detect-Status', String(proxyRes.statusCode || 0));
    res.set('X-Detect-Content-Type', ct);

    if (proxyRes.statusCode !== 200) {
      proxyRes.resume();
      res.end();
      return;
    }

    let bytes = 0;
    proxyRes.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes <= MAX_BYTES) res.write(chunk);
      if (bytes >= MAX_BYTES) { proxyRes.destroy(); res.end(); }
    });
    proxyRes.on('end', () => res.end());
  });

  proxyReq.on('error', (e) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('X-Detect-Status', '0');
    res.set('X-Detect-Content-Type', '');
    res.set('X-Detect-Error', e.message.substring(0, 200));
    res.end();
  });

  proxyReq.on('timeout', () => {
    proxyReq.destroy();
    res.set('Access-Control-Allow-Origin', '*');
    res.set('X-Detect-Status', '0');
    res.set('X-Detect-Content-Type', '');
    res.set('X-Detect-Error', 'upstream timeout');
    res.end();
  });
});

// Fallback: send index.html for unknown routes
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

// Create the HTTP server, routing bare requests to the bare server
// and everything else to the Express app
const server = http.createServer();

server.on('request', (req, res) => {
  const isBare = bare.shouldRoute(req);
  const originalUrl = req.url;
  const method = req.method;
  
  // Intercept response to log status
  const origEnd = res.end.bind(res);
  res.end = function(chunk, encoding, cb) {
    console.log('[SERVER]', method, originalUrl, '->', res.statusCode, '(bare:', isBare, ')', 'host:', req.headers.host || 'none', 'content-type:', (res.getHeader && res.getHeader('content-type')) || 'unknown');
    return origEnd(chunk, encoding, cb);
  };
  
  if (isBare) {
    console.log('[SERVER-BARE] ROUTING to bare:', method, originalUrl);
    bare.routeRequest(req, res);
  } else {
    app(req, res);
  }
});

// Forward WebSocket upgrades to the bare server
server.on('upgrade', (req, socket, head) => {
  if (bare.shouldRoute(req)) {
    bare.routeUpgrade(req, socket, head);
  } else {
    socket.end();
  }
});

const logStream = fs.createWriteStream(path.join(__dirname, 'server-trace.log'), { flags: 'w' });
['log', 'error', 'warn'].forEach((method) => {
  const orig = console[method];
  console[method] = function(...args) {
    const msg = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
    logStream.write('[' + new Date().toISOString() + '] ' + msg + '\n');
    orig.apply(console, args);
  };
});

server.listen(PORT, () => {
  console.log("ORBIT SERVER RUNNING ON 8080");
  console.log(`Orbit + Ultraviolet running on http://localhost:${PORT}`);
});
