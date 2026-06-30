const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BARE_SW = `
console.log('[BARE-SW] script evaluated at', Date.now());
self.addEventListener('install', (e) => { console.log('[BARE-SW] install'); self.skipWaiting(); });
self.addEventListener('activate', (e) => { console.log('[BARE-SW] activate'); e.waitUntil(self.clients.claim()); });
self.addEventListener('message', (e) => {
  console.log('[BARE-SW] message:', e.data && e.data.type);
  if (e.data && e.data.type === 'PING') {
    e.source.postMessage({ type: 'PONG', time: Date.now() });
  }
});
self.addEventListener('fetch', (e) => {
  console.log('[BARE-SW] fetch:', e.request.url);
  if (e.request.url.includes('/service/')) {
    e.respondWith(new Response('bare-proxy', {status:200}));
  }
});
`;

function startServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(BARE_SW);
        return;
      }
      const filePath = req.url === '/' ? 'index.html' : req.url.substring(1);
      const fullPath = path.resolve(filePath);
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath);
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
        res.end(fs.readFileSync(fullPath));
        return;
      }
      res.writeHead(404);
      res.end('Not found: ' + req.url);
    });
    server.listen(8083, () => { console.log('Bare SW server on 8083'); resolve(server); });
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
  page.on('response', resp => { if (resp.status() >= 400) logs.push(`[HTTP ${resp.status()}] ${resp.url()}`); });
  
  await page.goto('http://localhost:8083/', { waitUntil: 'load', timeout: 15000 });
  console.log('Page loaded');
  await new Promise(r => setTimeout(r, 5000));
  
  const swInfo = await page.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      return { ready: true, active: !!reg.active, scope: reg.scope, activeUrl: reg.active?.scriptURL };
    } catch(e) {
      return { ready: false, error: e.message };
    }
  });
  
  console.log('SW info:', JSON.stringify(swInfo));
  
  // Try communicating with SW
  if (swInfo.active) {
    const pong = await page.evaluate(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        return await new Promise((resolve) => {
          const mc = new MessageChannel();
          mc.port1.onmessage = e => resolve(e.data);
          reg.active.postMessage({ type: 'PING' }, [mc.port2]);
          setTimeout(() => resolve({ error: 'timeout' }), 2000);
        });
      } catch(e) { return { error: e.message }; }
    });
    console.log('SW ping result:', JSON.stringify(pong));
  }
  
  const relLogs = logs.filter(l => l.includes('BARE-SW') || l.includes('BOOT') || l.includes('SW') || l.includes('ERR') || l.includes('HTTP'));
  console.log('\nRelevant logs:', relLogs.slice(-30).join('\n'));
  
  await browser.close();
  server.close();
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
