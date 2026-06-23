import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9280;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cnn3-${Date.now()}`,
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
  await send('Network.enable');
  await send('Runtime.runIfWaitingForDebugger');

  for (let i = 0; i < 40; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof VoltraBrowser!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) break; }

  // Navigate using the app's own navigateToUrl (uses proper UV encoding)
  console.log('=== NAVIGATING TO cnn.com via navigateToUrl ===');
  const launchTs = Date.now();
  await send('Runtime.evaluate', { expression: 'navigateToUrl("https://www.cnn.com")' });

  for (let sec = 1; sec <= 20; sec++) {
    await sleep(1000);
    // Check browser iframe src and whether content shows error/blank
    const r = await send('Runtime.evaluate', {
      expression: `(function(){var f=document.getElementById('browserFrame-main');if(!f)return 'NOFRAME';var src=f.src||'';try{var d=f.contentDocument;if(!d)return JSON.stringify({s:src.substring(0,120),st:'NODOC'});var h=d.documentElement?d.documentElement.outerHTML:'';var t=d.body?d.body.innerText||'':'':'';var er=h.includes('error-card')||h.includes('Proxy Not Ready')||h.includes('Proxy Error')||h.includes('Proxy Timeout')||h.includes('Timeout');return JSON.stringify({s:src.substring(0,80),st:er?'ERROR':t.trim().length===0?'BLANK':'CONTENT',l:h.length,t:t.substring(0,100)})}catch(e){return JSON.stringify({s:src.substring(0,120),st:'CROSS:'+e.message})}})()`,
      returnByValue: true
    });
    const val = r.result?.result?.value;
    try {
      const p = JSON.parse(val);
      console.log(`T+${sec}: src=${p.s} state=${p.st} len=${p.l || '?'}`);
    } catch(e) {
      console.log(`T+${sec}: ${String(val).substring(0,120)}`);
    }
  }

  // Print relevant console logs
  console.log('\n=== KEY CONSOLE LOGS ===');
  for (const c of cdpLogs) {
    const elapsed = Math.round((c.ts - launchTs) / 1000);
    if (elapsed < 0 || elapsed > 25) continue;
    if (c.msg.includes('DEFER') || c.msg.includes('FLUSH') || c.msg.includes('error-card') || c.msg.includes('_showErrorPage') || c.msg.includes('Timeout') || c.msg.includes('Error')) {
      console.log(`T+${elapsed}s | ${c.msg.substring(0,300)}`);
    }
  }

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
