import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9267;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\probe-${Date.now()}`,
    TARGET + '/'
  ]);
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {}, logs = [];
  function send(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({error: 'timeout'}) } }, t || 30000); }); }
  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') logs.push(m.params.args.map(a => a.value || a.description || '').join(' '));
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    } catch (e) {}
  });
  ws.on('error', () => {});
  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Console.enable');
  await send('Runtime.runIfWaitingForDebugger');

  // Wait boot
  for (let i = 0; i < 40; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof __UV_BOOT_STATUS__!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) { console.log('Booted'); break; } }

  // Init browser
  let r = await send('Runtime.evaluate', {
    expression: `(async()=>{try{loadSection('browser');await new Promise(r=>setTimeout(r,300));var m=document.getElementById('browserMount');if(m&&VoltraBrowser.render)VoltraBrowser.render(m);await new Promise(r=>setTimeout(r,500));var f=document.getElementById('browserFrame-main');return f?'OK':'NOFRAME'}catch(e){return 'ERR:'+e.message}})()`,
    awaitPromise: true
  });
  console.log('Init:', r.result?.result?.value || r.error);

  // Phase 1a: 3 navigations
  for (let i = 0; i < 3; i++) {
    console.time('nav' + i);
    r = await send('Runtime.evaluate', {
      expression: `(async()=>{try{var ts=Date.now();var f=document.getElementById('browserFrame-main');console.log('[NAV' + ${i} + '] before: src='+(f?f.src:'null'));VoltraBrowser.navigate('google.com');await new Promise(r=>setTimeout(r,5000));f=document.getElementById('browserFrame-main');var text='';try{text=(f.contentDocument.body.innerText||'').substring(0,100)}catch(e){text='CORS:'+e.message}console.log('[NAV${i}] after: src='+(f?f.src:'null')+' text='+text);return 'OK'})catch(e){return 'ERR:'+e.message}})()`,
      awaitPromise: true
    });
    console.log('  Nav ' + i + ':', r.result?.result?.value || r.error);
    console.timeEnd('nav' + i);
  }

  console.log('\nConsole logs:');
  logs.slice(-15).forEach(l => console.log('  ', l));

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
