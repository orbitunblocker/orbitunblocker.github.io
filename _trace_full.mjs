import { spawn } from 'child_process';
import http from 'http';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9246;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOG = [];
function log(msg) { const s = `[T ${Date.now()}] ${msg}`; LOG.push(s); console.log(s); }

function reqJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {};
    const consoleLogs = [];
    ws.on('open', () => resolve({ ws, consoleLogs, send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r({timedout:true}) }}, 20000); }) }));
    ws.on('error', reject);
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        else if(m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||JSON.stringify(a))).join(' ');
          consoleLogs.push({ text: args, ts: Date.now() });
        }
      } catch(e) {}
    });
  });
}

async function main() {
  try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(3000); } catch(e) {}

  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\tr503-'+Date.now(), 'http://localhost:8080/']);

  for(let i=0;i<30;i++) { try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }

  let pt;
  for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); pt = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(pt) break; }

  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // Track network requests
  const netReqs = {};
  const netFailures = [];
  cdp.ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if(m.method === 'Network.requestWillBeSent') {
        const r = m.params.request;
        netReqs[m.params.requestId] = { url: r.url, type: m.params.type, status: 0, statusText: '', ts: Date.now(), method: r.method };
      }
      if(m.method === 'Network.responseReceived') {
        const e = netReqs[m.params.requestId];
        if(e) { e.status = m.params.response.status; e.statusText = m.params.response.statusText; e.mimeType = m.params.response.mimeType; }
      }
      if(m.method === 'Network.loadingFailed') {
        const e = netReqs[m.params.requestId];
        netFailures.push({ url: e ? e.url : '?', type: e ? e.type : '?', error: m.params.errorText, blocked: m.params.blockedReason || 'none', canceled: m.params.canceled });
      }
    } catch(e) {}
  });

  // Wait for page
  for(let i=0;i<30;i++) { await sleep(500); const r = await cdp.send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }

  // Wait for UV boot
  for(let i=0;i<40;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:'typeof __UV_BOOT_STATUS__!==\'undefined\' && __UV_BOOT_STATUS__.portReady===true', returnByValue:true});
    if(r.result?.result?.value) break;
    await sleep(500);
  }

  // Connect to SW target
  let swTarget;
  for(let i=0;i<20;i++) { await sleep(500); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); swTarget = t.find(x => x.type === 'service_worker'); if(swTarget) break; }
  if(!swTarget) { log('NO SW TARGET'); chrome.kill(); return; }
  log('SW connected');

  const swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
  await swCDP.send('Runtime.enable');
  log('SW Runtime enabled');

  // Navigate to games and launch Half-Life
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[onclick*=games]").click()', returnByValue: true });
  await sleep(500);
  await cdp.send('Runtime.evaluate', { expression: 'openGame("half-life")', returnByValue: true });
  await sleep(2000);

  // Check game state
  const state = await cdp.send('Runtime.evaluate', {
    expression: '(function(){ var f=document.getElementById("gameFrame"); return JSON.stringify({src:f?f.src:"none", loading:f?!!document.getElementById("gameLoadingOverlay"):"no"}); })()',
    returnByValue: true
  });
  log('Game frame: ' + (state.result?.result?.value || '?'));

  // Wait for game to load and potentially make ZIP requests
  log('Waiting 20s for game activity...');
  await sleep(20000);

  // ====== REPORT ======
  log('\n======= REPORT =======');

  // SW logs filtered
  const swTrace = swCDP.consoleLogs;
  log('Total SW log lines: ' + swTrace.length);
  const traceLines = swTrace.filter(l => l.text.includes('[SW-TRACE]'));
  log('[SW-TRACE] lines: ' + traceLines.length);
  const hopLines = swTrace.filter(l => l.text.includes('[HOP]'));
  log('[HOP] lines: ' + hopLines.length);

  log('\n--- LAST 30 SW LOGS ---');
  const recent = swTrace.slice(-30);
  for(const l of recent) log('SW|' + l.text);

  log('\n--- 503 RESPONSES ---');
  let found503 = false;
  for(const [id, req] of Object.entries(netReqs)) {
    if(req.status === 503) { found503 = true; log('503: ' + req.url.slice(0,120) + ' type=' + req.type + ' method=' + req.method + ' statusText=' + req.statusText); }
  }
  if(!found503) log('(none)');

  log('\n--- NETWORK FAILURES ---');
  for(const f of netFailures) log('FAIL: ' + f.url.slice(0,120) + ' err=' + f.error + ' blocked=' + f.blocked);

  log('\n--- ZIP REQUESTS ---');
  let foundZip = false;
  for(const [id, req] of Object.entries(netReqs)) {
    if(req.url.includes('.zip') || req.url.includes('.tar') || req.url.includes('.gz')) { 
      foundZip = true; 
      log('ARCHIVE: ' + req.url.slice(0,120) + ' status=' + req.status + ' type=' + req.type + ' method=' + req.method); 
    }
  }
  if(!foundZip) log('(none - game did not request any archive files in this window)');

  log('\n--- ALL /service/ REQUESTS ---');
  let svcCount = 0;
  for(const [id, req] of Object.entries(netReqs)) {
    if(req.url.includes('/service/')) {
      svcCount++;
      if(svcCount <= 15) log('SVC: status=' + req.status + ' ' + req.url.slice(0,120) + ' type=' + req.type);
    }
  }
  log('Total /service/ requests: ' + svcCount);

  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
