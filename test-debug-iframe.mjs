import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9264;
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
    '--no-first-run', '--disable-extensions', '--disable-popup-blocking',
    '--disable-default-apps', '--allow-insecure-localhost',
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-dbg-${Date.now()}`,
    TARGET + '/'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  console.log('Chrome ready');

  let pt;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`);
    pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy'));
    if (pt) break;
  }
  if (!pt) { console.log('FAIL: No page'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};
  function send(m, p) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, 15000); }); }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        console.log('CONSOLE:', m.params.args.map(a => a.value || a.description || '').join(' '));
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
  for (let i = 0; i < 40; i++) { await sleep(1500); const r = await send('Runtime.evaluate', { expression: 'typeof __UV_BOOT_STATUS__!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) break; }
  console.log('Booted');

  // Check initial state
  let r = await send('Runtime.evaluate', { expression: 'window.location.href', returnByValue: true });
  console.log('URL:', r.result?.result?.value);

  r = await send('Runtime.evaluate', { expression: 'typeof VoltraBrowser', returnByValue: true });
  console.log('VoltraBrowser:', r.result?.result?.value);

  r = await send('Runtime.evaluate', { expression: 'typeof loadSection', returnByValue: true });
  console.log('loadSection:', r.result?.result?.value);

  r = await send('Runtime.evaluate', { expression: 'Array.from(document.querySelectorAll("iframe")).map(f=>f.id+"="+(f.src||"(srcdoc)")).join("|")', returnByValue: true });
  console.log('Iframes before:', r.result?.result?.value);

  r = await send('Runtime.evaluate', { expression: 'typeof render', returnByValue: true });
  console.log('render:', r.result?.result?.value);

  // Try loadSection
  r = await send('Runtime.evaluate', { expression: `(async()=>{if(typeof loadSection==='function')loadSection('browser');await new Promise(r=>setTimeout(r,5000));return 'done'})()`, awaitPromise: true });
  console.log('loadSection complete');

  r = await send('Runtime.evaluate', { expression: 'Array.from(document.querySelectorAll("iframe")).map(f=>f.id+"="+(f.src||"(srcdoc)")).join("|")', returnByValue: true });
  console.log('Iframes after loadSection:', r.result?.result?.value);

  r = await send('Runtime.evaluate', { expression: 'var f=document.getElementById("browserFrame-main");f?("OK src="+f.src):"NULL"', returnByValue: true });
  console.log('browserFrame-main:', r.result?.result?.value);

  // Try render('home')
  r = await send('Runtime.evaluate', { expression: `(async()=>{if(typeof render==='function')render('home');await new Promise(r=>setTimeout(r,3000));return 'done'})()`, awaitPromise: true });
  console.log('render home complete');

  r = await send('Runtime.evaluate', { expression: 'Array.from(document.querySelectorAll("iframe")).map(f=>f.id+"="+(f.src||"(srcdoc)")).join("|")', returnByValue: true });
  console.log('Iframes after render:', r.result?.result?.value);

  r = await send('Runtime.evaluate', { expression: 'var f=document.getElementById("browserFrame-main");f?("OK src="+f.src):"NULL"', returnByValue: true });
  console.log('browserFrame-main:', r.result?.result?.value);

  // Check if there's an error in rendering
  r = await send('Runtime.evaluate', { expression: `document.querySelector('#browser-container, #browser-section, #app-content, #main-content, #root, .browser-container, .app-container')?.id || 'none found'`, returnByValue: true });
  console.log('Container element:', r.result?.result?.value);

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
