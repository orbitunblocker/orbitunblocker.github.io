// Test: can the SW register at all?
import { chromium } from 'playwright';

const URL = 'http://localhost:8080';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[PAGE-ERR] ${err.message}`));

  // Intercept SW registration to detect the error
  await page.route('**/sw.js', async route => {
    const response = await route.fetch();
    const body = await response.text();
    // Don't modify, just log
    console.log(`sw.js: ${body.length} bytes, first 100: ${body.substring(0, 100)}`);
    await route.continue();
  });

  await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
  console.log('Page loaded. Title:', await page.title());
  await new Promise(r => setTimeout(r, 3000));

  // Check SW registration in detail
  const swInfo = await page.evaluate(async () => {
    const info = {};
    info.controller = navigator.serviceWorker.controller ? 'yes' : 'no';
    info.controllerState = navigator.serviceWorker.controller?.state || null;
    info.controllerUrl = navigator.serviceWorker.controller?.scriptURL || null;
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      info.registrations = regs.map(r => ({
        scope: r.scope,
        active: r.active ? { state: r.active.state, url: r.active.scriptURL } : null,
        installing: r.installing ? { state: r.installing.state, url: r.installing.scriptURL } : null,
        waiting: r.waiting ? { state: r.waiting.state, url: r.waiting.scriptURL } : null,
      }));
    } catch(e) {
      info.getRegsError = e.message;
    }
    return info;
  });
  
  console.log('SW info:', JSON.stringify(swInfo, null, 2));
  
  // Print last 20 page logs
  console.log('\n=== Last 20 page logs ===');
  logs.slice(-20).forEach(l => console.log(l));

  await browser.close();
  
  if (swInfo.registrations && swInfo.registrations.length > 0 && swInfo.registrations[0].active) {
    console.log('\n*** SW IS REGISTERED AND ACTIVE ***');
  } else {
    console.log('\n*** SW IS NOT ACTIVE ***');
  }
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
