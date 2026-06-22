// Clean reproduction: port readiness vs tab restoration timing
const WebSocket = require('ws');
const { spawn, execSync } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {};
    const logs = [];
    ws.on('open', () => resolve({
      ws, logs,
      send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r(null); }}, 10000); })
    }));
    ws.on('error', reject);
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        else if(m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
          logs.push({ text: args, ts: Date.now() });
        }
      } catch(e) {}
    });
  });
}

async function connectSW(debugPort) {
  for(let i=0;i<20;i++) {
    try {
      const targets = await fetchJSON(`http://127.0.0.1:${debugPort}/json`);
      const swTarget = targets.find(t => t.type === 'service_worker');
      if (swTarget) {
        const ws = new WebSocket(swTarget.webSocketDebuggerUrl);
        const logs = [];
        await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
        ws.on('message', d => {
          try {
            const m = JSON.parse(d.toString());
            if(m.method === 'Runtime.consoleAPICalled') {
              const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
              logs.push({ text: args, ts: Date.now() });
            }
          } catch(e) {}
        });
        ws.send(JSON.stringify({id:1,method:'Runtime.enable',params:{}}));
        return { ws, logs, close: () => { try { ws.close(); } catch(e) {} } };
      }
    } catch(e) {}
    await sleep(500);
  }
  return null;
}

function evalValue(r) { if(!r||!r.result||!r.result.result)return undefined; return r.result.result.value; }

async function main() {
  const CDP_PORT = 9235;

  // Kill Chrome on port
  try { await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json/close`); await sleep(500); } catch(e) {}

  // Start server if needed
  let svr;
  try { await fetchJSON('http://localhost:8080/'); } catch(e) {
    const { spawn: spawn2 } = require('child_process');
    svr = spawn2('node', ['server.js'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    await sleep(2000);
  }

  console.log('=== CLEAN REPRODUCTION: TIMING RACE ===\n');
  console.log('[SETUP] Starting Chrome (no user data dir, default profile)...');

  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
    'http://localhost:8080/'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let v;
  for(let i=0;i<30;i++) { try { v = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch(e) { await sleep(1000); } }
  if (!v) { console.log('Chrome fail'); if(svr)svr.kill(); process.exit(1); }
  console.log('Chrome:', v.Browser);

  let pt;
  for(let i=0;i<20;i++) { await sleep(500); try { const t = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page'); if(pt) break; } catch(e) {} }
  if (!pt) { console.log('No page'); chrome.kill(); if(svr)svr.kill(); process.exit(1); }

  // Connect page + SW one time, keep alive across reload
  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.runIfWaitingForDebugger');

  let sw = await connectSW(CDP_PORT);
  console.log('Page CDP + SW connected:', !!sw);
  await sleep(3000);

  // ============================================================
  // PHASE 1: Set up persisted tabs (Google, Wikipedia)
  // ============================================================
  console.log('\n=== PHASE 1: Set up persisted tabs ===');

  // Clear localStorage then set 2 tabs
  await cdp.send('Runtime.evaluate', {expression: `
    localStorage.removeItem('voltra-browser-tabs');
    localStorage.setItem('voltra-browser-tabs', JSON.stringify({
      tabs: {
        'tab-1': { id: 'tab-1', url: 'https://www.google.com', title: 'Google' },
        'tab-2': { id: 'tab-2', url: 'https://www.wikipedia.org', title: 'Wikipedia' }
      },
      activeTabId: 'tab-1',
      tabCounter: 2
    }));
  `});

  const lsCheck = await cdp.send('Runtime.evaluate', {expression: `localStorage.getItem('voltra-browser-tabs')`, returnByValue: true});
  const lsExists = lsCheck && lsCheck.result && lsCheck.result.result;
  console.log('localStorage tabs set:', lsExists ? 'YES ('+String(lsCheck.result.result.value).length+' chars)' : 'NO');

  // ============================================================
  // PHASE 2: Reload — triggers tab restoration race
  // ============================================================
  console.log('\n=== PHASE 2: Reload (triggers SW recovery + restoration race) ===');

  // Clear logs
  cdp.logs.length = 0;
  if (sw) sw.logs.length = 0;

  await cdp.send('Runtime.evaluate', {expression: 'location.reload()'});
  await sleep(2000);

  // Wait for page init
  for(let i=0;i<30;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"', returnByValue: true});
    if(evalValue(r) === true) { console.log('Page ready at', (i+1)*500, 'ms'); break; }
    await sleep(500);
  }

  // ============================================================
  // PHASE 3: Open browser section IMMEDIATELY — right after boot, before port recovery
  // This simulates user clicking "browser" as soon as the page loads
  // ============================================================
  console.log('\n--- loadSection("browser") (IMMEDIATE) ---\n');

  // Clear logs right before
  cdp.logs.length = 0;
  if (sw) sw.logs.length = 0;

  await cdp.send('Runtime.evaluate', {expression: 'if(typeof loadSection==="function")loadSection("browser")'});
  await sleep(8000);

  // Reconnect to SW if needed
  if (!sw || !sw.ws || sw.ws.readyState !== 1) {
    if (sw) { try { sw.close(); } catch(e) {} }
    sw = null;
    for(let i=0;i<10;i++) {
      sw = await connectSW(CDP_PORT);
      if (sw) break;
      await sleep(500);
    }
  }

  // ============================================================
  // COLLECT EVIDENCE
  // ============================================================
  console.log('=== EVIDENCE ===\n');

  // A: PORT_STATE_CHANGE (from SW Proxy)
  const psc = sw ? sw.logs.filter(l => l.text.includes('[PORT_STATE_CHANGE]')) : [];
  console.log('--- A: PORT_STATE_CHANGE (from SW Proxy) ---');
  psc.forEach(l => console.log('  ', l.text));
  console.log('');

  // B: PORT_STATE_BROADCAST (from SW)
  const psb = sw ? sw.logs.filter(l => l.text.includes('[PORT_STATE_BROADCAST]')) : [];
  console.log('--- B: PORT_STATE_BROADCAST (from SW) ---');
  psb.forEach(l => console.log('  ', l.text));
  console.log('');

  // C: PORT_SYNC (from page)
  const portSync = cdp.logs.filter(l => l.text.includes('[PORT_SYNC]'));
  console.log('--- C: PORT_SYNC (from page) ---');
  portSync.forEach(l => console.log('  ', l.text));
  console.log('');

  // D: RESTORE (from page)
  const restore = cdp.logs.filter(l => l.text.includes('[RESTORE]'));
  console.log('--- D: RESTORE (from page) ---');
  restore.forEach(l => console.log('  ', l.text));
  console.log('');

  // E: SW_FETCH (from SW)
  const swFetch = sw ? sw.logs.filter(l => l.text.includes('[SW-FETCH]')) : [];
  console.log('--- E: SW_FETCH (from SW) ---');
  swFetch.forEach(l => console.log('  ', l.text));
  console.log('');

  // F: DEFER (from page)
  const defer = cdp.logs.filter(l => l.text.includes('[DEFER]'));
  console.log('--- F: DEFER (from page) ---');
  defer.forEach(l => console.log('  ', l.text));
  console.log('');

  // G: PROCESS-PENDING (from page)
  const pp = cdp.logs.filter(l => l.text.includes('[PROCESS-PENDING]'));
  console.log('--- G: PROCESS-PENDING (from page) ---');
  pp.forEach(l => console.log('  ', l.text));
  console.log('');

  // H: PORT_READY (from page)
  const pr = cdp.logs.filter(l => l.text.includes('[PORT_READY]'));
  console.log('--- H: PORT_READY (from page) ---');
  pr.forEach(l => console.log('  ', l.text));
  console.log('');

  // I: STATE (from SW)
  const state = sw ? sw.logs.filter(l => l.text.includes('[STATE]')) : [];
  console.log('--- I: STATE (from SW) ---');
  state.forEach(l => console.log('  ', l.text));
  console.log('');

  // MERGED TIMELINE
  console.log('=== MERGED TIMELINE (ordered) ===');
  const all = [];
  (sw ? sw.logs : []).forEach(l => {
    if (l.text.includes('[PORT_STATE_CHANGE]') || l.text.includes('[PORT_STATE_BROADCAST]') ||
        l.text.includes('[SW-FETCH]') || l.text.includes('[STATE]')) {
      all.push({ ts: l.ts, text: l.text, source: 'SW' });
    }
  });
  cdp.logs.forEach(l => {
    if (l.text.includes('[PORT_SYNC]') || l.text.includes('[RESTORE]') ||
        l.text.includes('[DEFER]') || l.text.includes('[PROCESS-PENDING]') ||
        l.text.includes('[PORT_READY]')) {
      all.push({ ts: l.ts, text: l.text, source: 'PAGE' });
    }
  });
  all.sort((a,b) => a.ts - b.ts);
  if (all.length > 0) {
    const first = all[0].ts;
    all.forEach(e => console.log('  +' + String(e.ts - first).padStart(7) + 'ms [' + e.source + '] ' + e.text));
  } else {
    console.log('  (no events)');
  }

  // ANSWERS
  console.log('\n=== ANSWERS ===');

  // 1. First pending→ready
  const p2r = psc.filter(l => l.text.includes('oldValue: pending') && l.text.includes('newValue: ready'));
  console.log('1. First pending→ready:', p2r.length ? p2r[0].text : 'N/A');

  // 2. First ready→failed  
  const r2f = psc.filter(l => l.text.includes('oldValue: ready') && l.text.includes('newValue: failed'));
  console.log('2. First ready→failed:', r2f.length ? r2f[0].text : 'N/A');

  // 3. portReady:true broadcasts
  const prt = psb.filter(l => l.text.includes('portReady: true'));
  console.log('3. portReady:true broadcasts:', prt.length);
  prt.forEach(l => console.log('   ', l.text));

  // 4. First /service/ request vs first ready
  const ff = swFetch.length ? swFetch[0] : null;
  const fr = p2r.length ? p2r[0] : null;
  if (ff && fr) {
    console.log('4. First SW-FETCH BEFORE ready:', ff.ts < fr.ts ? 'YES — RACE CONFIRMED' : 'NO');
  } else {
    console.log('4. Insufficient data: fetch=' + !!ff + ' ready=' + !!fr);
  }

  // 5. 50x responses
  const bad = swFetch.filter(l => l.text.includes('responseStatus: 50'));
  console.log('5. 50x responses:', bad.length);
  bad.forEach(l => console.log('   ', l.text));

  // 6. All SW logs not shown above
  const otherSW = sw ? sw.logs.filter(l => {
    return !l.text.includes('[PORT_STATE_CHANGE]') && !l.text.includes('[PORT_STATE_BROADCAST]') &&
           !l.text.includes('[SW-FETCH]') && !l.text.includes('[STATE]');
  }) : [];
  console.log('6. Other SW logs:', otherSW.length);
  // Only show boot and diagnostic logs (skip verbose fetch traces)
  otherSW.filter(l => !l.text.includes('[HOP]')).forEach(l => console.log('   ', l.text));

  // 7. HOP trace (per-hop failure tracing)
  const hops = sw ? sw.logs.filter(l => l.text.includes('[HOP]')) : [];
  console.log('\n--- 7: HOP TRACE (per-hop) ---');
  if (hops.length > 0) {
    const hopFirst = hops[0].ts;
    hops.forEach(l => {
      const rel = '+' + String(l.ts - hopFirst).padStart(7) + 'ms';
      console.log('  ', rel, l.text);
    });
  } else {
    console.log('  (no HOP events recorded)');
  }

  // 8. FAIL events (non-200 responses with decoded URLs)
  const fails = hops.filter(l => l.text.includes('[HOP] FAIL') || (l.text.includes('[HOP]') && l.text.includes('status: 5')));
  console.log('\n--- 8: FAILURE ANALYSIS ---');
  if (fails.length > 0) {
    // Build failure table
    console.log('\nFAILURE TABLE:');
    console.log('Status  | URL (decoded)');
    console.log('--------|----------------------------------------');
    fails.forEach(l => {
      const m = l.text.match(/status:\s*(\d+)/);
      const status = m ? m[1] : '?';
      const decM = l.text.match(/decoded:\s*(\S+)/);
      const decoded = decM ? decM[1] : '(unknown)';
      console.log(status.padStart(6), '|', decoded);
    });

    // Counts
    const count500 = fails.filter(l => l.text.includes('status: 500') || l.text.includes('status:502')).length;
    console.log('\nTotal failing responses:', fails.length);

    // Top failing decoded URLs
    const urlCounts = {};
    fails.forEach(l => {
      const decM = l.text.match(/decoded:\s*(\S+)/);
      const decoded = decM ? decM[1] : '(unknown)';
      urlCounts[decoded] = (urlCounts[decoded] || 0) + 1;
    });
    const sorted = Object.entries(urlCounts).sort((a,b) => b[1] - a[1]);
    console.log('Top failing URLs (decoded):');
    sorted.slice(0, 10).forEach(([url, count], i) => {
      console.log('  ' + (i+1) + '. [' + count + 'x] ' + url.substring(0, 200));
    });
  } else {
    console.log('  (no failure events)');
  }

  // Cleanup
  if (sw) sw.close();
  cdp.ws.close();
  chrome.kill();
  if (svr) svr.kill();
  console.log('\nDone');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
