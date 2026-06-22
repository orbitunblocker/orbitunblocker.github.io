// Quick test to check if SharedWorker works in headless mode
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
      ws, pend,
      send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r(null); }}, 15000); })
    }));
    ws.on('error', reject);
    ws.on('message', d => { try { const m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch(e) {} });
  });
}

async function runTest(headlessFlag) {
  const PORT = headlessFlag === '--headless=new' ? 9226 : 9227;
  try { await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); await fetchJSON(`http://127.0.0.1:${PORT}/json/close`); await sleep(1000); } catch(e) {}
  
  console.log(`\n=== Testing ${headlessFlag} ===`);
  const chrome = spawn(CHROME, [headlessFlag, `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', 'http://localhost:8080/'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  
  let v; for(let i=0;i<30;i++) { try { v = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch(e) { await sleep(1000); } }
  if (!v) { console.log('Chrome not started'); chrome.kill(); return; }
  
  let pt; for(let i=0;i<20;i++) { await sleep(500); try { const t = await fetchJSON(`http://127.0.0.1:${PORT}/json`); pt = t.find(x => x.type === 'page'); if (pt) break; } catch(e) {} }
  if (!pt) { console.log('No page target'); chrome.kill(); return; }
  
  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  
  // Wait for page to load
  for(let i=0;i<20;i++) { const r = await cdp.send('Runtime.evaluate', {expression:'document.readyState',returnByValue:true}); if(evalValue(r)==='complete') break; await sleep(500); }
  
  // Create a SharedWorker from the page
  const swResult = evalValue(await cdp.send('Runtime.evaluate', {expression:`
    (async () => {
      try {
        const worker = new SharedWorker('/uv/bare-mux-worker.js', 'test-worker');
        // Wait for the worker to be ready
        await new Promise(r => setTimeout(r, 100));
        // Try sending a ping
        const channel = new MessageChannel();
        const pong = await Promise.race([
          new Promise(resolve => {
            channel.port1.onmessage = e => { channel.port1.close(); resolve(e.data?.type === 'pong' ? 'pong received' : 'unexpected: ' + JSON.stringify(e.data)); };
            worker.port.postMessage({message:{type:'ping'}, port:channel.port2}, [channel.port2]);
          }),
          new Promise((_,rej) => setTimeout(() => rej(new Error('ping timeout after 2s')), 2000))
        ]);
        worker.port.close();
        return 'SUCCESS: ' + pong;
      } catch(e) {
        return 'FAIL: ' + e.message;
      }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log('SharedWorker test:', swResult);
  
  chrome.kill();
  await sleep(500);
}

async function main() {
  await runTest('--headless');
  await runTest('--headless=new');
}
main().catch(e => { console.error(e); process.exit(1); });
