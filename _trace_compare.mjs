import { spawn } from 'child_process';
import http from 'http';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9250;
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

  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cmp-'+Date.now(), 'http://localhost:8080/']);

  for(let i=0;i<30;i++) { try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }
  let pt;
  for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); pt = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(pt) break; }

  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // Track network
  const netReqs = {};
  cdp.ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if(m.method === 'Network.requestWillBeSent') {
        netReqs[m.params.requestId] = { url: m.params.request.url, type: m.params.type, status: 0 };
      }
      if(m.method === 'Network.responseReceived') {
        const e = netReqs[m.params.requestId];
        if(e) { e.status = m.params.response.status; e.statusText = m.params.response.statusText; }
      }
    } catch(e) {}
  });

  for(let i=0;i<30;i++) { await sleep(500); const r = await cdp.send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }
  for(let i=0;i<40;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:'typeof __UV_BOOT_STATUS__!==\'undefined\' && __UV_BOOT_STATUS__.portReady===true', returnByValue:true});
    if(r.result?.result?.value) break;
    await sleep(500);
  }

  // Connect SW
  let swTarget;
  for(let i=0;i<20;i++) { await sleep(500); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); swTarget = t.find(x => x.type === 'service_worker'); if(swTarget) break; }
  const swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
  await swCDP.send('Runtime.enable');
  log('SW connected');

  // Launch game
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[onclick*=games]").click()', returnByValue: true });
  await sleep(500);
  await cdp.send('Runtime.evaluate', { expression: 'openGame("half-life")', returnByValue: true });
  await sleep(4000);

  // Fetch BOTH files from inside iframe and compare lifecycle
  log('Injecting into iframe...');
  await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      var f = document.getElementById('gameFrame');
      if(!f || !f.contentWindow) return;
      // Clear SW logs by fetching index.html (working) first at known time
      var base = new URL('halva_en_out/', f.contentWindow.location.href).href;
      f.contentWindow.eval('
        var t0 = Date.now();
        console.log("[COMPARE-TEST] starting at t0=" + t0);
        
        // 1. Working request: index.html
        fetch("index.html").then(function(r) {
          console.log("[COMPARE-RESULT] index.html status=" + r.status + " elapsed=" + (Date.now()-t0) + "ms" + " type=" + (r.headers.get("content-type")||"?"));
          return r.text().then(function(t) { console.log("[COMPARE-RESULT] index.html body_len=" + t.length); });
        }).catch(function(e) {
          console.log("[COMPARE-RESULT] index.html FAILED err=" + e.message);
        });
        
        // 2. Suspicious request: halva_en_out/halva_en-20.zip (4.5MB)
        fetch("halva_en_out/halva_en-20.zip").then(function(r) {
          console.log("[COMPARE-RESULT] halva_en-20.zip status=" + r.status + " elapsed=" + (Date.now()-t0) + "ms" + " type=" + (r.headers.get("content-type")||"?"));
          return r.blob().then(function(b) { console.log("[COMPARE-RESULT] halva_en-20.zip blob_size=" + b.size); });
        }).catch(function(e) {
          console.log("[COMPARE-RESULT] halva_en-20.zip FAILED err=" + e.message + " type=" + e.constructor.name);
        });
        
        // 3. Known working ZIP: halva_en_out/halva_en-2.zip (10MB)
        fetch("halva_en_out/halva_en-2.zip").then(function(r) {
          console.log("[COMPARE-RESULT] halva_en-2.zip status=" + r.status + " elapsed=" + (Date.now()-t0) + "ms" + " type=" + (r.headers.get("content-type")||"?"));
          return r.blob().then(function(b) { console.log("[COMPARE-RESULT] halva_en-2.zip blob_size=" + b.size); });
        }).catch(function(e) {
          console.log("[COMPARE-RESULT] halva_en-2.zip FAILED err=" + e.message + " type=" + e.constructor.name);
        });
      ');
    })()`,
    returnByValue: true
  });
  log('Injected, waiting 30s for large ZIPs to transfer...');
  await sleep(30000);

  // REPORT
  log('\n======= COMPARE REPORT =======\n');

  // All SW logs for this session
  const swAll = swCDP.consoleLogs;
  log('Total SW log lines: ' + swAll.length);

  // Find the fetch# IDs for each request type
  log('\n--- SW-TRACE entries (all) ---');
  const swTrace = swAll.filter(l => l.text.includes('[SW-TRACE]'));
  for(const l of swTrace) log('  ' + l.text);

  log('\n--- HOP entries (all) ---');
  const hops = swAll.filter(l => l.text.includes('[HOP]'));
  for(const l of hops) log('  ' + l.text);

  log('\n--- Compare results from page ---');
  const cmpResults = cdp.consoleLogs.filter(l => l.text.includes('[COMPARE-'));
  for(const l of cmpResults) log('  ' + l.text);

  log('\n--- Network /service/ responses ---');
  for(const [id, req] of Object.entries(netReqs)) {
    if(typeof req === 'object' && req.url && req.url.includes('/service/')) {
      log('  status=' + req.status + ' ' + req.url.slice(0,130) + ' type=' + req.type);
    }
  }

  log('\nDone');
  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
