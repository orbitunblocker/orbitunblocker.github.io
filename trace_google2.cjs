const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();
  
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));

  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Wait for SW
  for (let i = 0; i < 20; i++) {
    try {
      const d = await page.evaluate(() => new Promise((resolve, reject) => {
        const ctrl = navigator.serviceWorker.controller;
        if (!ctrl) return reject('no controller');
        const ch = new MessageChannel();
        ch.port1.onmessage = e => resolve(e.data);
        ctrl.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
        setTimeout(() => reject('timeout'), 3000);
      }));
      if (d.portState?.status === 'ready') break;
    } catch(e) {}
    await page.waitForTimeout(500);
  }

  logs.length = 0;
  console.log('Navigating...');
  try {
    await page.evaluate(() => {
      window.VoltraBrowser.navigate('https://www.google.com/');
    });
  } catch(e) {
    console.log('evaluate error:', e.message.substring(0, 200));
  }
  await page.waitForTimeout(3000);

  // Print TRACE logs
  const traceLogs = logs.filter(l => l.includes('[TRACE') || l.includes('[UV-ROUTE') || l.includes('[NAV]') || l.includes('[DEFER') || l.includes('[FLUSH'));
  traceLogs.forEach(l => console.log(l));

  await ctx.close();
  await browser.close();
}

main().catch(e => console.error('FATAL:', e));
