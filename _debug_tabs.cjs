// Test: verify restored tabs trigger SW fetch events
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

async function main() {
  const PORT = 9231;
  try { await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); await fetchJSON(`http://127.0.0.1:${PORT}/json/close`); await sleep(1000); } catch(e) {}

  console.log('Starting Chrome...');
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', 'http://localhost:8080/'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let v; for(let i=0;i<30;i++) { try { v = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch(e) { await sleep(1000); } }
  if (!v) { console.log('Chrome fail'); chrome.kill(); return; }

  let pt; for(let i=0;i<20;i++) { await sleep(500); try { const t = await fetchJSON(`http://127.0.0.1:${PORT}/json`); pt = t.find(x => x.type === 'page'); if(pt) break; } catch(e) {} }
  if (!pt) { console.log('No page'); chrome.kill(); return; }

  // Connect page + SW ONE time, keep both alive across reload
  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.runIfWaitingForDebugger');
  
  let sw = await connectSW(PORT);
  console.log('Page CDP + SW connected:', !!sw);
  await sleep(3000);

  // -------------------------------------------------
  // PHASE 1: Set up persisted tabs in localStorage
  // -------------------------------------------------
  console.log('\n=== PHASE 1: Set up persisted tabs ===');
  
  // Use a simple expression to build and set the localStorage item
  await cdp.send('Runtime.evaluate', {expression: `
    localStorage.setItem('voltra-browser-tabs', JSON.stringify({
      tabs: {
        'tab-1': { id: 'tab-1', url: 'https://example.com', title: 'Example Domain' },
        'tab-2': { id: 'tab-2', url: 'http://example.net', title: 'Example' }
      },
      activeTabId: 'tab-1',
      tabCounter: 2
    }));
  `});
  
  const lsCheck = await cdp.send('Runtime.evaluate', {expression: `localStorage.getItem('voltra-browser-tabs')`, returnByValue: true});
  console.log('localStorage has tabs:', lsCheck && lsCheck.result && lsCheck.result.result ? 'YES ('+lsCheck.result.result.value.length+' chars)' : 'NO');

  // -------------------------------------------------
  // PHASE 2: Reload and observe restoration
  // -------------------------------------------------
  console.log('\n=== PHASE 2: Reload with persisted tabs ===');
  
  // Clear logs
  cdp.logs.length = 0;
  if (sw) sw.logs.length = 0;
  
  await cdp.send('Runtime.evaluate', {expression: 'location.reload()'});
  await sleep(2000);

  // Wait for page init
  for(let i=0;i<30;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"', returnByValue: true});
    if(r && r.result && r.result.result && r.result.result.value === true) {
      console.log('Page ready at', (i+1)*500, 'ms');
      break;
    }
    await sleep(500);
  }
  
  // Poll portReady
  for(let i=0;i<20;i++) {
    await sleep(500);
    const pr = await cdp.send('Runtime.evaluate', {expression:'window.__UV_BOOT_STATUS__&&window.__UV_BOOT_STATUS__.portReady', returnByValue: true});
    if(pr && pr.result && pr.result.result && pr.result.result.value === true) {
      console.log('portReady at', (i+1)*500, 'ms');
      break;
    }
  }

  // Render browser (triggers tab restoration)
  console.log('\n--- loadSection("browser") ---');
  await cdp.send('Runtime.evaluate', {expression: 'if(typeof loadSection==="function")loadSection("browser")'});
  await sleep(4000);

  // -------------------------------------------------
  // COLLECT EVIDENCE
  // -------------------------------------------------
  console.log('\n=== EVIDENCE ===');

  const restoreLogs = cdp.logs.filter(l => l.text.includes('[RESTORE]'));
  console.log('\n[RESTORE] from page:', restoreLogs.length);
  restoreLogs.forEach(l => console.log('  ', l.text));

  const bootLogs = cdp.logs.filter(l => l.text.includes('[BOOT]') || l.text.includes('[PORT_SYNC]'));
  console.log('\n[BOOT/PORT_SYNC] from page:', bootLogs.length);
  bootLogs.forEach(l => console.log('  ', l.text));

  if (sw) {
    const swFetch = sw.logs.filter(l => l.text.includes('[SW-FETCH]'));
    console.log('\n[SW-FETCH] from SW:', swFetch.length);
    swFetch.forEach(l => console.log('  ', l.text));
    
    const swState = sw.logs.filter(l => l.text.includes('[STATE]'));
    console.log('\n[STATE] from SW:', swState.length);
    swState.forEach(l => console.log('  ', l.text));
    
    const swBC = sw.logs.filter(l => l.text.includes('[PORT_STATE_BROADCAST]'));
    console.log('\n[PORT_STATE_BROADCAST] from SW:', swBC.length);
    swBC.forEach(l => console.log('  ', l.text));
  }

  // iframe source
  const src = await cdp.send('Runtime.evaluate', {expression:`
    (function() {
      try {
        var tab = window.VoltraBrowser._browserUI.tabManager.getActiveTab();
        if(!tab) return 'no tab';
        var f = document.getElementById('browserFrame-' + tab.id);
        return f ? f.src : 'no iframe';
      } catch(e) { return 'error: ' + e.message; }
    })()
  `, returnByValue: true});
  const srcVal = src && src.result && src.result.result ? src.result.result.value : 'null';
  const hasService = srcVal.includes('/service/');
  console.log('\nIframe src:', srcVal);
  console.log('Has /service/:', hasService);

  // Tab count
  const tabsCheck = await cdp.send('Runtime.evaluate', {expression:'Object.keys(window.VoltraBrowser._browserUI.tabManager.tabs).length', returnByValue: true});
  console.log('Tab count:', tabsCheck ? tabsCheck.result?.result?.value : 'null');

  // Boot status log
  const bs = await cdp.send('Runtime.evaluate', {expression:'JSON.stringify(window.__UV_BOOT_STATUS__._log)', returnByValue: true});
  if (bs && bs.result && bs.result.result) {
    console.log('\n=== Boot log ===');
    const parsed = JSON.parse(bs.result.result.value);
    const filtered = parsed.filter(e => ['bareMuxPathSet','DCLfired','getPortListenerRegistered','swReady','swSynced','portReady','swPortStatus','swPortStateSync','swReinitCount','portRequestReceived','workerConstructed','portTransferred','bareMuxReady'].includes(e.key));
    filtered.forEach(e => console.log('  ['+e.key+'] =', e.val, 'at', e.at));
  }

  if (sw) sw.close();
  chrome.kill();
  setTimeout(() => process.exit(0), 500);
}

main().catch(e => { console.error('ERROR:', e); process.exit(1); });
