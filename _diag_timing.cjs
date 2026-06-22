// Diagnostic v2: trace port readiness vs tab restoration timing
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

function evalValue(r) { if(!r||!r.result||!r.result.result)return undefined; return r.result.result.value; }

function captureConsole(cdp) {
  const logs = [];
  cdp.ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if(m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
        logs.push({ text: args, ts: Date.now() });
      }
    } catch(e) {}
  });
  cdp.send('Runtime.enable', {});
  return logs;
}

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {};
    ws.on('open', () => resolve({
      ws, send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r(null); }}, 15000); })
    }));
    ws.on('error', reject);
    ws.on('close', () => { for(const k of Object.keys(pend)) pend[k](null); });
    ws.on('message', d => { try { const m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch(e) {} });
  });
}

function connectSW(debugPort) {
  return new Promise(async (resolve) => {
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
          resolve({ ws, logs, close: () => { try { ws.close(); } catch(e) {} } });
          return;
        }
      } catch(e) {}
      await sleep(500);
    }
    resolve(null);
  });
}

function formatTimeline(pageLogs, swLogs) {
  const entries = [];
  pageLogs.forEach(l => entries.push({ ts: l.ts, text: l.text, source: 'PAGE' }));
  swLogs.forEach(l => entries.push({ ts: l.ts, text: l.text, source: 'SW' }));
  entries.sort((a, b) => a.ts - b.ts);
  if (entries.length === 0) return '  (no events)';
  const base = entries[0].ts;
  return entries.map(e => '  +' + String(e.ts - base).padStart(6) + 'ms [' + e.source + '] ' + e.text).join('\n');
}

async function main() {
  const PORT = 9231;
  try { await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); await fetchJSON(`http://127.0.0.1:${PORT}/json/close`); await sleep(1000); } catch(e) {}

  console.log('=== ORBIT TIMING DIAGNOSTIC v2 ===\n');
  
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', 'http://localhost:8080/'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let v; for(let i=0;i<30;i++) { try { v = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch(e) { await sleep(1000); } }
  if (!v) { console.log('Chrome fail'); chrome.kill(); process.exit(1); }

  let pt; for(let i=0;i<20;i++) { await sleep(500); try { const t = await fetchJSON(`http://127.0.0.1:${PORT}/json`); pt = t.find(x => x.type === 'page'); if (pt) break; } catch(e) {} }
  if (!pt) { console.log('No page target'); chrome.kill(); process.exit(1); }

  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  const pageLogs = captureConsole(cdp);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.runIfWaitingForDebugger');
  await sleep(2000);

  let sw = await connectSW(PORT);
  console.log('SW connected:', !!sw);

  // ============================================================
  // PHASE 1: Fresh load — clear, reload, render browser
  // ============================================================
  console.log('\n=== PHASE 1: FRESH LOAD ===\n');

  // Clear localStorage + fresh load
  await cdp.send('Runtime.evaluate', { expression: 'localStorage.clear(); location.reload();' });
  await sleep(5000);

  // Reconnect SW after reload
  if (sw) sw.close();
  sw = await connectSW(PORT);
  console.log('SW reconnected:', !!sw);
  await sleep(2000);

  // Verify app loaded
  for(let i=0;i<30;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"', returnByValue: true});
    if(evalValue(r) === true) { console.log('App ready'); break; }
    await sleep(500);
  }

  // Load browser section
  pageLogs.length = 0;
  if (sw) sw.logs.length = 0;
  console.log('\n-- Calling loadSection("browser") --');
  await cdp.send('Runtime.evaluate', { expression: `(function(){ if(typeof loadSection==='function'){loadSection('browser');return 'ok'} return 'nope'; })()` });
  await sleep(3000);

  // Collect phase 1 logs
  const p1SW = sw ? sw.logs.filter(l => l.text.includes('[SW-FETCH]') || l.text.includes('[PORT_STATE_BROADCAST]') || l.text.includes('[STATE]')) : [];
  const p1Page = pageLogs.filter(l => l.text.includes('[RESTORE]') || l.text.includes('[BOOT]') || l.text.includes('[PORT_SYNC]'));
  console.log('Phase 1 SW events:', p1SW.length, '| Page events:', p1Page.length);
  p1SW.forEach(l => console.log('  [SW]', l.text));
  p1Page.forEach(l => console.log('  [PAGE]', l.text));

  const p1_iframe = evalValue(await cdp.send('Runtime.evaluate', {expression:'(function(){var t=window.VoltraBrowser&&window.VoltraBrowser._browserUI&&window.VoltraBrowser._browserUI.tabManager.getActiveTab();if(!t)return"no tab";var f=document.getElementById("browserFrame-"+t.id);return f?f.src:"no iframe"})()', returnByValue: true}));
  console.log('Iframe src:', p1_iframe);

  // ============================================================
  // PHASE 2: Create persisted state
  // ============================================================
  console.log('\n=== PHASE 2: CREATE PERSISTED STATE ===\n');

  // Navigate tab 1
  await cdp.send('Runtime.evaluate', {expression:'(function(){var ui=window.VoltraBrowser._browserUI;if(ui)ui._loadUrlInActiveTab("https://example.com")})()'});
  await sleep(3000);

  // Add tab 2 + navigate
  await cdp.send('Runtime.evaluate', {expression:'(function(){var ui=window.VoltraBrowser._browserUI;if(!ui)return;ui.addTab();var tab=ui.tabManager.getActiveTab();if(tab)ui._loadUrlInActiveTab("http://example.net")})()'});
  await sleep(3000);

  // Persist
  await cdp.send('Runtime.evaluate', {expression:'window.VoltraBrowser._browserUI.tabManager._persist()'});
  const tabCount = evalValue(await cdp.send('Runtime.evaluate', {expression:'Object.keys(window.VoltraBrowser._browserUI.tabManager.tabs).length', returnByValue: true}));
  console.log('Tabs persisted:', tabCount);

  // ============================================================
  // PHASE 3: Reload with restored tabs
  // ============================================================
  console.log('\n=== PHASE 3: RELOAD WITH RESTORED TABS ===\n');

  // Store SW logs before closing
  if (sw) sw.close();

  // Reload
  pageLogs.length = 0;
  await cdp.send('Runtime.evaluate', { expression: 'location.reload();' });
  await sleep(5000);

  // Reconnect SW — retry aggressively
  sw = null;
  for(let i=0;i<10 && !sw;i++) { sw = await connectSW(PORT); if(!sw) await sleep(1000); }
  console.log('SW reconnected:', !!sw);
  if (!sw) { console.log('FATAL: could not reconnect to SW'); chrome.kill(); process.exit(1); }
  await sleep(2000);

  // Wait for app
  for(let i=0;i<30;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"', returnByValue: true});
    if(evalValue(r) === true) { console.log('App ready after reload'); break; }
    await sleep(500);
  }

  // Wait for port readiness — poll up to 15s
  for(let i=0;i<15;i++) {
    await sleep(1000);
    const pr = evalValue(await cdp.send('Runtime.evaluate', {expression:'window.__UV_BOOT_STATUS__&&window.__UV_BOOT_STATUS__.portReady', returnByValue: true}));
    console.log('  portReady check #'+(i+1)+':', pr);
    if (pr === true) break;
  }

  // Load browser section (triggers tab restoration)
  console.log('\n-- Calling loadSection("browser") on reloaded page --');
  if (sw) sw.logs.length = 0;
  pageLogs.length = 0;
  await cdp.send('Runtime.evaluate', { expression: `(function(){ if(typeof loadSection==='function'){loadSection('browser');return 'ok'} return 'nope'; })()` });
  await sleep(4000);

  // Collect phase 3 logs
  const p3SW = sw ? sw.logs.filter(l =>
    l.text.includes('[SW-FETCH]') || l.text.includes('[PORT_STATE_BROADCAST]') || l.text.includes('[STATE]')
  ) : [];
  const p3Page = pageLogs.filter(l =>
    l.text.includes('[RESTORE]') || l.text.includes('[BOOT]') || l.text.includes('[PORT_SYNC]')
  );
  console.log('Phase 3 SW events:', p3SW.length);
  p3SW.forEach(l => console.log('  [SW]', l.text));
  console.log('Phase 3 page events:', p3Page.length);
  p3Page.forEach(l => console.log('  [PAGE]', l.text));

  const p3_iframe = evalValue(await cdp.send('Runtime.evaluate', {expression:'(function(){var t=window.VoltraBrowser&&window.VoltraBrowser._browserUI&&window.VoltraBrowser._browserUI.tabManager.getActiveTab();if(!t)return"no tab";var f=document.getElementById("browserFrame-"+t.id);return f?f.src:"no iframe"})()', returnByValue: true}));
  console.log('Iframe src after restore:', p3_iframe);

  // 503 analysis
  const p3_503s = p3SW.filter(l => l.text.includes('503'));
  const p3_oks = p3SW.filter(l => l.text.includes('origFetch-ok') && !l.text.includes('503'));
  console.log('\nPhase 3 503s:', p3_503s.length);
  p3_503s.forEach(l => console.log('  ', l.text));
  console.log('Phase 3 OK:', p3_oks.length);

  // Full timeline
  console.log('\n=== CORRELATED TIMELINE ===');
  console.log(formatTimeline(p3Page, p3SW));

  sw.close();
  chrome.kill();
  setTimeout(() => process.exit(0), 500);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
