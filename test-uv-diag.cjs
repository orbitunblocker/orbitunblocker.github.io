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
    let mid = 0, pend = {}, logs = [];
    ws.on('open', () => resolve({ws, logs, send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r(null); }}, 10000); })}));
    ws.on('error', reject);
    ws.on('close', () => { for(const k of Object.keys(pend)) pend[k](null); });
    ws.on('message', d => { try { const m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } if(m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ')); } catch(e) {} });
  });
}

async function main() {
  const PORT = 9230;
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
  await sleep(2000);
  
  // Send GET_DIAG to SW
  console.log('\n--- Sending GET_DIAG to SW ---');
  const diagResult = evalValue(await cdp.send('Runtime.evaluate', {expression:`
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (!reg.active) return 'no active sw';
        const ch = new MessageChannel();
        const resp = await Promise.race([
          new Promise(r => { ch.port1.onmessage = e => { ch.port1.close(); r(JSON.stringify(e.data)); }; reg.active.postMessage({type:'GET_DIAG'}, [ch.port2]); }),
          new Promise((_,rj) => setTimeout(() => rj('TIMEOUT'), 5000))
        ]);
        return 'DIAG: ' + resp;
      } catch(e) {
        return 'ERR: ' + (e.message || e);
      }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log(diagResult);
  
  // Also get SW debug target and capture logs
  await sleep(2000);
  const targets = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
  const swTarget = targets.find(t => t.type === 'service_worker');
  if (swTarget) {
    console.log('\n--- Connecting to SW CDP target ---');
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
    swWS.on('open', async () => {
      await new Promise(r => setTimeout(r, 200));
      // Enable console capture
      swWS.send(JSON.stringify({id:1,method:'Runtime.enable',params:{}}));
      swWS.send(JSON.stringify({id:2,method:'Console.enable',params:{}}));
      // Wait for logs
      await sleep(3000);
      console.log('SW logs (' + swLogs.length + '):');
      for(const l of swLogs.slice(-20)) console.log('  ' + l);
      swWS.close();
      
      // Final check
      console.log('\n--- Final state ---');
      for(let i=0;i<3;i++) {
        const pr = evalValue(await cdp.send('Runtime.evaluate',{expression:'window.__UV_BOOT_STATUS__.portReady',returnByValue:true}));
        const fs = evalValue(await cdp.send('Runtime.evaluate',{expression:'window.__UV_BOOT_STATUS__.failedStage',returnByValue:true}));
        console.log('portReady=' + pr + ' failedStage=' + fs);
        await sleep(1000);
      }
    });
    await sleep(10000);
  } else {
    console.log('No SW CDP target');
    chrome.kill();
    process.exit(0);
  }
  
  chrome.kill();
  setTimeout(()=>process.exit(0),500);
}
main().catch(e=>{console.error('FATAL:',e);process.exit(1);});
