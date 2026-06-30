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

async function findTargetByUrl(urlMatch) {
  const targets = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json');
  return targets.find(t => t.url.includes(urlMatch) && t.type === 'page');
}

async function waitForTarget(urlMatch, maxSec = 20) {
  for(let i=0;i<maxSec*2;i++) {
    const t = await findTargetByUrl(urlMatch);
    if(t) return t;
    await sleep(500);
  }
  return null;
}

async function main() {
  // Kill existing chrome
  try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(3000); } catch(e) {}

  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cmp2-'+Date.now(), 'http://localhost:8080/']);
  log('Chrome launched');

  // Wait for Orbit to load
  for(let i=0;i<30;i++) { try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }

  // Get Orbit page
  let orbitPage;
  for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); orbitPage = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(orbitPage) break; }
  log('Orbit page found: ' + orbitPage.url);

  const cdp = await connectCDP(orbitPage.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // Wait for full load
  for(let i=0;i<30;i++) { await sleep(500); const r = await cdp.send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }

  // Wait for UV boot
  for(let i=0;i<40;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:'typeof __UV_BOOT_STATUS__!==\'undefined\' && __UV_BOOT_STATUS__.portReady===true', returnByValue:true});
    if(r.result?.result?.value) { log('UV boot complete'); break; }
    await sleep(500);
  }

  // Connect to SW
  let swTarget;
  for(let i=0;i<20;i++) { await sleep(500); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); swTarget = t.find(x => x.type === 'service_worker'); if(swTarget) break; }
  const swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
  await swCDP.send('Runtime.enable');
  log('SW connected');

  // Launch game
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[onclick*=games]").click()', returnByValue: true });
  await sleep(500);
  await cdp.send('Runtime.evaluate', { expression: 'openGame("half-life")', returnByValue: true });
  log('Game launched, waiting for iframe page target...');

  // Wait for the HL page target (the proxied page inside the iframe)
  const hlTarget = await waitForTarget('pixelsuft.github.io/hl', 30);
  if(!hlTarget) { log('ERROR: Could not find HL page target'); process.exit(1); }
  log('HL page target found: ' + hlTarget.url);

  const hlCDP = await connectCDP(hlTarget.webSocketDebuggerUrl);
  await hlCDP.send('Runtime.enable');
  await hlCDP.send('Page.enable');
  log('HL page connected');

  // Wait for page to be interactive
  await sleep(3000);

  // Now execute fetch comparisons from inside the HL page
  const t0 = Date.now();
  log('Starting fetch comparison from inside HL page context...\n');

  // 1. Fetch index.html (working baseline)
  log('1. Fetching index.html...');
  await hlCDP.send('Runtime.evaluate', {
    expression: `(async function(){
      try {
        var r = await fetch('index.html');
        console.log('[COMPARE] index.html status=' + r.status + ' type=' + (r.headers.get('content-type')||'?') + ' elapsed=' + (Date.now()-${t0}) + 'ms');
        var t = await r.text();
        console.log('[COMPARE] index.html body_len=' + t.length);
      } catch(e) {
        console.log('[COMPARE] index.html FAILED err=' + e.message);
      }
    })()`,
    awaitPromise: true,
    timeout: 15000
  });
  log('  index.html fetch completed');
  await sleep(1000);

  // 2. Fetch halva_en_out/halva_en-20.zip (the file user reports as 503)
  log('2. Fetching halva_en_out/halva_en-20.zip...');
  await hlCDP.send('Runtime.evaluate', {
    expression: `(async function(){
      try {
        var r = await fetch('halva_en_out/halva_en-20.zip');
        console.log('[COMPARE] halva_en-20.zip status=' + r.status + ' type=' + (r.headers.get('content-type')||'?') + ' elapsed=' + (Date.now()-${t0}) + 'ms');
        var b = await r.blob();
        console.log('[COMPARE] halva_en-20.zip blob_size=' + b.size);
      } catch(e) {
        console.log('[COMPARE] halva_en-20.zip FAILED err=' + e.message + ' type=' + e.constructor.name);
      }
    })()`,
    awaitPromise: true,
    timeout: 30000
  });
  log('  halva_en-20.zip fetch completed');
  await sleep(1000);

  // 3. Fetch halva_en_out/halva_en-2.zip (known working, larger file)
  log('3. Fetching halva_en_out/halva_en-2.zip...');
  await hlCDP.send('Runtime.evaluate', {
    expression: `(async function(){
      try {
        var r = await fetch('halva_en_out/halva_en-2.zip');
        console.log('[COMPARE] halva_en-2.zip status=' + r.status + ' type=' + (r.headers.get('content-type')||'?') + ' elapsed=' + (Date.now()-${t0}) + 'ms');
        var b = await r.blob();
        console.log('[COMPARE] halva_en-2.zip blob_size=' + b.size);
      } catch(e) {
        console.log('[COMPARE] halva_en-2.zip FAILED err=' + e.message + ' type=' + e.constructor.name);
      }
    })()`,
    awaitPromise: true,
    timeout: 30000
  });
  log('  halva_en-2.zip fetch completed');

  // Wait for any pending logs
  await sleep(2000);

  // REPORT
  log('\n\n======== COMPARE REPORT ========\n');

  log('--- SW HOP traces ---');
  for(const l of swCDP.consoleLogs) {
    if(l.text.includes('[HOP]')) log('  ' + l.text);
  }

  log('\n--- SW-TRACE entries ---');
  for(const l of swCDP.consoleLogs) {
    if(l.text.includes('[SW-TRACE]')) log('  ' + l.text);
  }

  log('\n--- Compare results from HL page ---');
  for(const l of hlCDP.consoleLogs) {
    if(l.text.includes('[COMPARE]')) log('  ' + l.text);
  }

  log('\nDone');
  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
