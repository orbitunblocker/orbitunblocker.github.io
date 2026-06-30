const { chromium } = require('playwright');

async function getDiag(page) {
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
    return { error: String(e).substring(0, 200) };
  }
}

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();

  // Network events
  const nets = [];
  page.on('request', req => nets.push({ ev: 'REQ', url: req.url().substring(0, 200), method: req.method(), type: req.resourceType(), ts: Date.now() }));
  page.on('response', resp => nets.push({ ev: 'RES', url: resp.url().substring(0, 200), status: resp.status(), ts: Date.now() }));
  page.on('requestfailed', req => nets.push({ ev: 'FAIL', url: req.url().substring(0, 200), err: req.failure()?.errorText, ts: Date.now() }));

  // Console
  const logs = [];
  page.on('console', msg => logs.push({ text: msg.text().substring(0, 250), ts: Date.now() }));

  // Load
  console.log('Loading Orbit...');
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });

  // Wait for SW to be fully active (portStatus='ready') with retries
  let base = {};
  for (let i = 0; i < 20; i++) {
    base = await getDiag(page);
    if (base.portState?.status === 'ready' && base.log) break;
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('SW: portStatus=' + (base.portState?.status || '?') + ' hasWorker=' + base.hasWorker + ' isPromise=' + base.isPromise + ' logCount=' + (base.log?.length || 0));
  if (base.portState?.status !== 'ready') { console.log('SW not ready, skipping test'); await browser.close(); return; }

  // Clear old SW logs
  await page.evaluate(() => navigator.serviceWorker.controller?.postMessage?.({ type: '__CLEAR_LOG__' })).catch(() => {});
  await new Promise(r => setTimeout(r, 100));

  // Navigate
  const navStart = Date.now();
  await page.evaluate(() => {
    const go = () => {
      if (window.VoltraBrowser) {
        const m = document.createElement('div'); m.id = 'browserMount';
        const mc = document.querySelector('#mainContent') || document.body;
        mc.innerHTML = ''; mc.appendChild(m);
        window.VoltraBrowser.render(m);
        window.VoltraBrowser.navigate('https://example.com');
      } else setTimeout(go, 5);
    };
    setTimeout(go, 0);
  });
  console.log('Navigate called, waiting...');
  await new Promise(r => setTimeout(r, 6000));

  // Check page state
  const state = await page.evaluate(() => ({
    portReady: window.__UV_BOOT_STATUS__?.portReady,
    pending: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
    iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0, 150),
    iframeDoc: (() => { const f = document.getElementById('browserFrame-main'); try { return f?.contentDocument?.readyState || 'no-doc'; } catch(e) { return 'blocked'; } })()
  })).catch(() => ({ error: 'page crashed' }));

  console.log('Page state: ' + JSON.stringify(state));

  // Get SW logs
  const diag = await getDiag(page);
  const swLogs = diag.log || [];

  // Filter SW logs during navigation window
  const navLogs = swLogs.filter(l => l.ts >= navStart && l.ts <= navStart + 10000);

  // Extract HOP traces
  const hops = navLogs.filter(l => l.msg.includes('[HOP]'));
  const dnSends = navLogs.filter(l => l.msg.includes('[DN-SEND]'));
  const fetchLogs = navLogs.filter(l => l.msg.includes('[SW-FETCH]') || l.msg.includes('fetch #'));
  const traceLogs = navLogs.filter(l => l.msg.includes('[TRACE]'));
  const otherSW = navLogs.filter(l => !l.msg.includes('[HOP]') && !l.msg.includes('[DN-SEND]') && !l.msg.includes('[SW-FETCH]') && !l.msg.includes('fetch #') && !l.msg.includes('[TRACE]') && !l.msg.includes('GET_DIAG'));

  // Network events during nav
  const navNets = nets.filter(r => r.ts >= navStart && r.ts <= navStart + 10000);

  console.log('\n========== FULL REQUEST LIFECYCLE ==========\n');

  // Print in order
  const allEvents = [];

  // SW logs
  navLogs.forEach(l => allEvents.push({ ts: l.ts, src: 'SW', text: (l.msg + ' ' + l.rest.join(' ')).substring(0, 250) }));
  
  // Network events
  navNets.forEach(n => allEvents.push({ ts: n.ts, src: 'NET', text: JSON.stringify(n) }));

  // Page console
  logs.filter(l => l.ts >= navStart && l.ts <= navStart + 10000 &&
    (l.text.includes('[NAV]') || l.text.includes('[UV-ROUTE]') || l.text.includes('[DEFER') || l.text.includes('[FLUSH') || l.text.includes('[PORT_SYNC]') || l.text.includes('[PORT_READY]') || l.text.includes('[SYNC]')))
    .forEach(l => allEvents.push({ ts: l.ts, src: 'PAGE', text: l.text }));

  // Sort by timestamp
  allEvents.sort((a, b) => a.ts - b.ts);

  allEvents.forEach(e => console.log('+' + (e.ts - navStart) + 'ms [' + e.src + '] ' + e.text));

  // Summary
  console.log('\n========== STAGE SUMMARY ==========');

  const hasHOP0 = navLogs.some(l => l.msg.includes('fetch #') || l.msg.includes('[TRACE] UV_PROXY'));
  // Log format: "[HOP] hop:1-sw-wrapper url:... status:... detail:..."
  const hasHOP1 = navLogs.some(l => l.msg.includes('hop:1-sw-wrapper'));
  const hasHOP2 = navLogs.some(l => l.msg.includes('hop:2-uv-fetch-entry'));
  const hasHOP3 = navLogs.some(l => l.msg.includes('hop:3-bareClient-fetch'));
  const hasHOP4 = navLogs.some(l => l.msg.includes('hop:4-bareClient-response'));
  const hasHOP5 = navLogs.some(l => l.msg.includes('hop:5-uv-fetch-exit'));
  const hasHOP6 = navLogs.some(l => l.msg.includes('hop:6-sw-wrapper-response'));
  const hasDNSend = navLogs.some(l => l.msg.includes('[DN-SEND]'));
  const hasDNResolve = navLogs.some(l => l.msg.includes('[DN-SEND] RESOLVED'));
  const hasBareReq = navNets.some(n => n.url.includes('/bare/') && n.ev === 'REQ');
  const hasBareRes = navNets.some(n => n.url.includes('/bare/') && n.ev === 'RES');
  const hasUVRoute = logs.some(l => l.text.includes('[UV-ROUTE]') && l.ts >= navStart - 500);
  const hasServiceReq = navNets.some(n => n.url.includes('/service/') && n.ev === 'REQ');
  const hasServiceRes = navNets.some(n => n.url.includes('/service/') && n.ev === 'RES');
  const hasIframe = state && state.iframeDoc && state.iframeDoc !== 'no-doc';
  const navOk = state && state.pending === 0 && state.portReady === true;

  const stages = [
    { n: 'iframe.src assigned', ok: hasUVRoute },
    { n: 'SW fetch event', ok: hasHOP0 },
    { n: 'sw.fetch wrapper (HOP 1)', ok: hasHOP1 },
    { n: 'UV fetch entry (HOP 2)', ok: hasHOP2 },
    { n: 'BareClient fetch (HOP 3)', ok: hasHOP3 },
    { n: 'Dn.sendMessage (SharedWorker)', ok: hasDNSend },
    { n: 'Dn.sendMessage RESOLVED', ok: hasDNResolve },
    { n: 'Bare /bare/v1/ network request', ok: hasBareReq || hasBareRes },
    { n: 'BareClient response (HOP 4)', ok: hasHOP4 },
    { n: 'UV fetch exit (HOP 5)', ok: hasHOP5 },
    { n: 'sw.fetch response (HOP 6)', ok: hasHOP6 },
    { n: '/service/ network response', ok: hasServiceRes || hasIframe },
    { n: 'iframe loaded content', ok: hasIframe },
  ];

  stages.forEach(s => console.log('  ' + (s.ok ? '+ OK' : '- MISSING') + ' ' + s.n));
  const firstMiss = stages.find(s => !s.ok);
  if (firstMiss) console.log('\n*** FIRST MISSING STAGE: ' + firstMiss.n + ' ***');
  else console.log('\n*** ALL STAGES COMPLETE ***');

  console.log('\nNavigation ' + (navOk ? 'SUCCESS' : 'FAILED') + ' | SW port: ' + (diag?.portState?.status || '?'));

  await ctx.close();
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
