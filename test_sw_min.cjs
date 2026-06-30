// Test if a minimal sw.js can register
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const MINIMAL_SW = `importScripts('./uv/uv.bundle.js');
importScripts('./uv/uv.config.js');
importScripts('./uv/uv.sw.js');
console.log('[MINIMAL-SW] script evaluated');
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.url.startsWith(location.origin + '/service/')) {
    e.respondWith(fetch(e.request).catch(() => new Response('proxy error', {status:502})));
  }
});
`;

const ORIGINAL_SW = fs.readFileSync('sw.js', 'utf8');

// Start a custom server
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const filePath = req.url === '/' ? 'index.html' : req.url.substring(1);
      const fullPath = path.resolve(filePath);
      
      // Serve minimal sw.js at /sw.js
      if (req.url === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(MINIMAL_SW);
        return;
      }
      
      // Serve uv files
      if (req.url.startsWith('/uv/')) {
        const uvPath = path.resolve('.' + req.url);
        if (fs.existsSync(uvPath)) {
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(fs.readFileSync(uvPath, 'utf8'));
          return;
        }
      }
      
      // Serve static files
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath);
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
        res.end(fs.readFileSync(fullPath, 'utf8'));
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(8082, () => {
      console.log('Test server on 8082');
      resolve(server);
    });
  });
}

async function main() {
  const server = await startServer();
  
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[PAGE-ERR] ${err.message}`));
  
  await page.goto('http://localhost:8082/', { waitUntil: 'load', timeout: 15000 });
  console.log('Page loaded');
  await new Promise(r => setTimeout(r, 4000));
  
  const swInfo = await page.evaluate(async () => {
    const info = {};
    info.controller = navigator.serviceWorker.controller ? 'yes' : 'no';
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      info.count = regs.length;
      info.regs = regs.map(r => ({
        scope: r.scope,
        active: r.active ? r.active.scriptURL : null,
        activeState: r.active ? r.active.state : null,
      }));
    } catch(e) {
      info.error = e.message;
    }
    return info;
  });
  
  console.log('SW state:', JSON.stringify(swInfo, null, 2));
  
  const swLogs = logs.filter(l => l.includes('MINIMAL-SW') || l.includes('BOOT'));
  console.log('\nSW/BOOT logs:', swLogs.join('\n'));
  
  await browser.close();
  server.close();
  
  if (swInfo.regs && swInfo.regs.length > 0 && swInfo.regs[0].active) {
    console.log('\n*** MINIMAL SW REGISTERED SUCCESSFULLY ***');
  } else {
    console.log('\n*** MINIMAL SW FAILED TO REGISTER ***');
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
