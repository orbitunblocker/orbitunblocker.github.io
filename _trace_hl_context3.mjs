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

  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cmp5-'+Date.now(), 'http://localhost:8080/']);

  for(let i=0;i<30;i++) { try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }

  let orbitPage;
  for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); orbitPage = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(orbitPage) break; }

  const cdp = await connectCDP(orbitPage.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  for(let i=0;i<30;i++) { await sleep(500); const r = await cdp.send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }

  let swTarget;
  for(let i=0;i<20;i++) { await sleep(500); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); swTarget = t.find(x => x.type === 'service_worker'); if(swTarget) break; }
  const swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
  await swCDP.send('Runtime.enable');
  log('SW connected');

  const netLogs = [];
  cdp.ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if(m.method === 'Network.responseReceived') {
        const r = m.params.response;
        if(r.url.includes('/service/')) netLogs.push({ url: r.url.slice(0,140), status: r.status, mime: r.mimeType });
      }
    } catch(e) {}
  });

  // Launch game
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[onclick*=games]").click()', returnByValue: true });
  await sleep(500);
  await cdp.send('Runtime.evaluate', { expression: 'openGame("half-life")', returnByValue: true });
  log('Game launched, waiting 8s...');
  await sleep(8000);

  // Check iframe status
  const check = await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      var f=document.getElementById('gameFrame');
      if(!f) return 'no iframe';
      if(!f.contentWindow) return 'no contentWindow';
      return 'iframe url='+f.contentWindow.location.href+' dest='+f.src;
    })()`,
    returnByValue: true
  });
  log('iframe: ' + (check.result?.result?.value || '?'));

  // Build eval code for injection into iframe
  const t0 = Date.now();
  const evalCode = `
    var t0 = ${t0};
    var COMPARING = true;
    console.log("[COMPARE] eval injection running at " + Date.now());

    // 1. index.html
    setTimeout(function() {
      fetch("index.html").then(function(r) {
        console.log("[COMPARE] index.html status=" + r.status + " type=" + (r.headers.get("content-type")||"?") + " elapsed=" + (Date.now()-t0) + "ms");
        return r.text().then(function(t) { console.log("[COMPARE] index.html body_len=" + t.length); });
      }).catch(function(e) {
        console.log("[COMPARE] index.html FAILED err=" + e.message + " type=" + e.constructor.name);
      });
    }, 500);

    // 2. halva_en_out/halva_en-20.zip (4.5MB — reported failing)
    setTimeout(function() {
      fetch("halva_en_out/halva_en-20.zip").then(function(r) {
        console.log("[COMPARE] halva_en-20.zip status=" + r.status + " type=" + (r.headers.get("content-type")||"?") + " elapsed=" + (Date.now()-t0) + "ms");
        return r.blob().then(function(b) { console.log("[COMPARE] halva_en-20.zip blob_size=" + b.size); });
      }).catch(function(e) {
        console.log("[COMPARE] halva_en-20.zip FAILED err=" + e.message + " type=" + e.constructor.name);
      });
    }, 2000);

    // 3. halva_en_out/halva_en-2.zip (10MB — known working)
    setTimeout(function() {
      fetch("halva_en_out/halva_en-2.zip").then(function(r) {
        console.log("[COMPARE] halva_en-2.zip status=" + r.status + " type=" + (r.headers.get("content-type")||"?") + " elapsed=" + (Date.now()-t0) + "ms");
        return r.blob().then(function(b) { console.log("[COMPARE] halva_en-2.zip blob_size=" + b.size); });
      }).catch(function(e) {
        console.log("[COMPARE] halva_en-2.zip FAILED err=" + e.message + " type=" + e.constructor.name);
      });
    }, 4000);
  `;

  log('Injecting comparisons into iframe...');
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

  log('Waiting 40s for ZIPs...');
  await sleep(40000);

  // REPORT
  log('\n\n======== COMPARE REPORT ========\n');

  log('--- SW HOP traces ---');
  for(const l of swCDP.consoleLogs) {
    if(l.text.includes('[HOP]')) log('  ' + l.text);
  }

  log('\n--- SW-TRACE entries ---');
  for(const l of swCDP.consoleLogs) {
    if(l.text.includes('[SW-TRACE] ')) log('  ' + l.text);
  }

  log('\n--- Compare results ---');
  const allCmp = [
    ...swCDP.consoleLogs.filter(l => l.text.includes('[COMPARE]')),
    ...cdp.consoleLogs.filter(l => l.text.includes('[COMPARE]'))
  ];
  for(const l of allCmp) log('  ' + l.text);
  if(allCmp.length === 0) log('  (none found)');

  log('\n--- /service/ network responses ---');
  for(const n of netLogs) log('  status=' + n.status + ' ' + n.url + ' type=' + n.mime);

  log('\nSW logs: ' + swCDP.consoleLogs.length + ' total');
  log('Page logs: ' + cdp.consoleLogs.length + ' total');

  log('\nDone');
  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
