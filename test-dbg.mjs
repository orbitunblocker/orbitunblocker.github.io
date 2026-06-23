import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9266;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-dbg3-${Date.now()}`,
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
  const logs = [];
  function send(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, t || 15000); }); }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
        logs.push({ ts: Date.now(), msg: args });
        if (args.includes('[DBG]') || args.includes('ERROR')) console.log('  CONSOLE:', args);
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
  for (let i = 0; i < 40; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof __UV_BOOT_STATUS__!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) { console.log('Booted'); break; } }

  // Check methods
  let r = await send('Runtime.evaluate', { expression: 'typeof VoltraBrowser !== "undefined" && typeof VoltraBrowser.render === "function"', returnByValue: true });
  console.log('VoltraBrowser.render exists:', r.result?.result?.value);

  // Direct render test - scrape the full debug approach
  const debugScript = `
(async () => {
  try {
    // 1. Call loadSection('browser')
    console.log('[DBG] calling loadSection browser');
    if (typeof loadSection === 'function') loadSection('browser');
    await new Promise(r => setTimeout(r, 100));
    
    // 2. Check what happened
    console.log('[DBG] mainContent innerHTML:', (document.getElementById('mainContent') || {}).innerHTML?.substring(0, 200) || 'NO mainContent');
    
    const mount = document.getElementById('browserMount');
    console.log('[DBG] mount:', mount ? mount.id + ' innerHTML=' + mount.innerHTML.substring(0, 50) : 'null');
    
    // 3. Now explicitly call render
    if (mount && typeof VoltraBrowser !== 'undefined' && typeof VoltraBrowser.render === 'function') {
      console.log('[DBG] calling VoltraBrowser.render(mount)');
      VoltraBrowser.render(mount);
      console.log('[DBG] render completed');
    } else {
      console.log('[DBG] cannot render: mount=' + !!mount + ' VoltraBrowser=' + (typeof VoltraBrowser));
    }
    
    await new Promise(r => setTimeout(r, 100));
    
    // 4. Check for iframe
    const ifr = document.getElementById('browserFrame-main');
    console.log('[DBG] iframe:', ifr ? 'EXISTS src=' + ifr.src + ' srcdoc=' + (ifr.srcdoc ? ifr.srcdoc.length : 0) : 'null');
    
    // All iframes
    const allIframes = Array.from(document.querySelectorAll('iframe')).map(f => f.id + '=' + (f.src || '(srcdoc)')).join(' | ');
    console.log('[DBG] all iframes:', allIframes || '(none)');
    
    // Check browser-viewport
    const vp = document.getElementById('browserViewport');
    console.log('[DBG] viewport:', vp ? vp.innerHTML.substring(0, 200) : 'null');
    
    return document.getElementById('browserFrame-main') ? 'OK' : 'NO IFRAME';
  } catch(e) {
    console.log('[DBG] ERROR:', e.message, e.stack?.substring(0, 500));
    return 'ERR: ' + e.message;
  }
})()
`;

  r = await send('Runtime.evaluate', { expression: debugScript, awaitPromise: true, returnByValue: true });
  console.log('Result:', r.result?.result?.value);

  // Print all DBG logs
  console.log('\nAll [DBG] logs:');
  logs.filter(l => l.msg.includes('[DBG]')).forEach(l => console.log('  ', l.msg));

  // Check browser-engine for errors
  r = await send('Runtime.evaluate', { expression: 'typeof browserUI', returnByValue: true });
  console.log('browserUI global:', r.result?.result?.value);

  r = await send('Runtime.evaluate', { expression: 'typeof BrowserUI', returnByValue: true });
  console.log('BrowserUI class:', r.result?.result?.value);

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
