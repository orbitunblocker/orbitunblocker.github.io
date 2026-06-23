import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function reqJSON(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }); }).on('error', reject);
  });
}

async function main() {
  const CDP_PORT = 9290;
  try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(4000); } catch (e) {}

  const chrome = spawn(
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    [
      `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu',
      '--no-first-run', '--disable-extensions',
      '--disable-popup-blocking', '--disable-default-apps',
      '--allow-insecure-localhost',
      `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cdbg3-${Date.now()}`,
      'https://orbitproxy.up.railway.app/'
    ]
  );

  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};

  function send(m, p, t) {
    return new Promise(r => {
      const id = ++mid; pending[id] = r;
      ws.send(JSON.stringify({ id, method: m, params: p }));
      setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, t || 30000);
    });
  }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    } catch (e) {}
  });

  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Runtime.runIfWaitingForDebugger');

  for (let i = 0; i < 60; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression: 'typeof VoltraBrowser', returnByValue: true });
    if (r.result?.result?.value === 'object') break;
    if (i % 5 === 0) console.log('Waiting...', i);
  }
  console.log('Booted');

  // Check for various DOM elements
  const r1 = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({browserFrame:!!document.getElementById("browserFrame-main"),gameFrame:!!document.getElementById("gameFrame"),mainContent:!!document.getElementById("mainContent"),browserMount:!!document.getElementById("browserMount"),totalIframes:document.querySelectorAll("iframe").length,totalDivs:document.querySelectorAll("div").length})',
    returnByValue: true
  });
  console.log('DOM state:', r1.result?.result?.value);

  // Check what the page actually shows
  const r2 = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({visible:document.querySelector(".main-content")?"yes":"no",hidden:document.querySelector(\'[style*="display: none"]\')?"yes":"no",sections:document.querySelectorAll(".section-content").length})',
    returnByValue: true
  });
  console.log('Visible UI:', r2.result?.result?.value);

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
