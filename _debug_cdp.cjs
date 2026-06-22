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
    ws.on('open', () => resolve({
      ws, send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r(null); }}, 10000); })
    }));
    ws.on('error', reject);
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        else if(m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
          console.log('[CDP]', args.slice(0,300));
        }
      } catch(e) {}
    });
  });
}

async function main() {
  try { await fetchJSON('http://127.0.0.1:9231/json/version'); await fetchJSON('http://127.0.0.1:9231/json/close'); await sleep(1000); } catch(e) {}
  
  console.log('Starting Chrome...');
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=9231', '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', 'http://localhost:8080/'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  
  let v; for(let i=0;i<30;i++) { try { v = await fetchJSON('http://127.0.0.1:9231/json/version'); break; } catch(e) { await sleep(1000); } }
  if (!v) { console.log('Chrome fail'); chrome.kill(); return; }
  console.log('Chrome:', v.Browser);
  
  let pt; for(let i=0;i<20;i++) { await sleep(500); try { const t = await fetchJSON('http://127.0.0.1:9231/json'); pt = t.find(x => x.type === 'page'); if(pt) break; } catch(e) {} }
  if (!pt) { console.log('No page'); chrome.kill(); return; }
  
  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Runtime.runIfWaitingForDebugger');
  await sleep(3000);
  
  // Check boot status
  const r = await cdp.send('Runtime.evaluate', {expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"', returnByValue: true});
  console.log('Has boot status:', r ? r.result?.result?.value : 'null');
  
  // Check if VoltraBrowser exists
  const vb = await cdp.send('Runtime.evaluate', {expression:'typeof window.VoltraBrowser', returnByValue: true});
  console.log('VoltraBrowser:', vb ? vb.result?.result?.value : 'null');
  
  // loadSection browser
  console.log('\n--- loadSection browser ---');
  await cdp.send('Runtime.evaluate', {expression: 'if(typeof loadSection==="function")loadSection("browser")'});
  await sleep(3000);
  
  // Check iframe
  const src = await cdp.send('Runtime.evaluate', {expression:`
    (function() {
      try {
        var t = window.VoltraBrowser._browserUI.tabManager.getActiveTab();
        if(!t) return 'no tab';
        var f = document.getElementById('browserFrame-' + t.id);
        return f ? f.src : 'no iframe';
      } catch(e) { return 'error: ' + e.message; }
    })()
  `, returnByValue: true});
  console.log('Iframe src:', src ? src.result?.result?.value : 'null');
  
  // Check all tabs
  const tabs = await cdp.send('Runtime.evaluate', {expression:`
    (function() {
      try {
        var tm = window.VoltraBrowser._browserUI.tabManager;
        return JSON.stringify(Object.keys(tm.tabs).map(id => ({id, url: tm.tabs[id].url})));
      } catch(e) { return 'error: ' + e.message; }
    })()
  `, returnByValue: true});
  console.log('Tabs:', tabs ? tabs.result?.result?.value : 'null');
  
  await sleep(2000);
  chrome.kill();
}

main().catch(e => console.error('ERROR:', e));
