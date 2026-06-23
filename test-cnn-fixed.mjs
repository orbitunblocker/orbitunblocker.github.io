import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9278;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cnn-test-${Date.now()}`,
    TARGET + '/'
  ]);
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};
  const logs = [];
  const networkReqs = [];
  const failedReqs = [];

  function send(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, t || 30000); }); }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
        logs.push({ ts: Date.now(), level: m.params.type, msg: args });
      }
      if (m.method === 'Network.responseReceived') {
        const resp = m.params.response;
        if (resp.status >= 400) failedReqs.push({ ts: Date.now(), url: resp.url, status: resp.status });
      }
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    } catch (e) {}
  });

  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  await send('Runtime.runIfWaitingForDebugger');

  // Wait for proxy boot
  for (let i = 0; i < 40; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof VoltraBrowser!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) break; }
  console.log('Proxy booted, navigating to cnn.com');

  const launchTs = Date.now();
  await send('Runtime.evaluate', { expression: 'navigateToUrl("https://cnn.com")' });

  for (let sec = 1; sec <= 15; sec++) {
    await sleep(1000);
    // Read the browser iframe content
    const r = await send('Runtime.evaluate', {
      expression: `(function(){var f=document.getElementById('browserFrame-main');if(!f)return JSON.stringify({src:'NOFRAME'});try{var d=f.contentDocument;if(!d||!d.body)return JSON.stringify({src:f.src.substring(0,120),html:'NODOC',len:0});var html=d.documentElement?d.documentElement.outerHTML:'';var txt=d.body.innerText||'';var blank=txt.trim().length===0;var hasError=html.includes('Proxy')||html.includes('Error')||html.includes('error-card')||html.includes('Timeout')||html.includes('Retry');return JSON.stringify({src:f.src.substring(0,120),len:html.length,bl:blank,er:hasError,txt:txt.substring(0,150)})}catch(e){return JSON.stringify({src:f.src.substring(0,120),html:'CROSS:'+e.message,len:-1})}})()`,
      returnByValue: true
    });
    const val = r.result?.result?.value;
    try {
      const p = JSON.parse(val);
      const status = p.er ? ' [ERROR PAGE!]' : (p.bl ? ' [BLANK]' : ' [CONTENT]');
      console.log(`T+${sec}: len=${p.len}${status} txt=${(p.txt||'').substring(0,80)}`);
    } catch(e) {
      console.log(`T+${sec}: ${String(val).substring(0,100)}`);
    }
  }

  // Failed requests
  console.log('\n=== FAILED REQUESTS ===');
  for (const f of failedReqs) {
    const elapsed = Math.round((f.ts - launchTs) / 1000);
    console.log(`T+${elapsed}s | ${f.status} | ${f.url.substring(0,130)}`);
  }

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
