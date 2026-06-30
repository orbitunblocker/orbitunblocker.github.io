const { chromium } = require('playwright');
const path = require('path');

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:\\Users\\abeni\\AppData\\Local\\Programs\\Opera GX\\opera.exe',
    headless: false,
    args: ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer']
  });

  const page = await browser.newPage();

  // Capture ALL console output
  const rawLogs = [];
  page.on('console', msg => {
    rawLogs.push({ text: msg.text(), ts: Date.now() });
  });

  // Load the app and immediately render browser + navigate before boot
  console.log('[TEST] Loading Orbit...');
  await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 15000 });

  // At the earliest possible moment, render browser UI and navigate
  await page.evaluate(() => {
    // Render browser UI immediately
    const tryRender = () => {
      if (window.VoltraBrowser && typeof window.VoltraBrowser.render === 'function') {
        const mount = document.createElement('div');
        mount.id = 'browserMount';
        const mc = document.querySelector('#mainContent') || document.querySelector('.main-content') || document.body;
        mc.innerHTML = '';
        mc.appendChild(mount);
        window.VoltraBrowser.render(mount);
        // Navigate immediately (before portReady)
        window.VoltraBrowser.navigate('https://example.com');
        console.log('[TEST] Early navigate() completed');
      } else {
        setTimeout(tryRender, 5);
      }
    };
    setTimeout(tryRender, 0);
  });

  // Wait for boot + flush to complete
  await new Promise(r => setTimeout(r, 8000));

  // Final state
  const final = await page.evaluate(() => {
    const ui = window.VoltraBrowser?._browserUI;
    const iframe = document.getElementById('browserFrame-main');
    return {
      portReady: window.__UV_BOOT_STATUS__?.portReady,
      pendingNavs: ui?._pendingNavigations?.length || 0,
      pendingUrls: JSON.stringify((ui?._pendingNavigations || []).map(n => ({ url: n.url, ts: n.ts }))),
      iframeSrc: iframe?.src?.substring(0, 130) || 'N/A',
      iframeExists: !!iframe,
      swActivated: window.__UV_BOOT_STATUS__?._log?.filter(e => e.key === 'swActivated').pop()?.val || false,
    };
  });
  console.log('\n=== FINAL STATE ===');
  console.log(JSON.stringify(final, null, 2));

  // Build the event chain
  let refTs = rawLogs.length > 0 ? rawLogs[0].ts : 0;

  const navEvents = rawLogs.filter(l =>
    l.text.includes('[NAV-TRACE]') ||
    l.text.includes('[PORT_SYNC]') ||
    l.text.includes('[DEFER') ||
    l.text.includes('[FLUSH') ||
    l.text.includes('[PORT_READY]') ||
    l.text.includes('[BOOT]') ||
    l.text.includes('[UV-ROUTE]') ||
    l.text.includes('[TEST]')
  );

  console.log('\n=== CHRONOLOGICAL EVENT CHAIN ===');
  navEvents.forEach(l => console.log('+' + (l.ts - refTs) + 'ms ' + l.text));

  // Identify first missing event in chain
  const chainChecks = [
    { name: 'navigate() called', pattern: '[NAV-TRACE] navigate() called' },
    { name: '_loadUrlInFrame entered', pattern: '[NAV-TRACE] _loadUrlInFrame() enter' },
    { name: 'DEFER (port not ready)', pattern: '[NAV-TRACE] DEFER:' },
    { name: 'QUEUED', pattern: '[NAV-TRACE] QUEUED:' },
    { name: 'syncPortStateFromSW called', pattern: '[NAV-TRACE] syncPortStateFromSW() called' },
    { name: 'syncPortStateFromSW response', pattern: '[NAV-TRACE] syncPortStateFromSW() got response' },
    { name: 'PORT_SYNC received', pattern: '[NAV-TRACE] PORT_SYNC:' },
    { name: 'PORT_SYNC calling flush', pattern: '[NAV-TRACE] PORT_SYNC calling _flushPendingNavigations' },
    { name: '_flushPendingNavigations enter', pattern: '[NAV-TRACE] _flushPendingNavigations() enter' },
    { name: 'Flush processing nav', pattern: '[NAV-TRACE] Flush processing:' },
    { name: 'ASSIGNING iframe.src', pattern: '[NAV-TRACE] ASSIGNING iframe.src' },
  ];

  console.log('\n=== CHAIN VERIFICATION ===');
  let missing = [];
  for (const check of chainChecks) {
    const found = navEvents.some(l => l.text.includes(check.pattern));
    console.log('  ' + (found ? '✓' : '✗') + ' ' + check.name);
    if (!found) missing.push(check.name);
  }
  if (missing.length > 0) {
    console.log('\n*** FIRST MISSING EVENT: ' + missing[0] + ' ***');
  } else {
    console.log('\n*** ALL EVENTS PRESENT — PIPELINE COMPLETE ***');
  }

  await browser.close();
}

main().catch(e => { console.error('FATAL:', e.message, e.stack); process.exit(1); });
