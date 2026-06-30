// Debug: find what's causing sw.js to fail at eval time
const http = require('http');
const fs = require('fs');

// Wrap sw.js in try/catch and log errors
const swOriginal = fs.readFileSync('sw.js', 'utf8');
const swWrapped = `
// Wrap entire SW eval in try/catch for debugging
let __SW_EVAL_ERROR__ = null;
try {
${swOriginal}
} catch(e) {
  __SW_EVAL_ERROR__ = e.message + '\\n' + (e.stack || 'no-stack');
  console.error('[SW-EVAL-ERROR]', e.message, e.stack);
}
console.log('[SW-EVAL-DONE] error:', __SW_EVAL_ERROR__);
`;

// Also create a version that logs each step
const swInstrumented = `
console.log('[SW] 0. imports starting');
try { importScripts('./uv/uv.bundle.js'); console.log('[SW] 1. bundle OK'); } catch(e) { console.error('[SW] 1. bundle FAILED:', e.message); throw e; }
try { importScripts('./uv/uv.config.js'); console.log('[SW] 2. config OK'); } catch(e) { console.error('[SW] 2. config FAILED:', e.message); throw e; }
try { importScripts('./uv/uv.sw.js'); console.log('[SW] 3. uv.sw OK'); } catch(e) { console.error('[SW] 3. uv.sw FAILED:', e.message); throw e; }
console.log('[SW] 4. imports OK, starting user code');
try {
${swOriginal.replace(/importScripts\('.+?'\);\n?/g, '')}
console.log('[SW] 5. user code OK');
} catch(e) {
  console.error('[SW] 5. user code FAILED:', e.message, '\\n' + (e.stack || ''));
}
`;

// Start server serving the wrapped SW
function startServer(port) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(swInstrumented);
        return;
      }
      if (req.url.startsWith('/uv/')) {
        const fullPath = '.' + req.url;
        if (fs.existsSync(fullPath)) {
          res.writeHead(200, { 'Content-Type': 'application/javascript' });
          res.end(fs.readFileSync(fullPath, 'utf8'));
          return;
        }
      }
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Test</h1><script>navigator.serviceWorker.register("/sw.js",{scope:"/"}).then(function(reg){console.log("[PAGE] SW registered");}).catch(function(err){console.error("[PAGE] SW FAILED:",err.message);});</script></body></html>');
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(port, () => resolve(server));
  });
}

async function main() {


  const server = await startServer(8086);
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', msg => { logs.push(`[${msg.type()}] ${msg.text()}`); console.log(`[${msg.type()}] ${msg.text()}`); });
  page.on('pageerror', err => console.log(`[PAGE-ERR] ${err.message}`));
  page.on('response', resp => { if (resp.status() >= 400) console.log(`[HTTP ${resp.status()}] ${resp.url()}`); });

  try {
    await page.goto('http://localhost:8086/', { waitUntil: 'load', timeout: 15000 });
    console.log('=== Page loaded ===');
  } catch(e) {
    console.log('=== goto timeout/error:', e.message, '=== checking anyway ===');
  }

  await new Promise(r => setTimeout(r, 5000));

  // Check SW registrations
  const swInfo = await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length === 0) return { registered: false };
      const r = regs[0];
      return { registered: true, active: !!r.active, state: r.active?.state, url: r.active?.scriptURL };
    } catch(e) { return { error: e.message }; }
  });
  console.log('\nSW info:', JSON.stringify(swInfo));

  await browser.close();
  server.close();
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
