// Poll portReady over time to see if trackPort eventually resolves
const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}
function evalValue(r) { if(!r||!r.result||!r.result.result)return undefined; return r.result.result.value; }

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {};
    ws.on('open', () => resolve({
      ws, send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r(null); }}, 10000); })
    }));
    ws.on('error', reject);
    ws.on('close', () => { for(const k of Object.keys(pend)) pend[k](null); });
    ws.on('message', d => { try { const m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch(e) {} });
  });
}

async function main() {
  const PORT = 9229;
  try { await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); await fetchJSON(`http://127.0.0.1:${PORT}/json/close`); await sleep(1000); } catch(e) {}
  
  console.log('Starting Chrome...');
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', 'http://localhost:8080/'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  
  let v; for(let i=0;i<30;i++) { try { v = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch(e) { await sleep(1000); } }
  if (!v) { console.log('Chrome fail'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', v.Browser);
  
  let pt; for(let i=0;i<20;i++) { await sleep(500); try { const t = await fetchJSON(`http://127.0.0.1:${PORT}/json`); pt = t.find(x => x.type === 'page'); if (pt) break; } catch(e) {} }
  if (!pt) { console.log('No page target'); chrome.kill(); process.exit(1); }
  
  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  
  // Wait for boot status
  for(let i=0;i<20;i++) { const r=await cdp.send('Runtime.evaluate',{expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"',returnByValue:true}); if(evalValue(r)) break; await sleep(500); }
  
  // Poll for portReady over 30 seconds
  for(let i=0;i<30;i++) {
    await sleep(1000);
    const pr = evalValue(await cdp.send('Runtime.evaluate',{expression:'window.__UV_BOOT_STATUS__.portReady',returnByValue:true}));
    const fs = evalValue(await cdp.send('Runtime.evaluate',{expression:'window.__UV_BOOT_STATUS__.failedStage',returnByValue:true}));
    const log = evalValue(await cdp.send('Runtime.evaluate',{expression:'(window.__UV_BOOT_STATUS__._log||[]).slice(-5).map(x=>x.key).join(",")',returnByValue:true}));
    console.log('t='+(i+1)+'s portReady='+pr+' failedStage='+fs+' recent='+log);
    if (pr === true) {
      console.log('PORT READY after', i+1, 'seconds!');
      break;
    }
  }
  
  // Also check SW target for console logs
  const targets = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
  const swTarget = targets.find(t => t.type === 'service_worker');
  if (swTarget) {
    console.log('\nSW target found:', swTarget.url);
    const swWS = new WebSocket(swTarget.webSocketDebuggerUrl);
    let swLogs = [];
    swWS.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
          swLogs.push(args);
        }
      } catch(e) {}
    });
    await new Promise(r => swWS.on('open', r));
    await swWS.send(JSON.stringify({id:1,method:'Runtime.enable',params:{}}));
    await sleep(5000);
    console.log('\n=== SW Console logs (last 20) ===');
    for(const l of swLogs.slice(-20)) console.log('  '+l);
    swWS.close();
  } else {
    console.log('No SW target found');
  }
  
  chrome.kill();
  setTimeout(()=>process.exit(0),500);
}
main().catch(e=>{console.error('FATAL:',e);process.exit(1)});
