import { spawn } from 'child_process';
import http from 'http';
import WebSocket from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9240;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LOG = [];

function log(msg) { const s = `[TRACE ${Date.now()}] ${msg}`; LOG.push(s); console.log(s); }

function reqJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {};
    const logs = [];
    ws.on('open', () => resolve({
      ws, logs,
      send: (m, p = {}) => new Promise(r => {
        let id = ++mid;
        pend[id] = r;
        ws.send(JSON.stringify({id, method: m, params: p}));
        setTimeout(() => { if(pend[id]) { delete pend[id]; r({timedout:true}); }}, 20000);
      })
    }));
    ws.on('error', reject);
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        else if(m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||JSON.stringify(a))).join(' ');
          logs.push({ text: args, ts: Date.now() });
        }
      } catch(e) {}
    });
  });
}

async function main() {
  try {
    await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`);
    spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' });
    await sleep(3000);
  } catch(e) {}

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-extensions',
    '--disable-popup-blocking', '--disable-default-apps', '--allow-insecure-localhost',
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\trace503-${Date.now()}`,
    'http://localhost:8080/'
  ]);

  // Wait for CDP
  let v;
  for(let i=0;i<30;i++) { try { v = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch(e) { await sleep(1000); } }
  if(!v) { log('Chrome not ready'); chrome.kill(); return; }
  log('Chrome: ' + v.Browser);

  // Find page target
  let pt;
  for(let i=0;i<30;i++) {
    await sleep(1000);
    const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`);
    pt = t.find(x => x.type === 'page' && x.url.includes('localhost'));
    if(pt) break;
  }
  if(!pt) { log('No page target'); chrome.kill(); return; }
  log('Page: ' + pt.url);

  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // Collect ALL network requests
  const netReqs = {};
  const netFailures = [];
  cdp.ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if(m.method === 'Network.requestWillBeSent') {
        const r = m.params.request;
        netReqs[m.params.requestId] = { url: r.url, type: m.params.type, status: 0, ts: Date.now(), method: r.method };
      }
      if(m.method === 'Network.responseReceived') {
        const e = netReqs[m.params.requestId];
        if(e) { e.status = m.params.response.status; e.statusText = m.params.response.statusText; }
      }
      if(m.method === 'Network.loadingFailed') {
        const e = netReqs[m.params.requestId];
        netFailures.push({ url: e ? e.url : '?', type: e ? e.type : '?', error: m.params.errorText, canceled: m.params.canceled });
      }
    } catch(e) {}
  });

  // Wait for page to finish loading
  for(let i=0;i<60;i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `document.readyState === 'complete'`,
      returnByValue: true
    });
    if(r.result?.result?.value) break;
    await sleep(500);
  }
  log('Page loaded');

  // Wait for UV boot
  for(let i=0;i<40;i++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(typeof __UV_BOOT_STATUS__ !== 'undefined' && __UV_BOOT_STATUS__.portReady === true)`,
      returnByValue: true
    });
    if(r.result?.result?.value) { log('UV boot complete'); break; }
    await sleep(500);
  }

  // Connect to SW target
  let swTarget;
  for(let i=0;i<20;i++) {
    await sleep(500);
    const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`);
    swTarget = t.find(x => x.type === 'service_worker');
    if(swTarget) break;
  }
  if(!swTarget) { log('No SW target'); chrome.kill(); return; }
  log('SW target: ' + swTarget.url.slice(0,80));

  const swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
  await swCDP.send('Runtime.enable');
  log('Connected to SW, now launching game...');

  // Click the Half-Life game card
  await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      var cards = document.querySelectorAll('[data-id="half-life"]');
      if(cards.length > 0) { cards[0].click(); return 'clicked'; }
      var btns = document.querySelectorAll('.game-card');
      for(var b of btns) { if(b.textContent.includes('Half-Life')) { b.click(); return 'clicked-text'; } }
      return 'not-found';
    })()`,
    returnByValue: true
  });

  // Wait for iframe to load (game page opens)
  await sleep(3000);

  // Check page state
  const state = await cdp.send('Runtime.evaluate', {
    expression: `(function(){
      var ifr = document.getElementById('gameFrame');
      return JSON.stringify({ src: ifr ? ifr.src : 'no-iframe', dataSrc: ifr ? ifr.getAttribute('data-src') : 'none' });
    })()`,
    returnByValue: true
  });
  log('Game page state: ' + (state.result?.result?.value || '?'));

  // Wait 15 seconds for game to load and ZIP requests to happen
  log('Waiting 15s for ZIP requests...');
  await sleep(15000);

  // Collect SW logs
  const swLogs = swCDP.logs;
  log('SW logs captured: ' + swLogs.length);

  // Filter for SW-TRACE and failures
  const swTrace = swLogs.filter(l => l.text.includes('[SW-TRACE]') || l.text.includes('[HOP]'));
  log('SW trace lines: ' + swTrace.length);

  // Print last 50 SW trace lines
  const recent = swTrace.slice(-50);
  for(const l of recent) {
    log('SW: ' + l.text);
  }

  // Print network failures
  log('\nNetwork failures: ' + netFailures.length);
  for(const f of netFailures) {
    log('FAIL: ' + f.url.slice(0,120) + ' error=' + f.error + ' type=' + f.type);
  }

  // Print all requests with 503 status
  log('\n503 responses:');
  for(const [id, req] of Object.entries(netReqs)) {
    if(req.status === 503) {
      log('503: ' + req.url.slice(0,120) + ' type=' + req.type + ' method=' + req.method);
    }
  }

  // Check for ZIP requests
  log('\nZIP requests:');
  for(const [id, req] of Object.entries(netReqs)) {
    if(req.url.includes('.zip')) {
      log('ZIP: ' + req.url.slice(0,120) + ' status=' + req.status + ' type=' + req.type);
    }
  }

  log('\nDone');
  chrome.kill();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
