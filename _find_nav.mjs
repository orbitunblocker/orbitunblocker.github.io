import { spawn } from 'child_process';
import http from 'http';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9242;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function reqJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}

async function main() {
  try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(3000); } catch(e) {}
  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\nav-'+Date.now(), 'http://localhost:8080/']);
  let v; for(let i=0;i<30;i++) { try { v = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }
  let pt; for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); pt = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pend = {};
  function send(m, p) { return new Promise(r => { const id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p||{}})); setTimeout(() => { if(pend[id]) { delete pend[id]; r({}) }}, 15000); }); }
  ws.on('message', d => { try { const m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch(e){} });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  for(let i=0;i<30;i++) { await sleep(500); const r = await send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }

  // Find nav buttons
  const r = await send('Runtime.evaluate', {
    expression: '(function(){ var nav = document.querySelector("nav"); if(nav) { return JSON.stringify(Array.from(nav.querySelectorAll("a, button")).map(function(el){ return {tag:el.tagName, text:el.textContent.trim().slice(0,60), href:el.getAttribute("href")||"", onclick:el.getAttribute("onclick")||"", cls:el.className.slice(0,80)}; })); } else { var btns = document.querySelectorAll("[class*=\"nav\"], [class*=\"tab\"], [class*=\"menu\"]"); return JSON.stringify(Array.from(btns).slice(0,10).map(function(el){ return {tag:el.tagName, text:el.textContent.trim().slice(0,60), cls:el.className.slice(0,80)}; })); } })()',
    returnByValue: true
  });
  console.log('NAV ELEMENTS:', r.result?.result?.value);

  // Also find any element with setActiveNav or similar
  const r2 = await send('Runtime.evaluate', {
    expression: '(function(){ var all = document.querySelectorAll("[onclick]"); var hits = []; all.forEach(function(el){ var oc = el.getAttribute("onclick"); if(oc && (oc.includes("section") || oc.includes("nav") || oc.includes("game") || oc.includes("open"))) { hits.push({tag:el.tagName, text:el.textContent.trim().slice(0,50), onclick:oc.slice(0,100)}); } }); return JSON.stringify(hits); })()',
    returnByValue: true
  });
  console.log('CLICK HANDLERS:', r2.result?.result?.value);

  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
