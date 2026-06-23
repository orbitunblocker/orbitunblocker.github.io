import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9286;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cnns-${Date.now()}`,
    TARGET + '/'
  ]);
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};

  function send(m, p, t) {
    return new Promise(r => {
      const id = ++mid;
      pending[id] = r;
      ws.send(JSON.stringify({ id, method: m, params: p }));
      setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, t || 30000);
    });
  }

  const cdpLogs = [];
  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
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
    const r = await send('Runtime.evaluate', { expression: 'typeof VoltraBrowser', returnByValue: true });
    if (r.result?.result?.value === 'object') break;
  }
  console.log('Proxy ready');

  // Navigate and track
  const launchTs = Date.now();
  await send('Runtime.evaluate', { expression: 'VoltraBrowser._browserUI.navigate("https://www.cnn.com")' });

  for (let sec = 1; sec <= 20; sec++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', { expression: 'document.getElementById("browserFrame-main").src.substring(0,130)', returnByValue: true });
    const src = r.result?.result?.value || '?';
    console.log(`T+${sec}: ${src.substring(0,130)}`);
  }

  // Print relevant console logs
  console.log('\n=== RELEVANT LOGS ===');
  for (const c of cdpLogs) {
    const elapsed = Math.round((c.ts - launchTs) / 1000);
    if (elapsed < 0 || elapsed > 25) continue;
    if (c.msg.includes('DEFER') || c.msg.includes('FLUSH') || c.msg.includes('HOP') || c.msg.includes('SW-FETCH') || c.msg.includes('error-card') || c.msg.includes('_showErrorPage') || c.msg.includes('Timeout')) {
      console.log(`T+${elapsed}s | ${c.msg.substring(0,250)}`);
    }
  }

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
