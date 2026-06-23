import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9281;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cnn4-${Date.now()}`,
    TARGET + '/'
  ]);
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};
  const cdpLogs = [];

  function send(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, t || 30000); }); }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => {
          if (a.value !== undefined) return a.value;
          if (a.description) return a.description;
          return JSON.stringify(a);
        }).join(' ');
        cdpLogs.push({ ts: Date.now(), msg: args });
      }
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    } catch (e) {}
  });

  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Console.enable');
  await send('Runtime.runIfWaitingForDebugger');

  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression: 'typeof VoltraBrowser !== "undefined"', returnByValue: true });
    if (r.result?.result?.value) break;
  }

  // Verify navigateToUrl
  const r1 = await send('Runtime.evaluate', { expression: 'typeof navigateToUrl', returnByValue: true });
  console.log('navigateToUrl:', r1.result?.result?.value);

  const r2 = await send('Runtime.evaluate', { expression: 'JSON.stringify({vb:typeof VoltraBrowser,b:typeof VoltraBrowser._browserUI,l:typeof VoltraBrowser._browserUI._loadUrlInFrame,f:typeof VoltraBrowser._browserUI._flushPendingNavigations,p:typeof window.__UV_BOOT_STATUS__})', returnByValue: true });
  console.log('State:', r2.result?.result?.value);

  // Check the address bar input exists
  const r3 = await send('Runtime.evaluate', { expression: 'typeof document.getElementById("urlInput")', returnByValue: true });
  console.log('urlInput:', r3.result?.result?.value);

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
