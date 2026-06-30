import { spawn } from 'child_process';
import http from 'http';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9250;
const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(msg) { console.log(`[T ${Date.now()}] ${msg}`); }

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
    ws.on('open', () => resolve({ ws, consoleLogs, send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r({timedout:true}) }}, 25000); }) }));
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

  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cmp6-'+Date.now(), 'http://localhost:8080/']);

  for(let i=0;i<30;i++) { try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }

  let orbitPage;
  for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); orbitPage = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(orbitPage) break; }

  const cdp = await connectCDP(orbitPage.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for(let i=0;i<30;i++) { await sleep(500); const r = await cdp.send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }

  let swTarget;
  for(let i=0;i<20;i++) { await sleep(500); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); swTarget = t.find(x => x.type === 'service_worker'); if(swTarget) break; }
  const swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
  await swCDP.send('Runtime.enable');
  log('SW connected');

  // Launch game
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[onclick*=games]").click()', returnByValue: true });
  await sleep(500);
  await cdp.send('Runtime.evaluate', { expression: 'openGame("half-life")', returnByValue: true });
  log('Game launched, waiting 8s...');
  await sleep(8000);

  // Build eval code testing BOTH root-path and subdirectory-path ZIPs
  const t0 = Date.now();
  const evalCode = `
    var t0 = ${t0};
    console.log("[ROOT-TEST] eval running at " + Date.now());

    // 1. halva_en-20.zip at ROOT of game (origin returns 404!)
    setTimeout(function() {
      fetch("halva_en-20.zip").then(function(r) {
        console.log("[ROOT-TEST] ROOT/halva_en-20.zip status=" + r.status + " type=" + (r.headers.get("content-type")||"?") + " elapsed=" + (Date.now()-t0) + "ms");
        if(r.ok) {
          return r.blob().then(function(b) { console.log("[ROOT-TEST] ROOT/halva_en-20.zip blob_size=" + b.size); });
        } else {
          return r.text().then(function(t) { console.log("[ROOT-TEST] ROOT/halva_en-20.zip body=" + t.slice(0,300)); });
        }
      }).catch(function(e) {
        console.log("[ROOT-TEST] ROOT/halva_en-20.zip FAILED err=" + e.message + " type=" + e.constructor.name);
      });
    }, 500);

    // 2. halva_en_out/halva_en-20.zip in subdirectory (origin returns 200)
    setTimeout(function() {
      fetch("halva_en_out/halva_en-20.zip").then(function(r) {
        console.log("[ROOT-TEST] SUB/halva_en-20.zip status=" + r.status + " type=" + (r.headers.get("content-type")||"?") + " elapsed=" + (Date.now()-t0) + "ms");
        return r.blob().then(function(b) { console.log("[ROOT-TEST] SUB/halva_en-20.zip blob_size=" + b.size); });
      }).catch(function(e) {
        console.log("[ROOT-TEST] SUB/halva_en-20.zip FAILED err=" + e.message + " type=" + e.constructor.name);
      });
    }, 3000);

    // 3. Also try the root halva_en.zip (larger file?)
    setTimeout(function() {
      fetch("halva_en.zip").then(function(r) {
        console.log("[ROOT-TEST] ROOT/halva_en.zip status=" + r.status + " type=" + (r.headers.get("content-type")||"?") + " elapsed=" + (Date.now()-t0) + "ms");
        if(!r.ok) {
          return r.text().then(function(t) { console.log("[ROOT-TEST] ROOT/halva_en.zip body=" + t.slice(0,300)); });
        } else {
          return r.blob().then(function(b) { console.log("[ROOT-TEST] ROOT/halva_en.zip blob_size=" + b.size); });
        }
      }).catch(function(e) {
        console.log("[ROOT-TEST] ROOT/halva_en.zip FAILED err=" + e.message + " type=" + e.constructor.name);
      });
    }, 5500);
  `;

  log('Injecting root-path tests into iframe...');
  const injectResult = await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      var f=document.getElementById('gameFrame');
      if(!f||!f.contentWindow) return 'FAIL';
      try {
        f.contentWindow.eval(${JSON.stringify(evalCode)});
        return 'eval OK';
      } catch(e) {
        return 'eval FAIL: ' + e.message;
      }
    })()`,
    returnByValue: true
  });
  log('Inject: ' + (injectResult.result?.result?.value || '?'));

  log('Waiting 35s...');
  await sleep(35000);

  log('\n\n======== ROOT-PATH TEST REPORT ========\n');

  log('--- SW HOP traces (all) ---');
  for(const l of swCDP.consoleLogs) {
    if(l.text.includes('[HOP]')) log('  ' + l.text);
  }

  log('\n--- SW-TRACE entries ---');
  for(const l of swCDP.consoleLogs) {
    if(l.text.includes('[SW-TRACE] ')) log('  ' + l.text);
  }

  log('\n--- Root-path test results ---');
  const logs = [
    ...swCDP.consoleLogs.filter(l => l.text.includes('[ROOT-TEST]')),
    ...cdp.consoleLogs.filter(l => l.text.includes('[ROOT-TEST]'))
  ];
  for(const l of logs) log('  ' + l.text);
  if(logs.length === 0) log('  (none found)');

  log('\nDone');
  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
