const { chromium } = require('playwright');
const EXE = 'C:\\Users\\abeni\\AppData\\Local\\Programs\\Opera GX\\opera.exe';

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: false, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(15000);
  
  // Track portReady value using mutation observer / polling
  await ctx.addInitScript(() => {
    setInterval(() => {
      const bs = window.__UV_BOOT_STATUS__;
      if (bs && bs.portReady !== undefined && bs.__lastPort !== bs.portReady) {
        console.log('[PR-POLL] portReady: ' + bs.__lastPort + ' -> ' + bs.portReady + ' at ' + Date.now());
        bs.__lastPort = bs.portReady;
      }
    }, 20);
  });
  
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  console.log('First load done, waiting 5s...');
  await new Promise(r => setTimeout(r, 5000));
  
  // Cache-bust
  await page.route('**/js/*.js', async route => {
    const url = new URL(route.request().url());
    url.searchParams.set('_cb', '' + Date.now());
    await route.continue({ url: url.toString() });
  });
  
  await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log('Reload done, waiting 2s...\n');
  await new Promise(r => setTimeout(r, 2000));
  
  await page.evaluate(() => {
    const tryIt = () => {
      if (window.VoltraBrowser) {
        const m = document.createElement('div'); m.id = 'browserMount';
        const mc = document.querySelector('#mainContent') || document.body;
        mc.innerHTML = ''; mc.appendChild(m);
        window.VoltraBrowser.render(m);
        window.VoltraBrowser.navigate('https://example.com');
      } else { setTimeout(tryIt, 5); }
    };
    setTimeout(tryIt, 0);
  });
  
  await new Promise(r => setTimeout(r, 6000));
  
  console.log('=== SYNC-ERR (all) ===');
  logs.filter(l => l.includes('[SYNC-ERR]')).forEach(l => console.log('  ' + l.substring(0, 300)));
  
  console.log('\n=== SW-STATUS (all) ===');
  logs.filter(l => l.includes('[SW-STATUS]') || l.includes('[SW-REG]')).forEach(l => console.log('  ' + l.substring(0, 200)));
  
  console.log('\n=== KEY EVENTS ===');
  logs.filter(l => l.includes('[PORT_SYNC]') || l.includes('[PORT_READY]') || l.includes('[DEFER') || l.includes('failedStage') || l.includes('portReady')).forEach(l => console.log('  ' + l.substring(0, 300)));
  
  const final = await page.evaluate(() => ({
    portReady: window.__UV_BOOT_STATUS__?.portReady,
    failedStage: window.__UV_BOOT_STATUS__?.failedStage,
    swPortStatus: window.__UV_BOOT_STATUS__?.swPortStatus,
    pendingNavs: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
    iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0,130)
  }));
  console.log('\n=== FINAL ===');
  console.log(JSON.stringify(final, null, 2));
  
  await ctx.close();
  await browser.close();
}

main().catch(e => console.error('FATAL:', e));
