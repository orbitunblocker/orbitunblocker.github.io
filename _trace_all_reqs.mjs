import { spawn } from 'child_process';
import http from 'http';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9249;
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
    ws.on('open', () => resolve({ ws, send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r({timedout:true}) }}, 20000); }) }));
    ws.on('error', reject);
    ws.on('message', d => { try { const m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch(e){} });
  });
}

async function main() {
  try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(3000); } catch(e) {}

  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\all-'+Date.now(), 'http://localhost:8080/']);

  for(let i=0;i<30;i++) { try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }
  let pt;
  for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); pt = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(pt) break; }

  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // Track ALL requests (including iframe subresource requests)
  const allReqs = {};
  cdp.ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if(m.method === 'Network.requestWillBeSent') {
        const r = m.params.request;
        const req = { url: r.url, type: m.params.type, status: 0, method: r.method, frameId: m.params.frameId, loaderId: m.params.loaderId, ts: Date.now() };
        allReqs[r.url] = req;
        // Track by requestId too
        allReqs[m.params.requestId] = req;
      }
      if(m.method === 'Network.responseReceived') {
        const entry = allReqs[m.params.requestId];
        if(entry) { entry.status = m.params.response.status; entry.statusText = m.params.response.statusText; entry.mime = m.params.response.mimeType; }
      }
    } catch(e) {}
  });

  for(let i=0;i<30;i++) { await sleep(500); const r = await cdp.send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }
  for(let i=0;i<40;i++) {
    const r = await cdp.send('Runtime.evaluate', {expression:'typeof __UV_BOOT_STATUS__!==\'undefined\' && __UV_BOOT_STATUS__.portReady===true', returnByValue:true});
    if(r.result?.result?.value) break;
    await sleep(500);
  }

  // Launch game
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[onclick*=games]").click()', returnByValue: true });
  await sleep(500);
  await cdp.send('Runtime.evaluate', { expression: 'openGame("half-life")', returnByValue: true });
  await sleep(3000);

  // Inject fetch inside iframe
  log('Injecting ZIP fetch inside iframe...');
  await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      var f = document.getElementById('gameFrame');
      if(!f || !f.contentWindow) return;
      f.contentWindow.eval('fetch("halva_en_out/halva_en-2.zip").then(function(r){ console.log("[ZIP-RESULT] status="+r.status+" url="+r.url+" type="+(r.headers.get("content-type")||"?")); return r.text(); }).then(function(t){ console.log("[ZIP-RESULT] body preview="+t.slice(0,100)); }).catch(function(e){ console.log("[ZIP-RESULT] error="+e.message); });');
    })()`,
    returnByValue: true
  });

  await sleep(8000);

  // REPORT
  log('\n======= REPORT =======');

  // All requests with .zip or /service/
  log('\nZIP requests (from all frames):');
  for(const [key, req] of Object.entries(allReqs)) {
    if(typeof req === 'object' && req.url && (req.url.includes('.zip') || req.url.includes('/service/'))) {
      log(req.method + ' ' + req.status + ' ' + req.url.slice(0,140) + ' type=' + (req.type||'') + ' mime=' + (req.mime||''));
    }
  }

  log('\nAll requests from iframe (frameId != main):');
  const mainFrameId = pt.id; // approximate
  for(const [key, req] of Object.entries(allReqs)) {
    if(typeof req === 'object' && req.url && !req.url.includes('localhost:') && !req.url.startsWith('data:')) {
      log(req.method + ' ' + req.status + ' ' + req.url.slice(0,130));
    }
  }

  // Print ZIP result from page console
  log('\nDone');
  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
