import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9268;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\probe2-${Date.now()}`,
    TARGET + '/'
  ]);
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};
  function send(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({error: 'timeout'}) } }, t || 30000); }); }
  ws.on('message', d => {
    try { const m = JSON.parse(d.toString()); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } } catch (e) {}
  });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Runtime.runIfWaitingForDebugger');

  // Wait boot
  for (let i = 0; i < 40; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof __UV_BOOT_STATUS__!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) { console.log('Booted'); break; } }

  // Init browser - step by step (no async IIFE)
  console.log('Loading browser...');
  await send('Runtime.evaluate', { expression: "loadSection('browser')" });
  await sleep(500);
  await send('Runtime.evaluate', { expression: 'var m=document.getElementById("browserMount");if(m&&VoltraBrowser.render)VoltraBrowser.render(m);' });
  await sleep(1000);

  // Check iframe
  let r = await send('Runtime.evaluate', { expression: 'document.getElementById("browserFrame-main")?"YES":"NO"', returnByValue: true });
  console.log('Iframe:', r.result?.result?.value);

  // Navigate - step by step
  console.log('Navigating to google.com...');
  await send('Runtime.evaluate', { expression: 'VoltraBrowser.navigate("google.com")' });
  console.log('Navigated, waiting...');
  await sleep(8000);

  // Check status
  r = await send('Runtime.evaluate', { expression: `(function(){var f=document.getElementById('browserFrame-main');if(!f)return 'NOFRAME';try{var d=f.contentDocument;if(!d||!d.body)return 'NODOC';return 'OK text='+(d.body.innerText||'').substring(0,80)}catch(e){return 'CROSS:'+e.message}})()`, returnByValue: true });
  console.log('After nav:', r.result?.result?.value);

  // Navigate again
  console.log('Navigating to wikipedia.org...');
  await send('Runtime.evaluate', { expression: 'VoltraBrowser.navigate("wikipedia.org")' });
  await sleep(8000);

  r = await send('Runtime.evaluate', { expression: `(function(){var f=document.getElementById('browserFrame-main');if(!f)return 'NOFRAME';try{var d=f.contentDocument;if(!d||!d.body)return 'NODOC';var t=(d.body.innerText||'').substring(0,80);var b=d.body.innerHTML.trim()==='';return 'text='+t+' blank='+b}catch(e){return 'CROSS:'+e.message}})()`, returnByValue: true });
  console.log('After nav2:', r.result?.result?.value);

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
