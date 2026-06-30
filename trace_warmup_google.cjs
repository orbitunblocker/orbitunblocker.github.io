const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();
  
  const logs = [];
  page.on('console', msg => { logs.push({ text: msg.text(), ts: Date.now() }); });

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

  // Warm up with example.com
  logs.length = 0;
  console.log('=== WARMUP to example.com ===');
  await page.evaluate(() => window.VoltraBrowser.navigate('https://example.com/')).catch(e => console.log('evaluate error:', e.message.substring(0, 100)));
  await page.waitForTimeout(3000);

  console.log('Warmup logs:');
  logs.filter(l => l.text.includes('[NAV]') || l.text.includes('[N-TRACE]') || l.text.includes('[UV-ROUTE]') || l.text.includes('[DEFER') || l.text.includes('[TRACE]'))
    .forEach(l => console.log('  ', l.text));

  // Now test Google
  logs.length = 0;
  console.log('\n=== TEST: navigate to Google ===');
  try {
    await page.evaluate(() => window.VoltraBrowser.navigate('https://www.google.com/'));
  } catch(e) {
    console.log('evaluate error:', e.message.substring(0, 200));
  }
  await page.waitForTimeout(3000);

  console.log('Google logs:');
  logs.filter(l => l.text.includes('[NAV]') || l.text.includes('[N-TRACE]') || l.text.includes('[UV-ROUTE]') || l.text.includes('[DEFER') || l.text.includes('[TRACE]') || l.text.includes('[N-ERR]'))
    .forEach(l => console.log('  ', l.text));

  await ctx.close();
  await browser.close();
}

main().catch(e => console.error('FATAL:', e));
