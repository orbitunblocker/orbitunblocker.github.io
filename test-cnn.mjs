import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9272;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cnn-${Date.now()}`,
    TARGET + '/'
  ]);
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};
  function send(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, t || 30000); }); }
  ws.on('message', d => { try { const m = JSON.parse(d.toString()); if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; } } catch(e){} });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable'); await send('Runtime.enable'); await send('Runtime.runIfWaitingForDebugger');

  for (let i = 0; i < 40; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof __UV_BOOT_STATUS__!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) break; }

  await send('Runtime.evaluate', { expression: "if(typeof loadSection==='function')loadSection('browser')" });
  await sleep(300);
  await send('Runtime.evaluate', { expression: 'var m=document.getElementById("browserMount");if(m&&VoltraBrowser.render)VoltraBrowser.render(m);' });
  await sleep(1000);

  // Navigate to cnn.com
  console.log('Navigating to cnn.com...');
  await send('Runtime.evaluate', { expression: 'VoltraBrowser.navigate("cnn.com")' });

  // Check every second for 30 seconds
  for (let s = 1; s <= 30; s++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', {
      expression: `(function(){var f=document.getElementById("browserFrame-main");if(!f)return "sec=${s} NOFRAME";try{var d=f.contentDocument;if(!d||!d.body)return "sec=${s} NODOC";var t=(d.body.innerText||"").trim();var hl=d.body.innerHTML.length;var blank=d.body.innerHTML.trim()==="";return "sec=${s} text="+(t.substring(0,80)||"(empty)")+" htmlLen="+hl+" blank="+blank}catch(e){return "sec=${s} CROSS:"+e.message}})()`,
      returnByValue: true
    });
    const val = r.result?.result?.value;
    console.log(val);
    // If we got content, stop checking
    if (val && !val.includes('NOFRAME') && !val.includes('NODOC') && !val.includes('(empty)')) {
      if (!val.includes('blank=true')) break;
    }
  }

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
