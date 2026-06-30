// Test actual sw.js registration through Orbit server
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  const logs = [];
  page.on('console', msg => { logs.push(`[${msg.type()}] ${msg.text()}`); console.log(`[PAGE] ${msg.text()}`); });
  page.on('pageerror', err => console.log(`[ERR] ${err.message}`));
  
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  console.log('=== Page loaded ===');
  await new Promise(r => setTimeout(r, 5000));
  
  const swInfo = await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      if (regs.length === 0) return { status: 'no-regs' };
      const r = regs[0];
      return { status: 'has-reg', active: !!r.active, state: r.active?.state, url: r.active?.scriptURL };
    } catch(e) { return { error: e.message }; }
  });
  console.log('SW info:', JSON.stringify(swInfo));
  
  await browser.close();
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
