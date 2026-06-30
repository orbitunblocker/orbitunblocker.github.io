const { chromium } = require('playwright');

// ============================================================
// Proxy request lifecycle tracer
// Uses: network events + page console + GET_DIAG for SW state
// ============================================================

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();

  // ---- Network event tracing ----
  const requests = [];
  page.on('request', req => {
    requests.push({
      type: 'request',
      id: req.url().substring(0, 120),
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      ts: Date.now(),
    });
  });
  page.on('response', resp => {
    requests.push({
      type: 'response',
      id: resp.url().substring(0, 120),
      url: resp.url(),
      status: resp.status(),
      ts: Date.now(),
    });
  });
  page.on('requestfailed', req => {
    requests.push({
      type: 'requestfailed',
      id: req.url().substring(0, 120),
      url: req.url(),
      error: req.failure()?.errorText || 'unknown',
      ts: Date.now(),
    });
  });

  // ---- Console capture ----
  const logs = [];
  page.on('console', msg => logs.push({ text: msg.text(), ts: Date.now() }));

  // ---- Helper: query SW via GET_DIAG ----
  async function getSWDiag() {
    try {
      return await page.evaluate(() => {
        return new Promise((resolve, reject) => {
          const ctrl = navigator.serviceWorker.controller;
          if (!ctrl) return reject('no controller');
          const ch = new MessageChannel();
          ch.port1.onmessage = e => resolve(e.data);
          ctrl.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
          setTimeout(() => reject('timeout'), 3000);
        });
      });
    } catch(e) {
      return { error: String(e) };
    }
  }

  // ---- Step 1: Load Orbit ----
  console.log('Loading Orbit...');
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  await new Promise(r => setTimeout(r, 3000));

  // ---- Step 2: Get SW state BEFORE navigation ----
  const diagBefore = await getSWDiag();
  console.log('SW state before nav:', JSON.stringify(diagBefore, null, 2));

  // ---- Step 3: Navigate to proxied URL ----
  console.log('\nNavigating to proxied URL...');
  const navStart = Date.now();
  await page.evaluate(() => {
    const tryNav = () => {
      if (window.VoltraBrowser) {
        const m = document.createElement('div'); m.id = 'browserMount';
        const mc = document.querySelector('#mainContent') || document.body;
        mc.innerHTML = ''; mc.appendChild(m);
        window.VoltraBrowser.render(m);
        window.VoltraBrowser.navigate('https://example.com');
      } else { setTimeout(tryNav, 5); }
    };
    setTimeout(tryNav, 0);
  });

  // ---- Step 4: Wait for navigation to complete ----
  await new Promise(r => setTimeout(r, 8000));

  // ---- Step 5: Get SW state AFTER navigation ----
  const diagAfter = await getSWDiag();
  console.log('\nSW state after nav:', JSON.stringify(diagAfter, null, 2));

  // ---- Step 6: Get iframe status ----
  const frameState = await page.evaluate(() => {
    const iframe = document.getElementById('browserFrame-main');
    return {
      iframeSrc: iframe?.src?.substring(0, 150),
      iframeReady: iframe?.contentDocument?.readyState || 'no-doc',
      portReady: window.__UV_BOOT_STATUS__?.portReady,
      pendingNavs: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
    };
  });
  console.log('\nFrame state:', JSON.stringify(frameState, null, 2));

  // ---- Step 7: Produce TIMELINE ----
  console.log('\n========== REQUEST TIMELINE ==========');
  
  // Filter network events during navigation (after navStart)
  const navEvents = requests.filter(r => r.ts >= navStart && r.ts <= navStart + 10000);
  
  // Print network events in chronological order
  const serviceReqs = navEvents.filter(r => r.url.includes('/service/'));
  const bareReqs = navEvents.filter(r => r.url.includes('/bare/'));
  const otherReqs = navEvents.filter(r => !r.url.includes('/service/') && !r.url.includes('/bare/') && r.ts >= navStart);
  
  console.log('\n-- /service/* requests --');
  serviceReqs.forEach(r => console.log(`  ${r.ts - navStart}ms [${r.type}] ${r.method} ${r.url.substring(0, 150)}` + (r.status ? ' status=' + r.status : '') + (r.error ? ' error=' + r.error : '')));
  
  console.log('\n-- /bare/* requests --');
  bareReqs.forEach(r => console.log(`  ${r.ts - navStart}ms [${r.type}] ${r.method} ${r.url.substring(0, 150)}` + (r.status ? ' status=' + r.status : '')));
  
  console.log('\n-- Other relevant requests (first 20) --');
  otherReqs.slice(0, 20).forEach(r => console.log(`  ${r.ts - navStart}ms [${r.type}] ${r.method} ${r.resourceType} ${r.url.substring(0, 150)}` + (r.status ? ' status=' + r.status : '')));

  // ---- Step 8: Page console logs relevant to request lifecycle ----
  console.log('\n-- Page console (proxy-relevant) --');
  const proxyLogs = logs.filter(l => 
    l.text.includes('[HOP]') || l.text.includes('[SW-FETCH]') || l.text.includes('[DN-SEND]') ||
    l.text.includes('[UV-ROUTE]') || l.text.includes('[SERVER-BARE]') || l.text.includes('[BOOT-SW]') ||
    l.text.includes('[INSTR]') || l.text.includes('[BOOT-WORKER]')
  );
  // Only show logs during navigation window
  proxyLogs.forEach(l => console.log(`  ${l.ts - navStart}ms ${l.text.substring(0, 200)}`));

  console.log('\n-- NAV/ROUTE logs --');
  logs.filter(l => l.text.includes('[NAV]') || l.text.includes('[UV-ROUTE]') || l.text.includes('[DEFER') || l.text.includes('[FLUSH')).forEach(l => console.log(`  ${l.ts - navStart}ms ${l.text.substring(0, 200)}`));

  // ---- Summary ----
  console.log('\n========== SUMMARY ==========');

  const hasServiceRequest = serviceReqs.some(r => r.type === 'request');
  const hasServiceResponse = serviceReqs.some(r => r.type === 'response');
  const hasBareRequest = bareReqs.some(r => r.type === 'request');
  const hasBareResponse = bareReqs.some(r => r.type === 'response');
  const iframeHasContent = frameState.iframeReady !== 'no-doc';
  const portIsReady = frameState.portReady === true;

  console.log('Stage:');
  console.log('  1. iframe.src assigned        ' + (logs.some(l => l.text.includes('[UV-ROUTE]')) ? 'OK' : '?'));
  console.log('  2. SW receives /service/ req   ' + (hasServiceRequest ? 'OK' : '?'));
  console.log('  3. SW responds to /service/    ' + (hasServiceResponse ? 'OK (status=' + serviceReqs.filter(r => r.type === 'response').map(r => r.status).join(',') + ')' : '?'));
  console.log('  4. Bare /bare/v1/ request      ' + (hasBareRequest ? 'OK' : '? (maybe SW-internal)'));
  console.log('  5. Bare /bare/v1/ response     ' + (hasBareResponse ? 'OK' : '?'));
  console.log('  6. iframe got content          ' + (iframeHasContent ? 'OK' : '?'));
  console.log('  Port ready: ' + portIsReady);

  // Determine failure
  const stages = [
    { name: 'iframe.src assigned', ok: logs.some(l => l.text.includes('[UV-ROUTE]')) },
    { name: 'SW receives /service/', ok: hasServiceRequest },
    { name: 'SW responds /service/', ok: hasServiceResponse },
    { name: 'Bare request /bare/v1/', ok: hasBareRequest },
    { name: 'Bare response', ok: hasBareResponse },
    { name: 'iframe loaded content', ok: iframeHasContent },
  ];
  
  const firstFail = stages.find(s => !s.ok);
  if (firstFail) {
    console.log('\n*** FIRST MISSING STAGE: ' + firstFail.name + ' ***');
  } else {
    console.log('\n*** ALL STAGES COMPLETE ***');
  }

  await ctx.close();
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
