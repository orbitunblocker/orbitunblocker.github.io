import { spawn } from 'child_process';
import http from 'http';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9244;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function reqJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}

async function main() {
  try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(3000); } catch(e) {}
  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\sec-'+Date.now(), 'http://localhost:8080/']);
  let v; for(let i=0;i<30;i++) { try { v = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }
  let pt; for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); pt = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pend = {};
  function send(m, p) { return new Promise(r => { const id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p||{}})); setTimeout(() => { if(pend[id]) { delete pend[id]; r({}) }}, 15000); }); }
  ws.on('message', d => { try { const m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch(e){} });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  for(let i=0;i<30;i++) { await sleep(500); const r = await send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }

  // Check all available global functions
  const r = await send('Runtime.evaluate', {
    expression: '(function(){ var ks = []; for(var k in window) { if(k.includes("load") || k.includes("nav") || k.includes("section") || k.includes("open") || k.includes("game")) ks.push(k); } return JSON.stringify(ks.slice(0,30)); })()',
    returnByValue: true
  });
  console.log('FUNCTIONS:', r.result?.result?.value);

  // Try clicking the nav div directly
  const r2 = await send('Runtime.evaluate', {
    expression: '(function(){ var divs = document.querySelectorAll("div"); var hits = []; divs.forEach(function(d){ if(d.textContent.includes("Apps") || d.textContent.includes("Games") || d.textContent.includes("Tools")) hits.push({tag:d.tagName, text:d.textContent.trim().slice(0,40), cls:d.className.slice(0,80)}); }); return JSON.stringify(hits); })()',
    returnByValue: true
  });
  console.log('NAV DIVS:', r2.result?.result?.value);

  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
