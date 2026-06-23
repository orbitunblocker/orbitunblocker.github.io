import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASEDIR = 'C:\\Users\\abeni\\Downloads\\orbit';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9261;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const CDP_TIMEOUT = 60000; // 60s per evaluation

function req(host, path) {
  const mod = host.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(host + path, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d, headers: r.headers })); }).on('error', reject);
  });
}

function reqJSON(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }); }).on('error', reject);
  });
}

async function main() {
  // Verify Railway
  console.log('=== CHECKING RAILWAY DEPLOYMENT ===');
  try {
    const resp = await req(TARGET, '/');
    console.log('Railway:', resp.status, resp.body.length + 'b');
    const sw = await req(TARGET, '/sw.js');
    console.log('sw.js:', sw.status, sw.body.length + 'b', 'SW-Allowed:', sw.headers['service-worker-allowed']);
    const app = await req(TARGET, '/js/app.js');
    console.log('app.js:', app.status, app.body.length + 'b');
    const eng = await req(TARGET, '/js/browser-engine.js');
    console.log('browser-engine.js:', eng.status, eng.body.length + 'b');
  } catch (e) {
    console.log('FAIL: Cannot reach Railway:', e.message);
    process.exit(1);
  }

  // Kill stale Chrome
  try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(4000); } catch (e) {}

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-extensions', '--disable-popup-blocking',
    '--disable-default-apps', '--allow-insecure-localhost',
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-rail-${Date.now()}`,
    TARGET + '/'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let chromeErr = '';
  chrome.stderr.on('data', d => { chromeErr += d.toString(); });

  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  console.log('Chrome ready');

  let pt;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`);
    pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy'));
    if (pt) break;
  }
  if (!pt) { console.log('FAIL: No Railway page'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};
  const logs = [];

  function send(m, p) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({error: 'timeout'}) } }, CDP_TIMEOUT); }); }
  function sendLong(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({error: 'timeout'}) } }, t || 300000); }); }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
        logs.push({ ts: Date.now(), level: m.params.type, msg: args });
      }
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    } catch (e) {}
  });
  ws.on('error', () => {});
  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Console.enable');
  await send('Runtime.runIfWaitingForDebugger');

  // Wait for boot
  console.log('Waiting for boot...');
  for (let i = 0; i < 40; i++) {
    await sleep(1500);
    const r = await send('Runtime.evaluate', { expression: `typeof window.__UV_BOOT_STATUS__ !== 'undefined'`, returnByValue: true });
    if (r.result?.result?.value) { console.log('Booted'); break; }
  }

  // Load browser section
  await send('Runtime.evaluate', { expression: `(async()=>{if(typeof loadSection==='function')loadSection('browser');await new Promise(r=>setTimeout(r,5000))})()`, awaitPromise: true });
  console.log('Browser loaded');

  // Check boot state
  const bc = await send('Runtime.evaluate', { expression: `JSON.stringify({pw:window.__UV_BOOT_STATUS__.portReady,sw:window.__UV_BOOT_STATUS__.swPortStatus,bm:window.__UV_BOOT_STATUS__.bareMuxReady,swr:window.__UV_BOOT_STATUS__.swReady,fail:window.__UV_BOOT_STATUS__.failedStage})`, returnByValue: true });
  console.log('Boot:', bc.result?.result?.value);

  // Read and split the inner test script into individual test functions
  const innerScript = fs.readFileSync(BASEDIR + '/test-railway-inner.js', 'utf-8');

  // Run the inner script with a very long timeout
  console.log('\nRunning 10 Railway diagnostics (may take up to 5 min)...\n');
  const result = await sendLong('Runtime.evaluate', { expression: innerScript, awaitPromise: true, returnByValue: true }, 600000);
  const output = result.result?.result?.value || result.error || 'NO OUTPUT';
  console.log(output);

  // Console logs
  const relevant = logs.filter(l => l.msg.match(/PORT|defer|flush|DEFER|FLUSH|error|RECOVERY|game|worker|timeout|\/service\/|[A-Z]+-ROUTE|503|blank|recovery|REINIT|refreshPort/i));
  if (relevant.length > 0) {
    console.log('\n========== RELEVANT CONSOLE LOGS ==========');
    relevant.slice(0, 60).forEach(l => console.log('  [' + new Date(l.ts).toISOString() + '] ' + l.level + ': ' + l.msg));
  }

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 1000);
}
main().catch(e => { console.error(e.stack); process.exit(1); });
