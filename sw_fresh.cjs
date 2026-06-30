// Use a persistent context with a temp directory for clean SW testing
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

async function main() {
  const tmpDir = path.join(require('os').tmpdir(), 'sw-test-' + Date.now());
  console.log('Using temp profile:', tmpDir);
  
  const browser = await chromium.launchPersistentContext(tmpDir, {
    headless: true,
    args: ['--no-sandbox'],
  });
  
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[ERR] ${err.message}`));
  
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  console.log('Page loaded');
  await new Promise(r => setTimeout(r, 5000));
  
  const swInfo = await page.evaluate(async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      return { count: regs.length, info: regs.map(r => ({ active: !!r.active, state: r.active?.state, url: r.active?.scriptURL })) };
    } catch(e) { return { error: e.message }; }
  });
  console.log('SW info:', JSON.stringify(swInfo));
  
  // Print boot-related logs
  logs.filter(l => l.includes('BOOT') || l.includes('SW')).forEach(l => console.log('  ' + l));
  
  await browser.close();
  
  // Cleanup temp dir
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch(_) {}
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
