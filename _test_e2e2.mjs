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

  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\e2e2-'+Date.now(), 'http://localhost:8080/']);

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

  // Clear logs
  cdp.cl.length = 0;
  swCDP.cl.length = 0;

  // Test 1: Half-Life (should be direct)
  log('=== Test 1: Half-Life (expect direct) ===');
  await cdp.send('Runtime.evaluate', { expression: 'document.querySelector("[onclick*=games]").click()', returnByValue: true });
  await sleep(300);
  await cdp.send('Runtime.evaluate', { expression: 'openGame("half-life")', returnByValue: true });
  await sleep(10000);

  log('Page logs:');
  for (const l of cdp.cl) {
    if (l.t.includes('[GAME MODE]') || l.t.includes('[GAME-LAUNCH]') || l.t.includes('[GAME-COMPAT]') || l.t.includes('[GAME-DEFER]')) {
      log('  ' + l.t);
    }
  }

  const hlIframe = await cdp.send('Runtime.evaluate', {
    expression: '(function(){ var f=document.getElementById("gameFrame"); return f ? f.src : "none"; })()',
    returnByValue: true
  });
  const hlSrc = hlIframe.result?.result?.value || '';
  log('HL iframe src: ' + hlSrc);
  log('HL mode: ' + (hlSrc.includes('/service/') ? 'PROXY' : 'DIRECT'));

  // Test 2: Back and open a simple game (like slope or another)
  // Use backFromPlayer then open a game that defaults to proxy
  // Pick a google script game that won't be detected
  await cdp.send('Runtime.evaluate', { expression: 'backFromPlayer()', returnByValue: true });
  await sleep(1500);

  // Use a game with script.google.com URL (won't have our patterns)
  // Let's try "basketball-stars" which uses script.google.com URL
  log('=== Test 2: Basketball Stars (expect proxy) ===');
  await cdp.send('Runtime.evaluate', { expression: 'openGame("basketball-stars")', returnByValue: true });
  await sleep(12000);

  log('Page logs for game 2:');
  for (const l of cdp.cl) {
    if (l.t.includes('[GAME MODE]') || l.t.includes('[GAME-LAUNCH]') || l.t.includes('[GAME-COMPAT]') || l.t.includes('[GAME-DEFER]')) {
      log('  ' + l.t);
    }
  }

  const bbIframe = await cdp.send('Runtime.evaluate', {
    expression: '(function(){ var f=document.getElementById("gameFrame"); return f ? f.src : "none"; })()',
    returnByValue: true
  });
  const bbSrc = bbIframe.result?.result?.value || '';
  log('BB iframe src: ' + bbSrc);
  log('BB mode: ' + (bbSrc.includes('/service/') ? 'PROXY' : 'DIRECT'));

  log('\nDone');
  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
