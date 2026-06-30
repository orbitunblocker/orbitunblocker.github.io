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
    return { error: String(e).substring(0, 300) };
  }
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();
  
  const nets = [];
  page.on('request', req => nets.push({ ev: 'REQ', url: req.url().substring(0, 200), ts: Date.now() }));
  page.on('response', resp => nets.push({ ev: 'RES', url: resp.url().substring(0, 200), status: resp.status(), ts: Date.now() }));
  page.on('requestfailed', req => nets.push({ ev: 'FAIL', url: req.url().substring(0, 200), err: req.failure()?.errorText, ts: Date.now() }));
  page.on('crash', () => console.log('*** PAGE CRASHED ***'));
  page.on('close', () => console.log('*** PAGE CLOSED ***'));

  const logs = [];
  page.on('console', msg => logs.push({ txt: msg.text().substring(0, 300), ts: Date.now() }));

  console.log('Loading Orbit...');
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  for (let i = 0; i < 30; i++) {
    const d = await getDiag(page);
    if (d.portState?.status === 'ready') break;
    await page.waitForTimeout(500);
  }
  console.log('SW ready.\n');

  // Clear logs and navigate to Google
  await page.evaluate(() => navigator.serviceWorker.controller?.postMessage({ type: '__CLEAR_LOG__' })).catch(() => {});
  nets.length = 0;
  logs.length = 0;
  const navStart = Date.now();

  console.log('Navigating to https://www.google.com/ ...');
  try {
    await page.evaluate(() => {
      if (window.VoltraBrowser) window.VoltraBrowser.navigate('https://www.google.com/');
    });
  } catch(e) {
    console.log('evaluate error:', e.message.substring(0, 200));
  }

  await page.waitForTimeout(12000);

  // Try to get state
  let state = {};
  try {
    state = await page.evaluate(() => ({
      url: location.href,
      pending: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
      portReady: window.__UV_BOOT_STATUS__?.portReady,
      iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0, 120),
      iframeDoc: (() => { const f = document.getElementById('browserFrame-main'); try { return f?.contentDocument?.readyState || 'no-doc'; } catch(e) { return 'error'; } })(),
    }));
  } catch(e) {
    state = { error: e.message.substring(0, 200) };
  }
  console.log('Page state:', JSON.stringify(state));

  // Get SW logs
  const diag = await getDiag(page);
  const swLogs = diag.log || [];
  const navLogs = swLogs.filter(l => l.ts >= navStart && l.ts <= navStart + 20000);

  // Page console during nav
  const navConsole = logs.filter(l => l.ts >= navStart && l.ts <= navStart + 20000);
  const navNets = nets.filter(r => r.ts >= navStart && r.ts <= navStart + 20000);

  console.log('\n========== TIMELINE ==========');
  const all = [];
  navLogs.forEach(l => all.push({ ts: l.ts, src: 'SW', txt: `${l.msg}${l.rest.length ? ' ' + l.rest.join(' ') : ''}`.substring(0, 300) }));
  navConsole.forEach(l => all.push({ ts: l.ts, src: 'PAGE', txt: l.txt }));
  navNets.forEach(n => all.push({ ts: n.ts, src: 'NET', txt: JSON.stringify(n) }));
  all.sort((a, b) => a.ts - b.ts);
  all.forEach(e => console.log(`+${e.ts - navStart}ms [${e.src}] ${e.txt}`));

  // Summary
  console.log('\n========== STAGE ANALYSIS ==========');
  const stages = [
    ['iframe.src assigned', navConsole.some(l => l.txt.includes('[UV-ROUTE]'))],
    ['SW fetch event', navLogs.some(l => l.msg.includes('fetch #') && l.msg.includes('/service/'))],
    ['HOP 1: sw.fetch wrapper', navLogs.some(l => l.msg.includes('hop:1-sw-wrapper'))],
    ['HOP 2: UV fetch entry', navLogs.some(l => l.msg.includes('hop:2-uv-fetch-entry'))],
    ['HOP 3: BareClient fetch', navLogs.some(l => l.msg.includes('hop:3-bareClient-fetch'))],
    ['DN-SEND (SharedWorker)', navLogs.some(l => l.msg.includes('[DN-SEND]'))],
    ['DN-SEND RESOLVED', navLogs.some(l => l.msg.includes('[DN-SEND] RESOLVED'))],
    ['HOP 4: BareClient response', navLogs.some(l => l.msg.includes('hop:4-bareClient-response'))],
    ['HOP 5: UV fetch exit', navLogs.some(l => l.msg.includes('hop:5-uv-fetch-exit'))],
    ['HOP 6: sw.fetch response', navLogs.some(l => l.msg.includes('hop:6-sw-wrapper-response'))],
    ['/service/ network response', navNets.some(n => n.url.includes('/service/') && n.ev === 'RES')],
    ['iframe loaded content', state.iframeDoc === 'complete' || state.iframeDoc === 'interactive'],
  ];
  stages.forEach(([name, ok]) => console.log(`  ${ok ? '+' : '-'} ${name}`));
  const firstMiss = stages.find(([_, ok]) => !ok);
  if (firstMiss) console.log(`\n*** FIRST MISSING: ${firstMiss[0]} ***`);

  await ctx.close();
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
