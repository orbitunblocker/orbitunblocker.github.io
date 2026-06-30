const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');

const TESTS = [
  { name: 'bundle only', sw: `importScripts('./uv/uv.bundle.js'); console.log('[IMPORT] bundle OK'); self.addEventListener('install', function(e){self.skipWaiting();}); self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());}); self.addEventListener('fetch',function(){});` },
  { name: 'bundle+config', sw: `importScripts('./uv/uv.bundle.js'); importScripts('./uv/uv.config.js'); console.log('[IMPORT] bundle+config OK'); self.addEventListener('install', function(e){self.skipWaiting();}); self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());}); self.addEventListener('fetch',function(){});` },
  { name: 'bundle+config+sw', sw: `importScripts('./uv/uv.bundle.js'); importScripts('./uv/uv.config.js'); importScripts('./uv/uv.sw.js'); console.log('[IMPORT] all OK'); self.addEventListener('install', function(e){self.skipWaiting();}); self.addEventListener('activate',function(e){e.waitUntil(self.clients.claim());}); self.addEventListener('fetch',function(){});` },
];

function serveTest(swCode) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(swCode);
        return;
      }
      if (req.url.startsWith('/uv/')) {
        const filePath = '.' + req.url;
        if (fs.existsSync(filePath)) {
          const ext = req.url.endsWith('.js') ? 'application/javascript' : 'text/plain';
          res.writeHead(200, { 'Content-Type': ext });
          res.end(fs.readFileSync(filePath, 'utf8'));
          return;
        }
      }
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Test</h1><script>navigator.serviceWorker.register("/sw.js",{scope:"/"}).then(function(reg){console.log("[TEST] SW registered");}).catch(function(err){console.error("[TEST] SW FAILED:",err.message);});</script></body></html>');
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(0, () => resolve(server));
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  
  for (const test of TESTS) {
    const server = await serveTest(test.sw);
    const port = server.address().port;
    const page = await browser.newPage();
    
    const result = await new Promise((resolve) => {
      const logs = [];
      page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
      
      page.goto(`http://localhost:${port}/`, { waitUntil: 'load', timeout: 10000 }).then(async () => {
        await new Promise(r => setTimeout(r, 3000));
        // Check SW state
        const info = await page.evaluate(async () => {
          try {
            const regs = await navigator.serviceWorker.getRegistrations();
            if (regs.length === 0) return { registered: false };
            const r = regs[0];
            return { registered: true, active: !!r.active, state: r.active?.state };
          } catch(e) { return { error: e.message }; }
        });
        resolve({ name: test.name, logs, info });
      }).catch(err => {
        resolve({ name: test.name, logs, info: { error: err.message } });
      });
    });
    
    const swResult = result.logs.find(l => l.includes('[TEST] SW'));
    console.log(`${result.name}: ${result.info.registered ? 'REGISTERED' : 'FAILED'} active=${result.info.active} | SW log: ${swResult || 'none'}`);
    if (!result.info.registered) {
      result.logs.filter(l => l.includes('FAILED')).forEach(l => console.log(`  ${l}`));
    }
    
    await page.close();
    await new Promise(r => server.close(r));
  }
  
  await browser.close();
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
