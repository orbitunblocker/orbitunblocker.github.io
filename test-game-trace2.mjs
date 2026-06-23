import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9275;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function reqJSON(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }); }).on('error', reject);
  });
}

async function main() {
  try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(4000); } catch (e) {}
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-extensions',
    '--disable-popup-blocking', '--disable-default-apps', '--allow-insecure-localhost',
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\gtrace2-${Date.now()}`,
    TARGET + '/'
  ]);
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};
  const logs = [];
  const exceptions = [];
  const networkReqs = [];
  const failedReqs = [];
  const responses = {};

  function send(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, t || 30000); }); }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
        logs.push({ ts: Date.now(), level: m.params.type, msg: args });
      }
      if (m.method === 'Runtime.exceptionThrown') {
        exceptions.push({ ts: Date.now(), text: m.params.exceptionDetails.text, stack: m.params.exceptionDetails.stackTrace });
      }
      if (m.method === 'Network.requestWillBeSent') {
        const r = m.params.request;
        networkReqs.push({ ts: Date.now(), id: m.params.requestId, url: r.url, method: r.method, type: m.params.type, failed: false, status: null });
      }
      if (m.method === 'Network.responseReceived') {
        const resp = m.params.response;
        responses[m.params.requestId] = { status: resp.status, url: resp.url, mimeType: resp.mimeType, ts: Date.now() };
        if (resp.status >= 400) {
          const existing = networkReqs.find(x => x.id === m.params.requestId);
          if (existing) { existing.failed = true; existing.status = resp.status; }
          failedReqs.push({ ts: Date.now(), url: resp.url, status: resp.status, reqId: m.params.requestId });
        }
      }
      if (m.method === 'Network.loadingFailed') {
        const existing = networkReqs.find(x => x.id === m.params.requestId);
        if (existing) { existing.failed = true; existing.status = 'failed'; }
        failedReqs.push({ ts: Date.now(), url: existing ? existing.url : 'unknown', status: 'failed', errorText: m.params.errorText, reqId: m.params.requestId });
      }
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    } catch (e) {}
  });

  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Console.enable');
  await send('Network.enable');
  await send('Runtime.runIfWaitingForDebugger');

  for (let i = 0; i < 40; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof __UV_BOOT_STATUS__!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) break; }

  const gameId = 'minecraft';
  const launchTs = Date.now();
  console.log(`Launching ${gameId} at T+0`);

  await send('Runtime.evaluate', { expression: `openGame("${gameId}")` });

  // Wait 16 seconds — enough for the initial page to load and subresource requests to fail
  for (let sec = 1; sec <= 16; sec++) {
    await sleep(1000);

    // Read iframe contentDocument HTML
    const r = await send('Runtime.evaluate', {
      expression: `(function(){var f=document.getElementById('gameFrame');if(!f)return 'NOFRAME';try{var d=f.contentDocument;if(!d||!d.body)return JSON.stringify({html:'NODOC',len:0});var html=d.documentElement?d.documentElement.outerHTML:'';return JSON.stringify({html:html.substring(0,500),len:html.length})}catch(e){return JSON.stringify({html:'CROSS:'+e.message,len:-1})}})()`,
      returnByValue: true
    });
    const val = r.result?.result?.value;
    try {
      const parsed = JSON.parse(val);
      if (parsed.len > 100) {
        console.log(`T+${sec}: htmlLen=${parsed.len} preview=${parsed.html.substring(0,300)}`);
        // If we see the actual game HTML content, we can stop
      } else {
        console.log(`T+${sec}: htmlLen=${parsed.len} ${parsed.html.substring(0,150)}`);
      }
    } catch(e) {
      console.log(`T+${sec}: ${String(val).substring(0,200)}`);
    }
  }

  // Print failed requests
  console.log('\n\n=== FAILED NETWORK REQUESTS ===');
  const seen = new Set();
  for (const f of failedReqs) {
    if (!seen.has(f.url)) {
      seen.add(f.url);
      const elapsed = Math.round((f.ts - launchTs) / 1000);
      console.log(`T+${elapsed}s | ${f.status}${f.errorText ? ' error=' + f.errorText : ''} | ${f.url.substring(0,130)}`);
    }
  }

  // Print first relevant console errors
  console.log('\n=== CONSOLE LOGS (first 20 after launch) ===');
  const afterLaunch = logs.filter(l => l.ts >= launchTs).slice(0, 20);
  for (const l of afterLaunch) {
    const elapsed = Math.round((l.ts - launchTs) / 1000);
    console.log(`T+${elapsed}s | ${l.level}: ${l.msg.substring(0,200)}`);
  }

  // Exceptions
  if (exceptions.length > 0) {
    console.log('\n=== EXCEPTIONS ===');
    for (const e of exceptions) {
      const elapsed = Math.round((e.ts - launchTs) / 1000);
      console.log(`T+${elapsed}s | ${e.text.substring(0,200)}`);
    }
  }

  // Network request count
  console.log(`\n=== SUMMARY ===`);
  console.log(`Total requests: ${networkReqs.length}`);
  console.log(`Failed: ${failedReqs.length}`);
  console.log(`Console logs (after launch): ${afterLaunch.length}`);
  console.log(`Exceptions: ${exceptions.length}`);

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
