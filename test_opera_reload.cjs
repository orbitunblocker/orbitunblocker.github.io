const { chromium } = require('playwright');
const EXE = 'C:\\Users\\abeni\\AppData\\Local\\Programs\\Opera GX\\opera.exe';

async function main() {
  // Path C: Reload scenario - SW already active
  const browser = await chromium.launch({ executablePath: EXE, headless: false, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  
  // First load - install SW, wait for full activation
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  console.log('First load complete, waiting 5s for SW activation...');
  await new Promise(r => setTimeout(r, 5000));
  
  // RELOAD - SW is already active
  await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log('Reload complete, evaluating...\n');
  
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
  
  await new Promise(r => setTimeout(r, 8000));
  
  // Log all captured messages in chronological order
  console.log('=== ALL CAPTURED LOGS (chronological) ===');
  logs.forEach((l, i) => {
    // Filter to only navigation/boot relevant logs
    if (l.includes('[NAV-TRACE]') || l.includes('[PORT_SYNC]') || l.includes('[DEFER-NAV]') || 
        l.includes('[FLUSH-NAV]') || l.includes('[UV-ROUTE]') || l.includes('[PORT_READY]') ||
        l.includes('FAILED') || l.includes('broadcast') || l.includes('MATCHALL') ||
        l.includes('trackPort') || l.includes('SYNC_PORT') || l.includes('portReady')) {
      console.log('  [' + i + '] ' + l.substring(0, 250));
    }
  });
  
  const final = await page.evaluate(() => ({
    portReady: window.__UV_BOOT_STATUS__?.portReady,
    swStatus: window.__UV_BOOT_STATUS__?.swPortStatus,
    bootStage: window.__UV_BOOT_STATUS__?.bootStage,
    pendingNavs: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
    iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0, 130)
  }));
  console.log('\n=== FINAL STATE ===');
  console.log(JSON.stringify(final, null, 2));
  
  // Analyze chain with CORRECT log patterns
  const events = {
    '1-navigate': logs.some(l => l.includes('navigate(')),
    '2-defer/queue': logs.some(l => l.includes('[DEFER-NAV]')),
    '3-sync-send': logs.some(l => l.includes('SYNC_PORT_STATE')),
    '4-broadcast': logs.some(l => l.includes('[PORT_SYNC] state transition') || l.includes('[PORT_SYNC] portReady:')),
    '5-flush': logs.some(l => l.includes('[FLUSH-NAV]') || l.includes('flushing pending navigations') || l.includes('[PORT_READY] flushing')),
    '6-iframe-src': logs.some(l => l.includes('[UV-ROUTE]') || l.includes('ASSIGNING iframe.src')),
  };
  
  console.log('\n=== CHAIN ANALYSIS ===');
  let firstMiss = null;
  for (const [evt, present] of Object.entries(events)) {
    console.log('  ' + (present ? '+' : '-') + ' ' + evt);
    if (!present && !firstMiss) firstMiss = evt;
  }
  if (firstMiss) console.log('\n*** FIRST MISSING EVENT: ' + firstMiss + ' ***');
  else console.log('\n*** ALL EVENTS PRESENT ***');
  
  if (final.pendingNavs > 0) {
    console.log('\n*** NAVIGATION IS STUCK *** pendingNavs=' + final.pendingNavs);
  }
  
  await browser.close();
}

main().catch(e => console.error('FATAL:', e));
