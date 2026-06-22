// Reproduction: complete timing evidence for 5 questions
const WebSocket = require('ws');
const { spawn } = require('child_process');
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
    const raw = [];
    ws.on('open', () => resolve({
      ws, logs, raw,
      send: (m, p = {}) => new Promise(r => {
        let id = ++mid;
        pend[id] = r;
        ws.send(JSON.stringify({id, method: m, params: p}));
        setTimeout(() => { if(pend[id]) { delete pend[id]; r({timedout:true}); }}, 15000);
      })
    }));
    ws.on('error', reject);
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        raw.push(m);
        if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        else if(m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
          logs.push({ text: args, ts: Date.now() });
        }
      } catch(e) {}
    });
  });
}

async function main() {
  // Start the application server
  console.log('Starting application server...');
  const server = spawn('node', ['server.js'], { cwd: 'C:\\Users\\abeni\\Downloads\\orbit', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let serverErr = '';
  server.stderr.on('data', d => serverErr += d.toString());
  await sleep(3000);

  // Verify server is up
  for(let i=0;i<10;i++) {
    try {
      const r = await fetchJSON('http://127.0.0.1:8080/');
      console.log('Server OK');
      break;
    } catch(e) {
      console.log('Waiting for server...', i);
      await sleep(1000);
    }
  }

  const PORT = 9231;
  try {
    const v = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`);
    if(v) {
      const targets = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
      targets.forEach(t => {
        try { http.get('http://127.0.0.1:'+PORT+'/json/close/'+t.id); } catch(e) {}
      });
      await sleep(1000);
    }
  } catch(e) {}

  console.log('Starting Chrome...');
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let v; for(let i=0;i<30;i++) { try { v = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch(e) { await sleep(1000); } }
  if (!v) { console.log('Chrome not ready'); chrome.kill(); return; }
  console.log('Chrome version:', v.Browser);

  let pt; for(let i=0;i<20;i++) { await sleep(500); try { const t = await fetchJSON(`http://127.0.0.1:${PORT}/json`); pt = t.find(x => x.type === 'page'); if(pt) break; } catch(e) {} }
  if (!pt) { console.log('No page target'); chrome.kill(); return; }
  console.log('Page target:', pt.url);

  // Connect page
  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.setLifecycleEventsEnabled', { enabled: true });

  // Navigate to app
  console.log('Navigating to http://127.0.0.1:8080/ ...');
  let nav = await cdp.send('Page.navigate', { url: 'http://127.0.0.1:8080/' });
  console.log('Navigation result:', JSON.stringify(nav));

  // Wait for page to fully load (listen for lifecycle events)
  console.log('Waiting for page load...');
  let reached = false;
  for(let i=0;i<120;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:`
      (function(){
        var s = window.__UV_BOOT_STATUS__;
        return JSON.stringify({readyState: document.readyState, hasUV: !!s, logLen: s && s._log ? s._log.length : 0});
      })()
    `, returnByValue: true});
    if(r && r.result && r.result.result) {
      const data = r.result.result.value;
      if(typeof data === 'string' && data.includes('"logLen":')) {
        const parsed = JSON.parse(data);
        if(parsed.readyState === 'complete' && parsed.hasUV) { reached = true; break; }
        if(i < 5 || i % 10 === 0) console.log('  page status:', parsed.readyState, 'UV:', parsed.hasUV, 'logLen:', parsed.logLen);
      }
    }
    await sleep(500);
  }
  if(!reached) console.log('  (wait timed out, continuing anyway)');

  // Wait for UV boot
  for(let i=0;i<20;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:`typeof window.__UV_BOOT_STATUS__ !== 'undefined' && window.__UV_BOOT_STATUS__._log.length`, returnByValue: true});
    if(r && r.result && r.result.result && typeof r.result.result.value === 'number' && r.result.result.value > 0) break;
    await sleep(500);
  }
  
  // Check current URL and page state
  const urlCheck = await cdp.send('Runtime.evaluate', {expression:`location.href`, returnByValue: true});
  console.log('Current URL:', urlCheck && urlCheck.result && urlCheck.result.result ? urlCheck.result.result.value : 'unknown');

  const bootLogs = await cdp.send('Runtime.evaluate', {expression:`
    (function(){
      var s = window.__UV_BOOT_STATUS__;
      return s && s._log ? JSON.stringify(s._log) : 'no_log';
    })()
  `, returnByValue: true});
  const bootStr = bootLogs && bootLogs.result && bootLogs.result.result ? bootLogs.result.result.value : 'none';
  console.log('Boot log length:', typeof bootStr === 'string' ? bootStr.length : bootStr);

  // ============================================================
  // CONNECT SW
  // ============================================================
  await sleep(1000);
  let sw = null;
  for(let i=0;i<20;i++) {
    try {
      const targets = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
      const swt = targets.find(t => t.type === 'service_worker');
      if (swt) {
        console.log('SW target found:', swt.url);
        const wssw = new WebSocket(swt.webSocketDebuggerUrl);
        const swLogs = [];
        const swRaw = [];
        await new Promise((res, rej) => { wssw.on('open', res); wssw.on('error', rej); });
        wssw.on('message', d => {
          try {
            const m = JSON.parse(d.toString());
            swRaw.push(m);
            if(m.method === 'Runtime.consoleAPICalled') {
              const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
              swLogs.push({ text: args, ts: Date.now() });
            }
          } catch(e) {}
        });
        wssw.on('error', () => {});
        wssw.send(JSON.stringify({id:1,method:'Runtime.enable',params:{}}));
        sw = { ws: wssw, logs: swLogs, raw: swRaw, close: () => { try { wssw.close(); } catch(e) {} } };
        console.log('SW connected');
        break;
      }
    } catch(e) {}
    await sleep(500);
  }

  // ============================================================
  // SETUP: Inject 2 persisted tabs
  // ============================================================
  console.log('\n=== SETUP: Inject persisted tabs ===');
  
  const inject = await cdp.send('Runtime.evaluate', {expression: `
    (function(){
      try {
        localStorage.setItem('voltra-browser-tabs', JSON.stringify({
          tabs: {
            'tab-1': { id: 'tab-1', url: 'https://www.google.com', title: 'Google' },
            'tab-2': { id: 'tab-2', url: 'https://www.wikipedia.org', title: 'Wikipedia' }
          },
          activeTabId: 'tab-1',
          tabCounter: 2
        }));
        return 'OK: ' + localStorage.getItem('voltra-browser-tabs');
      } catch(e) { return 'ERROR: ' + e.message; }
    })()
  `});
  const injectResult = inject && inject.result && inject.result.result ? inject.result.result.value : JSON.stringify(inject);
  console.log('Inject result:', injectResult);

  // ============================================================
  // STEP 1: Reload page
  // ============================================================
  console.log('\n=== STEP 1: Reload ===');
  
  cdp.logs.length = 0;
  if (sw) sw.logs.length = 0;
  
  await cdp.send('Runtime.evaluate', {expression: 'location.href = location.href'});
  
  // Wait for reload to start and page to reload
  await sleep(2000);

  let reached2 = false;
  for(let i=0;i<120;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:`
      (function(){
        var s = window.__UV_BOOT_STATUS__;
        return JSON.stringify({readyState: document.readyState, hasUV: !!s, logLen: s && s._log ? s._log.length : 0, url: location.href});
      })()
    `, returnByValue: true});
    if(r && r.result && r.result.result) {
      const data = r.result.result.value;
      if(typeof data === 'string' && data.includes('"logLen":')) {
        const parsed = JSON.parse(data);
        if(i < 3 || i % 10 === 0) console.log('  page status:', parsed.readyState, 'UV:', parsed.hasUV, 'logLen:', parsed.logLen, parsed.url);
        if(parsed.readyState === 'complete' && parsed.hasUV) { reached2 = true; break; }
      }
    }
    await sleep(500);
  }
  console.log('Page reloaded and ready:', reached2);

  const url2 = await cdp.send('Runtime.evaluate', {expression:`location.href`, returnByValue: true});
  console.log('URL after reload:', url2 && url2.result && url2.result.result ? url2.result.result.value : 'unknown');

  // ============================================================
  // STEP 2: Open browser section (WITHOUT waiting for portReady)
  // ============================================================
  console.log('\n=== STEP 2: Open browser section (no portReady wait) ===');
  
  const lSection = await cdp.send('Runtime.evaluate', {expression: `
    (function(){
      if(typeof loadSection === 'function') {
        loadSection('browser');
        return 'loadSection called';
      }
      return 'loadSection not found';
    })()
  `});
  const lsResult = lSection && lSection.result && lSection.result.result ? lSection.result.result.value : 'unknown';
  console.log('loadSection result:', lsResult);

  // Wait for things to settle
  await sleep(8000);

  // Check if port got ready
  const uvState = await cdp.send('Runtime.evaluate', {expression:`
    (function(){
      var s = window.__UV_BOOT_STATUS__;
      if(!s) return 'no boot status';
      return JSON.stringify({
        portReady: s.portReady,
        bareMuxReady: s.bareMuxReady,
        swPortStatus: s.swPortStatus,
        logLen: s._log ? s._log.length : 0,
        log: s._log ? s._log.slice(-10) : []
      });
    })()
  `});
  const uvStr = uvState && uvState.result && uvState.result.result ? uvState.result.result.value : JSON.stringify(uvState);
  console.log('UV Status:', uvStr);

  // ============================================================
  // COLLECT ALL EVIDENCE
  // ============================================================
  const swFetch = sw ? sw.logs.filter(l => l.text.includes('[SW-FETCH]')) : [];
  const swBC = sw ? sw.logs.filter(l => l.text.includes('[PORT_STATE_BROADCAST]')) : [];
  const swState = sw ? sw.logs.filter(l => l.text.includes('[STATE]')) : [];
  const swAll = sw ? sw.logs.slice() : [];
  
  const restoreLogs = cdp.logs.filter(l => l.text.includes('[RESTORE]'));
  const portSyncLogs = cdp.logs.filter(l => l.text.includes('[PORT_SYNC]'));
  const bootCdpLogs = cdp.logs.filter(l => l.text.includes('[BOOT]'));
  const recoveryLogs = cdp.logs.filter(l => l.text.includes('[RECOVERY]'));

  console.log('\n============ SECTION A: [SW-FETCH] ============');
  swFetch.forEach(l => console.log('  ', l.text));

  console.log('\n============ SECTION B: [PORT_STATE_BROADCAST] ============');
  swBC.forEach(l => console.log('  ', l.text));

  console.log('\n============ SECTION C: [PORT_SYNC] ============');
  portSyncLogs.forEach(l => console.log('  ', l.text));

  console.log('\n============ SECTION D: [RESTORE] ============');
  restoreLogs.forEach(l => console.log('  ', l.text));

  // ============================================================
  // CHRONOLOGICAL TIMELINE
  // ============================================================
  console.log('\n============ CHRONOLOGICAL TIMELINE ============');
  const allEvents = [];
  swAll.forEach(l => allEvents.push({ ts: l.ts, text: l.text, source: 'SW' }));
  cdp.logs.forEach(l => {
    if (l.text.includes('[RESTORE]') || l.text.includes('[PORT_SYNC]') || l.text.includes('[BOOT]') || l.text.includes('[RECOVERY]')) {
      allEvents.push({ ts: l.ts, text: l.text, source: 'PAGE' });
    }
  });
  allEvents.sort((a, b) => a.ts - b.ts);
  if (allEvents.length > 0) {
    const base = allEvents[0].ts;
    allEvents.forEach(e => {
      console.log('  +' + String(e.ts - base).padStart(8) + 'ms [' + e.source + '] ' + e.text.substring(0, 300));
    });
  }

  console.log('\n============ SW RAW LOGS (first 20) ============');
  if (sw) sw.logs.slice(0, 20).forEach(l => console.log('  ', l.text));
  
  console.log('\n============ PAGE RAW LOGS (first 20) ============');
  cdp.logs.slice(0, 20).forEach(l => console.log('  ', l.text));

  // Check iframe
  const src = await cdp.send('Runtime.evaluate', {expression:`
    (function() {
      try {
        var tb = document.getElementById('tab-1');
        if(tb) return 'tab-1 element: ' + (tb.src || tb.href || 'no src');
        return 'no tab-1 element';
      } catch(e) { return 'error: ' + e.message; }
    })()
  `, returnByValue: true});
  const srcVal = src && src.result && src.result.result ? src.result.result.value : 'null';
  console.log('\nIframe/tab element:', srcVal);

  if (sw) sw.close();
  chrome.kill();
  server.kill();
  setTimeout(() => process.exit(0), 500);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
