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
  const CDP_PORT = 9291;
  try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(4000); } catch (e) {}

  const chrome = spawn(
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    [
      `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu',
      '--no-first-run', '--disable-extensions',
      '--disable-popup-blocking', '--disable-default-apps',
      '--allow-insecure-localhost',
      `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cdbg4-${Date.now()}`,
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
  }
  console.log('Booted');

  // Try to trigger UI by calling render or loadSection
  let r = await send('Runtime.evaluate', { expression: 'typeof loadSection', returnByValue: true });
  console.log('loadSection type:', r.result?.result?.value);

  if (r.result?.result?.value === 'function') {
    await send('Runtime.evaluate', { expression: 'loadSection("home")' });
    await sleep(2000);
    r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({bf:!!document.getElementById("browserFrame-main"),gf:!!document.getElementById("gameFrame"),ifr:document.querySelectorAll("iframe").length})',
      returnByValue: true
    });
    console.log('After loadSection("home"):', r.result?.result?.value);
  }

  // Check game section
  r = await send('Runtime.evaluate', { expression: 'typeof openGame', returnByValue: true });
  console.log('openGame type:', r.result?.result?.value);

  if (r.result?.result?.value === 'function') {
    await send('Runtime.evaluate', { expression: 'openGame("fruit-ninja")' });
    await sleep(3000);
    r = await send('Runtime.evaluate', {
      expression: 'JSON.stringify({gf:!!document.getElementById("gameFrame"),ifr:document.querySelectorAll("iframe").length,innerHTML:(function(){var f=document.getElementById("gameFrame");if(!f)return"noframe";try{return f.src.substring(0,120)}catch(e){return"err:"+e.message}})()})',
      returnByValue: true
    });
    console.log('After openGame:', r.result?.result?.value);
  }

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
