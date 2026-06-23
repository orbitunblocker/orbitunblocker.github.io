import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9274;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\gtrace-${Date.now()}`,
    TARGET + '/'
  ]);
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  console.log('Chrome ready');
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};

  // Data collectors
  const logs = [];
  const exceptions = [];
  const networkReqs = [];     // All requests
  const failedReqs = [];      // Failed/s failed requests
  const responses = {};       // requestId -> response info

  function send(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, t || 30000); }); }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      // Console
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
        logs.push({ ts: Date.now(), level: m.params.type, msg: args });
      }
      // Exceptions
      if (m.method === 'Runtime.exceptionThrown') {
        exceptions.push({ ts: Date.now(), text: m.params.exceptionDetails.text, stack: m.params.exceptionDetails.stackTrace });
      }
      // Network request will be sent
      if (m.method === 'Network.requestWillBeSent') {
        const r = m.params.request;
        networkReqs.push({
          ts: Date.now(),
          id: m.params.requestId,
          url: r.url,
          method: r.method,
          type: m.params.type,
          initiator: m.params.initiator?.type || 'unknown',
          failed: false,
          status: null
        });
      }
      // Network response received
      if (m.method === 'Network.responseReceived') {
        const resp = m.params.response;
        responses[m.params.requestId] = {
          status: resp.status,
          statusText: resp.statusText,
          url: resp.url,
          mimeType: resp.mimeType,
          ts: Date.now()
        };
        // Mark as failed if status >= 400
        if (resp.status >= 400) {
          const existing = networkReqs.find(x => x.id === m.params.requestId);
          if (existing) {
            existing.failed = true;
            existing.status = resp.status;
            failedReqs.push({ ts: Date.now(), url: resp.url, status: resp.status, statusText: resp.statusText, type: existing.type, reqId: m.params.requestId });
          }
        }
      }
      // Network loading failed
      if (m.method === 'Network.loadingFailed') {
        const existing = networkReqs.find(x => x.id === m.params.requestId);
        if (existing) {
          existing.failed = true;
          existing.status = 'failed';
          failedReqs.push({ ts: Date.now(), url: existing.url, status: 'failed', errorText: m.params.errorText, type: existing.type, blockedReason: m.params.blockedReason || 'none', corsError: m.params.corsErrorStatus || 'none', reqId: m.params.requestId });
        }
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

  // Wait for boot
  console.log('Waiting for boot...');
  for (let i = 0; i < 40; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof __UV_BOOT_STATUS__!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) { console.log('Booted'); break; } }

  const gameId = 'minecraft';
  const gameUrl = 'https://minecrafteaglercraft.gitlab.io/go/minecraft-1.5.2/';
  const bootTs = Date.now();
  console.log(`\nLaunching game: ${gameId} (${gameUrl})`);

  // Launch the game
  await send('Runtime.evaluate', { expression: `openGame("${gameId}")` });
  const launchTs = Date.now();
  console.log(`T+0: openGame("${gameId}") called`);

  // Monitor for 30 seconds
  for (let sec = 1; sec <= 30; sec++) {
    await sleep(1000);

    // Check game frame state
    const r = await send('Runtime.evaluate', {
      expression: `(function(){var f=document.getElementById('gameFrame');if(!f)return JSON.stringify({frame:'NOFRAME'});try{var d=f.contentDocument;if(!d||!d.body)return JSON.stringify({frame:'EXISTS',src:f.src||'(blank)',doc:'NODOC',srcdoc:!!f.srcdoc});var t=(d.body.innerText||'').trim().substring(0,120);var hl=d.body.innerHTML.length;return JSON.stringify({frame:'EXISTS',src:f.src||'(blank)',text:t,htmlLen:hl,srcdoc:!!f.srcdoc})}catch(e){return JSON.stringify({frame:'EXISTS',src:f.src||'(blank)',doc:'CROSS:'+e.message,srcdoc:!!f.srcdoc})}})()`,
      returnByValue: true
    });
    const state = r.result?.result?.value;
    try { const s = JSON.parse(state); console.log(`T+${sec}: ${JSON.stringify(s)}`); } catch(e) { console.log(`T+${sec}: ${state}`); }

    // If the game HTML loaded (htmlLen > 1000 or text is meaningful), note it
    if (state && state.includes('htmlLen') && !state.includes('htmlLen:0')) {
      // Could jump to checking JS bundles, but let's just note it
    }
  }

  // Report
  const now = Date.now();
  console.log('\n\n========== GAME TRACE COMPLETE ==========\n');

  // Network requests summary
  console.log('--- NETWORK REQUESTS ---');
  const uniqFailed = [];
  const seenUrls = new Set();
  for (const fr of failedReqs) {
    if (!seenUrls.has(fr.url)) {
      seenUrls.add(fr.url);
      uniqFailed.push(fr);
    }
  }

  if (uniqFailed.length === 0) {
    console.log('No failed network requests');
  } else {
    console.log(`Total failed requests: ${uniqFailed.length}`);
    for (const f of uniqFailed) {
      const elapsed = Math.round((f.ts - launchTs) / 1000);
      console.log(`T+${elapsed}s | ${f.status} | ${f.url.substring(0,120)} ${f.errorText ? 'error=' + f.errorText : ''} ${f.blockedReason !== 'none' ? 'blocked=' + f.blockedReason : ''} ${f.corsError !== 'none' ? 'cors=' + f.corsError : ''}`);
    }
  }

  // Console errors
  console.log('\n--- CONSOLE ERRORS / WARNINGS ---');
  const errors = logs.filter(l => l.level === 'error' || l.level === 'warning');
  if (errors.length === 0) {
    console.log('No console errors or warnings');
  } else {
    for (const e of errors) {
      const elapsed = Math.round((e.ts - launchTs) / 1000);
      console.log(`T+${elapsed}s | ${e.level}: ${e.msg.substring(0,200)}`);
    }
  }

  // All console logs (key ones)
  console.log('\n--- ALL CONSOLE (game-related) ---');
  const gameLogs = logs.filter(l => l.msg.match(/game|GAME|frame|load|error|ERROR|503|timeout|proxy|worker|PORT|port/));
  if (gameLogs.length === 0) {
    console.log('(none)');
  } else {
    for (const l of gameLogs) {
      const elapsed = Math.round((l.ts - launchTs) / 1000);
      console.log(`T+${elapsed}s | ${l.level}: ${l.msg}`);
    }
  }

  // Exceptions
  if (exceptions.length > 0) {
    console.log('\n--- JS EXCEPTIONS ---');
    for (const e of exceptions) {
      const elapsed = Math.round((e.ts - launchTs) / 1000);
      console.log(`T+${elapsed}s | ${e.text.substring(0,200)}`);
    }
  }

  // First failure point
  console.log('\n--- FIRST FAILURE ---');
  const allEvents = [];

  for (const fr of failedReqs) allEvents.push({ ts: fr.ts, type: 'network', detail: `${fr.status} ${fr.url.substring(0,100)}` });
  for (const e of errors) allEvents.push({ ts: e.ts, type: 'console-' + e.level, detail: e.msg.substring(0,100) });
  for (const e of exceptions) allEvents.push({ ts: e.ts, type: 'exception', detail: e.text.substring(0,100) });

  allEvents.sort((a, b) => a.ts - b.ts);

  if (allEvents.length === 0) {
    console.log('No failures detected');
  } else {
    const first = allEvents[0];
    const elapsed = Math.round((first.ts - launchTs) / 1000);
    console.log(`First event at T+${elapsed}s`);
    console.log(`Type: ${first.type}`);
    console.log(`Detail: ${first.detail}`);
  }

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
