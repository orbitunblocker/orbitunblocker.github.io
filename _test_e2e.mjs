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
    const cl = [];
    ws.on('open', () => resolve({ ws, cl, send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r({timedout:true}) }}, 20000); }) }));
    ws.on('error', reject);
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        else if(m.method === 'Runtime.consoleAPICalled') {
          cl.push({ t: (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||JSON.stringify(a))).join(' ') });
        }
      } catch(e) {}
    });
  });
}

async function main() {
  try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(3000); } catch(e) {}

  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\e2e-'+Date.now(), 'http://localhost:8080/']);

  for(let i=0;i<30;i++) { try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }

  let orbitPage;
  for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); orbitPage = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(orbitPage) break; }

  const cdp = await connectCDP(orbitPage.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');

  for(let i=0;i<30;i++) { await sleep(500); const r = await cdp.send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }

  // Connect SW
  let swTarget;
  for(let i=0;i<20;i++) { await sleep(500); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); swTarget = t.find(x => x.type === 'service_worker'); if(swTarget) break; }
  const swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
  await swCDP.send('Runtime.enable');
  log('SW connected');

  // Clear page logs up to now
  cdp.cl.length = 0;
  swCDP.cl.length = 0;

  // Test 1: Launch Half-Life (should detect Emscripten -> direct mode)
  log('=== Test 1: Launch Half-Life ===');
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[onclick*=games]").click()', returnByValue: true });
  await sleep(300);
  await cdp.send('Runtime.evaluate', { expression: 'openGame("half-life")', returnByValue: true });
  await sleep(8000);

  // Check page logs for [GAME MODE] and [GAME-LAUNCH] messages
  async function checkLogs() {
    for (const l of cdp.cl) log('  PAGE: ' + l.t);
    for (const l of swCDP.cl) log('  SW: ' + l.t);
  }

  log('Page logs:');
  for (const l of cdp.cl) {
    if (l.t.includes('[GAME MODE]') || l.t.includes('[GAME-LAUNCH]') || l.t.includes('[GAME-COMPAT]')) {
      log('  ' + l.t);
    }
  }

  // Check iframe URL
  const iframeCheck = await cdp.send('Runtime.evaluate', {
    expression: '(function(){ var f=document.getElementById("gameFrame"); if(!f) return "no iframe"; return "src=" + f.src; })()',
    returnByValue: true
  });
  log('iframe: ' + (iframeCheck.result?.result?.value || '?'));

  // Check for /service/ prefix in iframe URL
  const iframeSrc = iframeCheck.result?.result?.value || '';
  if (iframeSrc.includes('/service/')) {
    log('RESULT: PROXY MODE (URL wrapped in /service/)');
  } else if (iframeSrc.includes('pixelsuft.github.io')) {
    log('RESULT: DIRECT MODE (original URL)');
  } else {
    log('RESULT: UNKNOWN (' + iframeSrc + ')');
  }

  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
