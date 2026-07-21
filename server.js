import express from 'express';
import { createBareServer } from '@tomphttp/bare-server-node';
import http from 'http';
import https from 'https';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = parseInt(process.env.PORT, 10) || 8080;
const COMPAT_PORT = parseInt(process.env.COMPAT_PORT, 10) || 8092;
const ALLOW_LOCAL_BARE = process.env.ALLOW_LOCAL_BARE === '1';

const bare = createBareServer('/bare/', {
  connectionLimiter: { maxConnectionsPerIP: 99999 },
  logErrors: true,
  blockLocal: !ALLOW_LOCAL_BARE,
});
const app = express();

function readRequestBody(req, limit = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function setCompatCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
  res.setHeader('Access-Control-Expose-Headers', '*');
}

function makeDeterministicBuffer(size) {
  const data = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i += 1) data[i] = i % 251;
  return data;
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

async function handleCompatRequest(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost:' + COMPAT_PORT}`);
  setCompatCors(res);

  if (req.method === 'OPTIONS' || url.pathname === '/options') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === '/get') {
    sendJson(res, 200, { method: req.method, headers: req.headers, query: Object.fromEntries(url.searchParams) });
    return;
  }

  if (['/post-json', '/post-text', '/post-urlencoded', '/post-formdata', '/post-binary', '/post-stream', '/put', '/patch', '/delete'].includes(url.pathname)) {
    const body = await readRequestBody(req);
    sendJson(res, 200, {
      method: req.method,
      path: url.pathname,
      contentType: req.headers['content-type'] || '',
      contentLength: req.headers['content-length'] || '',
      transferEncoding: req.headers['transfer-encoding'] || '',
      bytes: body.length,
      sha256: crypto.createHash('sha256').update(body).digest('hex'),
      preview: body.toString('utf8', 0, Math.min(body.length, 120))
    });
    return;
  }

  if (url.pathname === '/range.bin') {
    const size = 1024 * 1024;
    const data = makeDeterministicBuffer(size);
    const range = req.headers.range;
    const headers = { 'Accept-Ranges': 'bytes', 'Content-Type': 'application/octet-stream' };
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range);
      if (!match) { res.writeHead(416, headers); res.end(); return; }
      const start = Number(match[1]);
      const end = match[2] ? Number(match[2]) : size - 1;
      if (start >= size || end < start) { res.writeHead(416, headers); res.end(); return; }
      const finalEnd = Math.min(end, size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${finalEnd}/${size}`, 'Content-Length': String(finalEnd - start + 1) });
      res.end(data.subarray(start, finalEnd + 1));
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': String(size) });
    res.end(data);
    return;
  }

  if (url.pathname === '/stream') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain; charset=utf-8' });
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      res.write(`chunk-${count}\n`);
      if (count === 5) { clearInterval(timer); res.end(); }
    }, 120);
    return;
  }

  if (url.pathname === '/sse') {
    res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
    let count = 0;
    const timer = setInterval(() => {
      count += 1;
      res.write(`data: event-${count}\n\n`);
      if (count === 3) { clearInterval(timer); res.end(); }
    }, 120);
    return;
  }

  sendJson(res, 404, { error: 'not found', path: url.pathname });
}

function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.on('data', (chunk) => {
    if (chunk.length < 6) return;
    const opcode = chunk[0] & 0x0f;
    const masked = (chunk[1] & 0x80) !== 0;
    let len = chunk[1] & 0x7f;
    let offset = 2;
    if (len === 126) { len = chunk.readUInt16BE(offset); offset += 2; }
    if (len === 127) { socket.destroy(); return; }
    const mask = masked ? chunk.subarray(offset, offset + 4) : null;
    offset += masked ? 4 : 0;
    const payload = Buffer.from(chunk.subarray(offset, offset + len));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    if (opcode === 8) { socket.end(Buffer.from([0x88, 0x00])); return; }
    const header = payload.length < 126 ? Buffer.from([0x80 | opcode, payload.length]) : Buffer.from([0x80 | opcode, 126, payload.length >> 8, payload.length & 255]);
    socket.write(Buffer.concat([header, payload]));
  });
}

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

app.all('/__compat/echo', async (req, res) => {
  try {
    const body = await readRequestBody(req);
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Headers', '*');
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD');
    if (req.method === 'OPTIONS') { res.status(204).end(); return; }
    if (req.method === 'HEAD') { res.status(200).end(); return; }
    res.json({
      method: req.method,
      contentType: req.headers['content-type'] || '',
      contentLength: req.headers['content-length'] || '',
      transferEncoding: req.headers['transfer-encoding'] || '',
      bytes: body.length,
      sha256: crypto.createHash('sha256').update(body).digest('hex'),
      preview: body.toString('utf8', 0, Math.min(body.length, 120))
    });
  } catch (error) {
    res.status(413).json({ error: error.message });
  }
});

app.get('/__compat/range.bin', (req, res) => {
  const size = 1024 * 1024;
  const data = Buffer.allocUnsafe(size);
  for (let i = 0; i < size; i += 1) data[i] = i % 251;
  res.set('Accept-Ranges', 'bytes');
  res.set('Content-Type', 'application/octet-stream');
  const range = req.headers.range;
  if (range) {
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) { res.status(416).end(); return; }
    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : size - 1;
    if (start >= size || end < start) { res.status(416).end(); return; }
    const finalEnd = Math.min(end, size - 1);
    res.status(206);
    res.set('Content-Range', `bytes ${start}-${finalEnd}/${size}`);
    res.set('Content-Length', String(finalEnd - start + 1));
    res.end(data.subarray(start, finalEnd + 1));
    return;
  }
  res.set('Content-Length', String(size));
  res.end(data);
});

app.get('/__compat/stream', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  let count = 0;
  const timer = setInterval(() => {
    count += 1;
    res.write(`chunk-${count}\n`);
    if (count === 5) {
      clearInterval(timer);
      res.end();
    }
  }, 120);
});

app.get('/__compat/sse', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Content-Type', 'text/event-stream; charset=utf-8');
  res.set('Cache-Control', 'no-cache');
  let count = 0;
  const timer = setInterval(() => {
    count += 1;
    res.write(`data: event-${count}\n\n`);
    if (count === 3) {
      clearInterval(timer);
      res.end();
    }
  }, 120);
});

app.get('/__compat/test-page.html', (req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Orbit Compat Test</title>
    <link rel="stylesheet" href="/__compat/test-style.css">
    <h1>compat</h1><img id="png" src="/__compat/image.png"><img id="svg" src="/__compat/icon.svg">
    <script src="/__compat/classic.js"></script><script type="module" src="/__compat/module.js"></script>`);
});

app.get('/__compat/test-style.css', (req, res) => {
  res.type('css').send('@font-face{font-family:CompatFont;src:url("/__compat/font.woff2")}body{font-family:CompatFont,Arial;background-image:url("/__compat/image.png")}');
});

app.get('/__compat/classic.js', (req, res) => {
  res.type('js').send('window.__compatClassicLoaded=true; fetch("/__compat/echo",{method:"POST",body:"classic"}).then(r=>r.json()).then(j=>window.__compatPost=j);');
});

app.get('/__compat/module.js', (req, res) => {
  res.type('js').send('window.__compatModuleLoaded=true; import("/__compat/module-child.js").then(m=>window.__compatDynamic=m.value);');
});

app.get('/__compat/module-child.js', (req, res) => {
  res.type('js').send('export const value = "dynamic-ok";');
});

app.get('/__compat/image.png', (req, res) => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', 'base64');
  res.type('png').send(png);
});

app.get('/__compat/icon.svg', (req, res) => {
  res.type('svg').send('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="lime"/></svg>');
});

app.get('/__compat/font.woff2', (req, res) => {
  res.type('font/woff2').send(Buffer.alloc(16));
});

// Fallback: send index.html for unknown routes
app.use((req, res) => {
  res.status(404).sendFile(path.join(__dirname, 'index.html'));
});

// Create the HTTP server, routing bare requests to the bare server
// and everything else to the Express app
const server = http.createServer();
const compatServer = http.createServer((req, res) => {
  handleCompatRequest(req, res).catch((error) => {
    console.error('[COMPAT] request failed', error && error.stack ? error.stack : error);
    if (!res.headersSent) sendJson(res, 500, { error: error.message || String(error) });
    else res.end();
  });
});

server.on('request', (req, res) => {
  const isBare = bare.shouldRoute(req);
  const originalUrl = req.url;
  const method = req.method;
  
  // Intercept response to log status
  const origEnd = res.end.bind(res);
  res.end = function(chunk, encoding, cb) {
    console.log('[SERVER]', method, originalUrl, '->', res.statusCode, '(bare:', isBare, ')', 'host:', req.headers.host || 'none', 'content-type:', (res.getHeader && res.getHeader('content-type')) || 'unknown');
    if (isBare && res.statusCode >= 400) {
      console.warn('[BARE FAILURE]', 'method:', method, 'url:', originalUrl, 'x-bare-host:', req.headers['x-bare-host'] || '', 'x-bare-port:', req.headers['x-bare-port'] || '', 'x-bare-path:', req.headers['x-bare-path'] || '', 'x-bare-protocol:', req.headers['x-bare-protocol'] || '', 'x-bare-forward:', req.headers['x-bare-forward-headers'] || '', 'content-length:', req.headers['content-length'] || '', 'transfer-encoding:', req.headers['transfer-encoding'] || '');
    }
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

compatServer.on('upgrade', (req, socket) => {
  if (req.url && req.url.startsWith('/ws')) {
    acceptWebSocket(req, socket);
  } else {
    socket.end();
  }
});

process.on('uncaughtException', (error) => {
  console.error('[SERVER FATAL] uncaughtException', error && error.stack ? error.stack : error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[SERVER FATAL] unhandledRejection', reason && reason.stack ? reason.stack : reason);
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
  console.log(`[SERVER] listening on ${PORT}`);
  console.log(`[BARE] mounted at /bare/ (local targets ${ALLOW_LOCAL_BARE ? 'allowed for development' : 'blocked'})`);
  console.log(`Orbit + Ultraviolet running on http://localhost:${PORT}`);
});

compatServer.listen(COMPAT_PORT, () => {
  console.log(`[COMPAT] listening on ${COMPAT_PORT}`);
});
