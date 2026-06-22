// Final UV routing test
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

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {};
    ws.on('open', () => resolve({
      ws, send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r(null); }}, 10000); })
    }));
    ws.on('error', reject);
    ws.on('close', () => { for(const k of Object.keys(pend)) pend[k](null); });
    ws.on('message', d => { try { const m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch(e) {} });
  });
}

async function main() {
  const PORT = 9231;
  try { await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); await fetchJSON(`http://127.0.0.1:${PORT}/json/close`); await sleep(1000); } catch(e) {}
  
  console.log('Starting Chrome...');
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', 'http://localhost:8080/'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  
  let v; for(let i=0;i<30;i++) { try { v = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch(e) { await sleep(1000); } }
  if (!v) { console.log('Chrome fail'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', v.Browser);
  
  let pt; for(let i=0;i<20;i++) { await sleep(500); try { const t = await fetchJSON(`http://127.0.0.1:${PORT}/json`); pt = t.find(x => x.type === 'page'); if (pt) break; } catch(e) {} }
  if (!pt) { console.log('No page target'); chrome.kill(); process.exit(1); }
  
  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  
  // Wait for boot status + port ready
  for(let i=0;i<30;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"&&window.__UV_BOOT_STATUS__.portReady===true', returnByValue: true});
    if(evalValue(r) === true) { console.log('portReady after', i+1, 's'); break; }
    await sleep(1000);
  }
  
  const bs = evalValue(await cdp.send('Runtime.evaluate', {expression:'JSON.stringify(window.__UV_BOOT_STATUS__)', returnByValue: true}));
  console.log('Boot status:', bs);
  
  // Render browser UI into DOM first
  const renderRes = evalValue(await cdp.send('Runtime.evaluate', {expression:`
    (function() {
      var container = document.getElementById('braveBrowserContainer') || document.querySelector('.browser-section');
      if (!container) {
        // Try to find any container for the browser
        container = document.querySelector('#browserContainer');
        if (!container) container = document.getElementById('heroAppGrid');
        if (!container) container = document.body;
      }
      if (window.VoltraBrowser && typeof window.VoltraBrowser.render === 'function') {
        window.VoltraBrowser.render(container);
        return 'rendered into ' + (container.id || container.className || 'body');
      }
      return 'no render function';
    })()
  `, returnByValue: true}));
  console.log('Render:', renderRes);
  await sleep(500);

  // Navigate to example.com via browser engine
  console.log('\n--- Navigating to https://example.com ---');
  const nav = evalValue(await cdp.send('Runtime.evaluate', {expression:`
    (function() {
      var ui = window.VoltraBrowser._browserUI;
      if (!ui) return 'no browserUI';
      var tm = ui.tabManager;
      if (!tm) return 'no tabManager';
      var tab = tm.getActiveTab();
      if (tab) {
        ui._loadUrlInActiveTab('https://example.com');
        return 'navigated tab: ' + tab.id;
      }
      tm.createTab('https://example.com');
      return 'tab created';
    })()
  `, returnByValue: true}));
  console.log('Nav:', nav);
  await sleep(2000);
  
  // Check route debug
  const rd = evalValue(await cdp.send('Runtime.evaluate', {expression:'JSON.stringify(window.__UV_ROUTE_DEBUG__)', returnByValue: true}));
  console.log('\n=== __UV_ROUTE_DEBUG__ ===\n' + rd);
  
  // Check iframe src
  const iframeSrc = evalValue(await cdp.send('Runtime.evaluate', {expression:`
    (function() {
      var t = window.VoltraBrowser._browserUI.tabManager.getActiveTab();
      if (!t) return 'no tab';
      var f = document.getElementById('browserFrame-' + t.id);
      return f ? f.src : 'no iframe';
    })()
  `, returnByValue: true}));
  console.log('\nIframe src:', iframeSrc);
  console.log('Has /service/:', iframeSrc && iframeSrc.includes('/service/'));
  
  // Check SW logs for fetch trace
  const targets = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
  const swTarget = targets.find(t => t.type === 'service_worker');
  if (swTarget) {
    const swWS = new WebSocket(swTarget.webSocketDebuggerUrl);
    let swLogs = [];
    swWS.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
          swLogs.push(args);
        }
      } catch(e) {}
    });
    await new Promise(r => swWS.on('open', r));
    swWS.send(JSON.stringify({id:1,method:'Runtime.enable',params:{}}));
    await sleep(3000);
    console.log('\n=== SW [TRACE] logs ===');
    for(const l of swLogs) if(l.includes('[TRACE]')) console.log('  '+l);
    swWS.close();
  }
  
  chrome.kill();
  setTimeout(()=>process.exit(0),500);
}
main().catch(e=>{console.error('FATAL:',e);process.exit(1)});
