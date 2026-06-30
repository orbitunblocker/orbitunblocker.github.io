import { spawn } from 'child_process';
import http from 'http';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const CDP_PORT = 9241;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function reqJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}

async function main() {
  try { await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(3000); } catch(e) {}
  const chrome = spawn(CHROME, ['--remote-debugging-port='+CDP_PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', '--disable-popup-blocking', '--allow-insecure-localhost', '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\sel-'+Date.now(), 'http://localhost:8080/']);
  let v; for(let i=0;i<30;i++) { try { v = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json/version'); break; } catch(e) { await sleep(1000); } }
  let pt; for(let i=0;i<30;i++) { await sleep(1000); const t = await reqJSON('http://127.0.0.1:'+CDP_PORT+'/json'); pt = t.find(x => x.type === 'page' && x.url.includes('localhost')); if(pt) break; }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pend = {};
  function send(m, p) { return new Promise(r => { const id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p||{}})); setTimeout(() => { if(pend[id]) { delete pend[id]; r({}) }}, 15000); }); }
  ws.on('message', d => { try { const m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch(e){} });
  await new Promise(r => ws.on('open', r));
  await send('Page.enable'); await send('Runtime.enable');
  for(let i=0;i<30;i++) { await sleep(500); const r = await send('Runtime.evaluate', {expression:'document.readyState==="complete"', returnByValue:true}); if(r.result?.result?.value) break; }

  // Check section IDs and game card classes
  const r = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(Array.from(document.querySelectorAll("section")).map(function(s){ return {id:s.id, cls:s.className.slice(0,80)}; }))',
    returnByValue: true
  });
  console.log('SECTIONS:', r.result?.result?.value);

  // Check the section with Games content
  const r2 = await send('Runtime.evaluate', {
    expression: '(function(){ var gs = document.getElementById("games-section"); if(!gs) return "no-games-section"; var cards = gs.querySelectorAll("[class*=card]"); return JSON.stringify(Array.from(cards).slice(0,3).map(function(c){ return {tag:c.tagName, cls:c.className.slice(0,80), id:c.id || "no-id", text:c.textContent.replace(/\\s+/g," ").trim().slice(0,80)}; })); })()',
    returnByValue: true
  });
  console.log('GAME CARDS:', r2.result?.result?.value);

  // Check section's data attributes
  const r3 = await send('Runtime.evaluate', {
    expression: '(function(){ var gs = document.getElementById("games-section"); if(!gs) return "none"; var items = gs.querySelectorAll("[data-id]"); return JSON.stringify(Array.from(items).slice(0,5).map(function(it){ return {tag:it.tagName, dataId:it.getAttribute("data-id"), text:it.textContent.replace(/\\s+/g," ").trim().slice(0,60)}; })); })()',
    returnByValue: true
  });
  console.log('DATA-IDS:', r3.result?.result?.value);

  chrome.kill();
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
