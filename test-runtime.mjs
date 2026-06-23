import { spawn } from 'child_process';
import http from 'http';
import fs from 'fs';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASEDIR = 'C:\\Users\\abeni\\Downloads\\orbit';
const CDP_PORT = 9257;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function reqJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }); }).on('error', reject);
  });
}

async function setup() {
  try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(4000); } catch (e) {}
  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-extensions', '--disable-popup-blocking',
    '--disable-default-apps', '--allow-insecure-localhost',
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-rt-${Date.now()}`,
    'http://127.0.0.1:8080/'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let chromeErr = '';
  chrome.stderr.on('data', d => { chromeErr += d.toString(); });
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  console.log('Chrome ready');
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('127.0.0.1:8080')); if (pt) break; }
  if (!pt) { console.log('FAIL: No page'); chrome.kill(); process.exit(1); }
  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  return { chrome, ws, chromeErr };
}

async function main() {
  const { chrome, ws, chromeErr } = await setup();
  let mid = 0, pending = {};
  const logs = [];
  function send(m, p) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, 30000); }); }
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
  for (let i = 0; i < 30; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof window.__UV_BOOT_STATUS__!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) { console.log('Booted'); break; } }

  // Load browser
  await send('Runtime.evaluate', { expression: `(async()=>{if(typeof loadSection==='function')loadSection('browser');await new Promise(r=>setTimeout(r,4000))})()`, awaitPromise: true });
  console.log('Browser loaded');

  // Run ALL tests in a single evaluation — inject a test runner
  const testScript = fs.readFileSync(BASEDIR + '/test-runtime-inner.js', 'utf-8');
  const runAll = await send('Runtime.evaluate', { expression: testScript, awaitPromise: true, returnByValue: true });
  const results = runAll.result?.result?.value;

  console.log(results);

  // Console logs
  console.log('\n========== CONSOLE LOGS ==========');
  const relevant = logs.filter(l => l.msg.match(/PORT|defer|flush|error|recovery|game|503|worker|timeout|Pending|\/service\//i));
  relevant.slice(0, 50).forEach(l => console.log('  [' + new Date(l.ts).toISOString() + '] ' + l.level + ': ' + l.msg));
  if (relevant.length === 0) console.log('  (none)');

  console.log('\n========== CHROME STDERR ==========');
  chromeErr.split('\n').filter(l=>l).slice(-5).forEach(l => console.log('  ' + l));

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 1000);
}
main().catch(e => { console.error(e.stack); process.exit(1); });
