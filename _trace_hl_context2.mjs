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

  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cmp3-'+Date.now(), 'http://localhost:8080/']);

  for(let i=0;i<30;i++) { try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }

  let orbitPage;
  for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); orbitPage = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(orbitPage) break; }

  const cdp = await connectCDP(orbitPage.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  for(let i=0;i<30;i++) { await sleep(500); const r = await cdp.send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }

  // Wait for UV boot (port ready)
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

  // Inject script BEFORE game launch — this will run inside the iframe when it loads
  // The script performs the three fetch comparisons and sends results to parent via postMessage
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      (function() {
        var COMPARE_DONE = false;
        var results = [];
        function runComparisons() {
          if(COMPARE_DONE) return;
          // Log which page we're on
          console.log('[COMPARE] page url=' + window.location.href + ' readyState=' + document.readyState + ' base=' + (document.baseURI||'?'));
          // Only run if we see UV-rewritten URL or the HL game base
          if(!document.readyState || document.readyState === 'loading') return;
          if(COMPARE_DONE) return;
          COMPARE_DONE = true;
          console.log('[COMPARE] starting comparisons on ' + window.location.href);
          var t0 = Date.now();
          
          // Wait a moment for page to stabilize, then run comparisons
          setTimeout(function() {
            t0 = Date.now();
            
            // 1. index.html
            fetch('index.html').then(function(r) {
              console.log('[COMPARE] index.html status=' + r.status + ' type=' + (r.headers.get('content-type')||'?') + ' elapsed=' + (Date.now()-t0) + 'ms');
              return r.text().then(function(t) { console.log('[COMPARE] index.html body_len=' + t.length); });
            }).catch(function(e) {
              console.log('[COMPARE] index.html FAILED err=' + e.message);
            });
            
            // 2. halva_en_out/halva_en-20.zip (4.5MB — reported failing case)
            setTimeout(function() {
              fetch('halva_en_out/halva_en-20.zip').then(function(r) {
                console.log('[COMPARE] halva_en-20.zip status=' + r.status + ' type=' + (r.headers.get('content-type')||'?') + ' elapsed=' + (Date.now()-t0) + 'ms');
                return r.blob().then(function(b) { console.log('[COMPARE] halva_en-20.zip blob_size=' + b.size); });
              }).catch(function(e) {
                console.log('[COMPARE] halva_en-20.zip FAILED err=' + e.message + ' type=' + e.constructor.name);
              });  
            }, 2000);
            
            // 3. halva_en_out/halva_en-2.zip (10MB — known working in previous test)
            setTimeout(function() {
              fetch('halva_en_out/halva_en-2.zip').then(function(r) {
                console.log('[COMPARE] halva_en-2.zip status=' + r.status + ' type=' + (r.headers.get('content-type')||'?') + ' elapsed=' + (Date.now()-t0) + 'ms');
                return r.blob().then(function(b) { console.log('[COMPARE] halva_en-2.zip blob_size=' + b.size); });
              }).catch(function(e) {
                console.log('[COMPARE] halva_en-2.zip FAILED err=' + e.message + ' type=' + e.constructor.name);
              });
            }, 4000);
          }, 1000);
        }
        
        // Run on DOMContentLoaded and load
        document.addEventListener('DOMContentLoaded', runComparisons);
        window.addEventListener('load', runComparisons);
        if(document.readyState !== 'loading') runComparisons();
      })();
    `
  });

  log('Injected comparison script - launching game...');

  // Launch game
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[onclick*=games]").click()', returnByValue: true });
  await sleep(500);
  await cdp.send('Runtime.evaluate', { expression: 'openGame("half-life")', returnByValue: true });
  log('Game launched, waiting 45s for all requests to complete...');
  await sleep(45000);

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
  
  log('\n--- SW FETCH_LOG entries ---');
  for(const l of swCDP.consoleLogs) {
    if(l.text.includes('FETCH_LOG')) log('  ' + l.text);
  }

  log('\n--- Compare results from HL page ---');
  for(const l of swCDP.consoleLogs) {
    if(l.text.includes('[COMPARE]')) log('  ' + l.text);
  }

  // Also check page-side logs
  log('\n--- Page console logs with COMPARE ---');
  for(const l of cdp.consoleLogs) {
    if(l.text.includes('[COMPARE]')) log('  ' + l.text);
  }

  log('\nDone');
  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
