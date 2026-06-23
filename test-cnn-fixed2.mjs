import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9279;
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
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\cnn2-${Date.now()}`,
    TARGET + '/'
  ]);
  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  let pt;
  for (let i = 0; i < 30; i++) { await sleep(1000); const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy')); if (pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};
  const consoleMsgs = [];
  const navigations = [];
  const failures = [];

  function send(m, p, t) { return new Promise(r => { const id = ++mid; pending[id] = r; ws.send(JSON.stringify({ id, method: m, params: p })); setTimeout(() => { if (pending[id]) { delete pending[id]; r({}) } }, t || 30000); }); }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
        consoleMsgs.push({ ts: Date.now(), msg: args });
      }
      if (m.method === 'Page.frameNavigated') {
        navigations.push({ ts: Date.now(), url: m.params.frame.url, id: m.params.frame.id, parentId: m.params.frame.parentId });
      }
      if (m.method === 'Network.loadingFailed') {
        failures.push({ ts: Date.now(), url: m.params.url || 'unknown', error: m.params.errorText, reqId: m.params.requestId });
      }
      if (m.method === 'Network.responseReceived') {
        const resp = m.params.response;
        if (resp.status >= 400) {
          failures.push({ ts: Date.now(), url: resp.url, status: resp.status });
        }
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

  // Wait for VoltraBrowser to be defined
  for (let i = 0; i < 40; i++) { await sleep(1000); const r = await send('Runtime.evaluate', { expression: 'typeof VoltraBrowser!==\'undefined\'', returnByValue: true }); if (r.result?.result?.value) break; }
  console.log('Proxy booted');

  // Navigate directly using the page
  const navResult = await send('Page.navigate', { url: TARGET + '/service/' + encodeURIComponent('https://www.cnn.com') });
  console.log('Navigate result:', JSON.stringify(navResult));

  const launchTs = Date.now();

  // Wait and track
  for (let sec = 1; sec <= 15; sec++) {
    await sleep(1000);
    // Get current page URL
    const r = await send('Runtime.evaluate', {
      expression: `document.location.href`,
      returnByValue: true
    });
    const url = r.result?.result?.value || '?';
    console.log(`T+${sec}: url=${url.substring(0,120)}`);
  }

  // Print console messages about error pages
  console.log('\n=== CONSOLE (relevant) ===');
  for (const c of consoleMsgs) {
    const elapsed = Math.round((c.ts - launchTs) / 1000);
    if (c.msg.includes('Error') || c.msg.includes('error') || c.msg.includes('Timeout') || c.msg.includes('_showErrorPage') || c.msg.includes('DEFER') || c.msg.includes('FLUSH') || c.msg.includes('SW-FETCH')) {
      console.log(`T+${elapsed}s | ${c.msg.substring(0,250)}`);
    }
  }

  console.log('\n=== FAILURES ===');
  for (const f of failures) {
    const elapsed = Math.round((f.ts - launchTs) / 1000);
    console.log(`T+${elapsed}s | ${f.status || f.error} | ${(f.url||'?').substring(0,120)}`);
  }

  // Check current page HTML for error/blank detection
  const r = await send('Runtime.evaluate', {
    expression: `(function(){var html=document.documentElement?document.documentElement.outerHTML:'';var txt=document.body?document.body.innerText||'':'':'';var hasError=html.includes('error-card')||html.includes('Proxy Not Ready')||html.includes('Proxy Error')||html.includes('Proxy Timeout')||html.includes('Timeout');return JSON.stringify({len:html.length,blank:txt.trim().length===0,hasError:hasError,txt:txt.substring(0,200)})})()`,
    returnByValue: true
  });
  console.log('\n=== FINAL PAGE STATE ===');
  const val = r.result?.result?.value;
  try {
    const p = JSON.parse(val);
    console.log(`len=${p.len} blank=${p.blank} error=${p.hasError}`);
    console.log(`text: ${p.txt.substring(0,200)}`);
    if (p.hasError) console.log('*** ERROR PAGE DETECTED! 503 replaced with HTML error! ***');
    else if (p.blank) console.log('*** PAGE IS BLANK (original cnn.com behavior) ***');
    else console.log('*** CNN LOADED SUCCESSFULLY ***');
  } catch(e) {
    console.log(val);
  }

  ws.close();
  setTimeout(() => { chrome.kill(); process.exit(0); }, 500);
}
main().catch(e => { console.error(e); process.exit(1); });
