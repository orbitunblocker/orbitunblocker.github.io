const { chromium } = require('playwright');

async function runOnce(n) {
  const browser = await chromium.launch({
    executablePath: 'C:\\Users\\abeni\\AppData\\Local\\Programs\\Opera GX\\opera.exe',
    headless: false,
    args: ['--no-sandbox', '--disable-gpu']
  });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push({ text: msg.text(), ts: Date.now() }));
  await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.evaluate(() => {
    const tryRender = () => {
      if (window.VoltraBrowser) {
        const mount = document.createElement('div'); mount.id = 'browserMount';
        const mc = document.querySelector('#mainContent') || document.body;
        mc.innerHTML = ''; mc.appendChild(mount);
        window.VoltraBrowser.render(mount);
        window.VoltraBrowser.navigate('https://example.com');
      } else { setTimeout(tryRender, 5); }
    };
    setTimeout(tryRender, 0);
  });
  await new Promise(r => setTimeout(r, 6000));
  const final = await page.evaluate(() => ({
    portReady: window.__UV_BOOT_STATUS__?.portReady,
    pendingNavs: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
    iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0,130)
  }));
  
  const navDef = logs.filter(l => l.text.includes('[DEFER-NAV]'));
  const navFlush = logs.filter(l => l.text.includes('[FLUSH-NAV]'));
  const navRoute = logs.filter(l => l.text.includes('[UV-ROUTE]'));
  const portReadyEvt = logs.filter(l => l.text.includes('[PORT_READY]'));
  const bootFail = logs.filter(l => l.text.includes('FAILED'));
  const navTrace = logs.filter(l => l.text.includes('[NAV-TRACE]'));
  
  console.log('Run ' + n + ': defers=' + navDef.length + ' flushes=' + navFlush.length + ' routes=' + navRoute.length + ' portReadyEvts=' + portReadyEvt.length + ' bootFails=' + bootFail.length + ' navTraces=' + navTrace.length);
  console.log('  Final: ' + JSON.stringify(final));
  console.log('  DEFER log: ' + (navDef[0]?.text || 'NONE'));
  console.log('  FLUSH log: ' + (navFlush[0]?.text || 'NONE'));
  console.log('  ROUTE log: ' + (navRoute[0]?.text || 'NONE'));
  
  if (bootFail.length > 0) {
    console.log('  BOOT FAILURES:');
    bootFail.forEach(l => console.log('    ' + l.text));
  }
  
  // Check chain completeness
  const hasDefer = navDef.length > 0;
  const hasFlush = navFlush.length > 0;
  const hasRoute = navRoute.length > 0;
  const chainOk = hasDefer && hasFlush && hasRoute;
  if (!chainOk) {
    console.log('  *** CHAIN INCOMPLETE ***');
    if (!hasDefer) console.log('    Missing: DEFER-NAV');
    if (!hasFlush) console.log('    Missing: FLUSH-NAV');
    if (!hasRoute) console.log('    Missing: UV-ROUTE');
  } else {
    console.log('  *** CHAIN COMPLETE ***');
  }
  
  await browser.close();
  return chainOk;
}

async function main() {
  let failures = 0;
  for (let i = 0; i < 3; i++) {
    try {
      const ok = await runOnce(i + 1);
      if (!ok) failures++;
    } catch (e) {
      console.log('Run ' + (i + 1) + ' ERROR: ' + e.message);
      failures++;
    }
    if (i < 2) await new Promise(r => setTimeout(r, 1000));
  }
  console.log('\n=== SUMMARY ===');
  console.log('Failures: ' + failures + '/3');
  if (failures === 0) {
    console.log('No failures found. Pipeline always complete.');
  }
}

main().catch(e => { console.error('FATAL:', e); });
