const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Serve the ACTUAL sw.js and all project files
function startServer(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const filePath = req.url === '/' ? 'index.html' : req.url.substring(1);
      const fullPath = path.resolve(filePath);
      
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const ext = path.extname(fullPath);
        const types = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.map': 'application/json' };
        res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain' });
        res.end(fs.readFileSync(fullPath));
      } else {
        res.writeHead(404).end('Not found: ' + req.url);
      }
    });
    server.listen(port, () => resolve(server));
  });
}

async function main() {
  const server = await startServer(8085);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', msg => { logs.push(`[${msg.type()}] ${msg.text()}`); console.log(`[PAGE ${msg.type()}] ${msg.text()}`); });
  page.on('pageerror', err => console.log(`[PAGE-ERR] ${err.message}`));

  await page.goto('http://localhost:8085/', { waitUntil: 'load', timeout: 15000 });
  console.log('=== Page loaded ===');
  await new Promise(r => setTimeout(r, 5000));

  // Check SW state
  const swInfo = await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length === 0) return { registered: false };
      const r = regs[0];
      return { registered: true, active: !!r.active, state: r.active?.state, url: r.active?.scriptURL, scope: r.scope };
    } catch(e) { return { error: e.message }; }
  });
  console.log('SW info:', JSON.stringify(swInfo));

  await browser.close();
  server.close();
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
