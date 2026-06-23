import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9277;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\gtrace4-${Date.now()}`,
    TARGET + '/'
  ]);
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};
  const logs = [];
  const failedReqs = [];
  const networkReqs = [];

  function send(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, t || 30000); }); }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
        logs.push({ ts: Date.now(), level: m.params.type, msg: args });
      }
      if (m.method === 'Network.requestWillBeSent') {
        networkReqs.push({ ts: Date.now(), id: m.params.requestId, url: m.params.request.url });
      }
      if (m.method === 'Network.responseReceived') {
        const resp = m.params.response;
        if (resp.status >= 400) failedReqs.push({ ts: Date.now(), url: resp.url, status: resp.status });
      }
      if (m.method === 'Network.loadingFailed') {
        const r = networkReqs.find(x => x.id === m.params.requestId);
        failedReqs.push({ ts: Date.now(), url: r ? r.url : 'unknown', status: 'failed', errorText: m.params.errorText });
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

  for (let i = 0; i < 40; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof __UV_BOOT_STATUS__!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) break; }

  const launchTs = Date.now();
  console.log(`Launching fruit-ninja at T+0`);

  await send('Runtime.evaluate', { expression: `openGame("fruit-ninja")` });

  // Wait 25 seconds for full load
  for (let sec = 1; sec <= 25; sec++) {
    await sleep(1000);
    const r = await send('Runtime.evaluate', {
      expression: `(function(){var f=document.getElementById('gameFrame');if(!f)return 'NOFRAME';try{var d=f.contentDocument;if(!d||!d.body)return JSON.stringify({html:'NODOC',len:0});var html=d.documentElement?d.documentElement.outerHTML:'';var txt=d.body.innerText||'';return JSON.stringify({len:html.length,txt:txt.substring(0,200),blank:txt.trim().length===0})}catch(e){return JSON.stringify({len:-1,err:e.message})}})()`,
      returnByValue: true
    });
    const val = r.result?.result?.value;
    try {
      const parsed = JSON.parse(val);
      console.log(`T+${sec}: len=${parsed.len} blank=${parsed.blank} txt=${parsed.txt ? parsed.txt.substring(0,80) : ''}`);
    } catch(e) {
      console.log(`T+${sec}: ${String(val).substring(0,100)}`);
    }
  }

  // Decode first few failed URLs
  function decodeUV(slug) {
    const pathPart = slug.split('?')[0];
    let decoded = '';
    const d = decodeURIComponent(pathPart);
    for (let i = 0; i < d.length; i++) decoded += i % 2 ? String.fromCharCode(d.charCodeAt(i) ^ 2) : d[i];
    return decoded;
  }

  console.log('\n=== FAILED REQUESTS (unique) ===');
  const seen = new Set();
  const unique = [];
  for (const f of failedReqs) {
    const key = f.url + f.status;
    if (!seen.has(key)) { seen.add(key); unique.push(f); }
  }

  // Group by status
  const grouped = {};
  for (const f of unique) {
    const st = f.status;
    if (!grouped[st]) grouped[st] = [];
    grouped[st].push(f);
  }

  for (const [status, list] of Object.entries(grouped)) {
    console.log(`\n--- ${status} (${list.length}) ---`);
    for (const f of list.slice(0, 5)) {
      const elapsed = Math.round((f.ts - launchTs) / 1000);
      const url = f.url.substring(0, 120);
      const decoded = f.url.includes('/service/') ? decodeUV(f.url.replace('/service/', '')) : '';
      console.log(`  T+${elapsed}s | ${f.status}${f.errorText ? ' err=' + f.errorText : ''}`);
      console.log(`    ${url}`);
      if (decoded) console.log(`    -> ${decoded.substring(0,120)}`);
    }
    if (list.length > 5) console.log(`    ... and ${list.length - 5} more`);
  }

  console.log(`\nConsole after launch (${logs.filter(l => l.ts >= launchTs).length} total):`);
  const after = logs.filter(l => l.ts >= launchTs);
  for (const l of after.slice(0, 30)) {
    const elapsed = Math.round((l.ts - launchTs) / 1000);
    const msg = l.msg.length > 200 ? l.msg.substring(0, 200) : l.msg;
    console.log(`  T+${elapsed}s | ${l.level}: ${msg}`);
  }

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
