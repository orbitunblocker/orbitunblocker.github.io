// Test the actual raw sw.js file directly - NOT through the Orbit server
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

// Serve raw sw.js and all static files exactly as they exist on disk
function startServer(port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      // Strip query string
      const pathname = req.url.split('?')[0];
      const filePath = pathname === '/' ? 'index.html' : pathname.substring(1);
      const fullPath = path.resolve(filePath);
      
      // IMPORTANT: sw.js is served exactly as-is from disk - NO MODIFICATIONS
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
  // Kill any process on port 8099
  try {
    const netstat = require('child_process').execSync('netstat -ano', {encoding:'utf8'});
    const match = netstat.split('\n').filter(l => l.includes(':8099') && l.includes('LISTENING'));
    if (match.length > 0) {
      const pid = match[0].trim().split(/\s+/).slice(-1)[0];
      try { process.kill(parseInt(pid)); } catch(_) {}
    }
  } catch(_) {}
  await new Promise(r => setTimeout(r, 1000));

  const server = await startServer(8099);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  
  // Use persistent context with temp dir for clean slate
  const tmpDir = path.join(require('os').tmpdir(), 'sw-test-raw-' + Date.now());
  const ctx = await browser.newContext(); // incognito, clean
  const page = await ctx.newPage();
  
  const logs = [];
  page.on('console', msg => { logs.push(msg.text()); console.log(`[PAGE] ${msg.text()}`); });
  page.on('pageerror', err => console.log(`[ERR] ${err.message}`));
  page.on('response', resp => { if (resp.status() >= 400) console.log(`[HTTP ${resp.status()}] ${resp.url()}`); });
  
  console.log('Navigating...');
  await page.goto('http://localhost:8099/', { waitUntil: 'load', timeout: 15000 });
  console.log('Page loaded');
  await new Promise(r => setTimeout(r, 5000));
  
  const swInfo = await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length === 0) return { status: 'no-regs' };
      const r = regs[0];
      return { status: 'registered', active: !!r.active, state: r.active?.state, url: r.active?.scriptURL };
    } catch(e) { return { error: e.message }; }
  });
  console.log('SW result:', JSON.stringify(swInfo));
  
  // Print boot errors
  const bootErrors = logs.filter(l => l.includes('FAILED'));
  bootErrors.forEach(l => console.log('  BOOT ERROR:', l));
  
  await browser.close();
  await new Promise(r => server.close(r));
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {}
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
