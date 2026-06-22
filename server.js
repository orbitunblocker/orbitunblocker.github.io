import express from 'express';
import { createBareServer } from '@tomphttp/bare-server-node';
import http from 'http';
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
