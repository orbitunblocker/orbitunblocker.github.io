import { spawn } from 'child_process';
import http from 'http';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9248;
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

  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\zip2-'+Date.now(), 'http://localhost:8080/']);

  for(let i=0;i<30;i++) { try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }

  let pt;
  for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); pt = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(pt) break; }

  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

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

  // Inject fetch INSIDE the iframe using contentWindow.eval
  log('Injecting into iframe...');
  const injectResult = await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      var f = document.getElementById('gameFrame');
      if(!f || !f.contentWindow) return 'no-iframe';
      try {
        // Use iframe's eval to run code under UV client scripts
        f.contentWindow.eval('console.log("[ZIP-TEST] Starting ZIP test from inside iframe");');
        
        var urls = ['halva_en_out/halva_en-2.zip', 'halva_en-2.zip'];
        var results = [];
        urls.forEach(function(url) {
          fetch(url).then(function(resp) {
            console.log('[ZIP-TEST] ' + url + ' status=' + resp.status);
            results.push({url:url, status:resp.status});
          }).catch(function(err) {
            console.log('[ZIP-TEST] ' + url + ' error=' + err.message + ' type=' + err.constructor.name);
            results.push({url:url, error:err.message});
          });
        });
        return 'injected-urls=' + JSON.stringify(urls);
      } catch(e) {
        return 'error: ' + e.message;
      }
    })()`,
    returnByValue: true
  });
  log('Inject result: ' + (injectResult.result?.result?.value || 'none'));

  // Wait for fetches
  await sleep(10000);

  // REPORT
  log('\n======= REPORT =======');
  
  // SW logs
  const swAll = swCDP.consoleLogs;
  log('Total SW logs: ' + swAll.length);

  const swTrace = swAll.filter(l => l.text.includes('[SW-TRACE]'));
  log('[SW-TRACE] (' + swTrace.length + '):');
  for(const l of swTrace) log('  ' + l.text);

  // Page ZIP test results  
  const pageZipLogs = cdp.consoleLogs.filter(l => l.text.includes('[ZIP-TEST]'));
  log('\nPage ZIP test results:');
  for(const l of pageZipLogs) log('  ' + l.text);

  // 503s
  log('\n503 responses:');
  let found503 = false;
  for(const [id, req] of Object.entries(netReqs)) {
    if(req.status === 503) { found503 = true; log('  ' + req.url.slice(0,130)); }
  }
  if(!found503) log('  (none)');

  // /service/ requests
  log('\n/service/ requests:');
  for(const [id, req] of Object.entries(netReqs)) {
    if(req.url.includes('/service/')) {
      log('  status=' + req.status + ' ' + req.url.slice(0,130) + ' type=' + req.type);
    }
  }

  log('\nDone');
  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
