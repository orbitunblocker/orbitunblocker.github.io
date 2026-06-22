// Test the full port chain: SharedWorker -> transfer to SW -> SW pings worker
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
    ws.on('open', () => resolve({ws, logs, send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r(null); }}, 15000); })}));
    ws.on('error', reject);
    ws.on('message', d => { try { const m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } if(m.method === 'Runtime.consoleAPICalled') logs.push((m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ')); } catch(e) {} });
  });
}

async function main() {
  const PORT = 9228;
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
  
  // Wait for SW activation
  for(let i=0;i<30;i++) { const r=await cdp.send('Runtime.evaluate',{expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"',returnByValue:true}); if(evalValue(r)) break; await sleep(500); }
  
  // Step 1: Check current port state
  console.log('\n--- Step 1: Current port state ---');
  const bs = evalValue(await cdp.send('Runtime.evaluate',{expression:'JSON.stringify(window.__UV_BOOT_STATUS__)',returnByValue:true}));
  console.log('Boot status:', bs);
  
  // Step 2: Manually create a SharedWorker and send it to SW via getPort protocol
  console.log('\n--- Step 2: Manual port transfer test ---');
  
  // First, get the SW's registered scope
  const swScope = evalValue(await cdp.send('Runtime.evaluate',{expression:`
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        return reg.scope + ' | active: ' + (reg.active ? 'yes' : 'no');
      } catch(e) { return 'ERR: ' + e.message; }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log('SW reg:', swScope);
  
  // Step 3: Create a SharedWorker and manually test the transfer -> ping -> pong cycle
  console.log('\n--- Step 3: Simulate the exact UV/yn() flow ---');
  const result = evalValue(await cdp.send('Runtime.evaluate',{expression:`
    (async () => {
      // Create SharedWorker
      const worker = new SharedWorker('/uv/bare-mux-worker.js', 'bare-mux-test');
      await new Promise(r => setTimeout(r, 200));
      
      // Create MessageChannel to simulate getPort
      const channel = new MessageChannel();
      const pagePort = channel.port2;  // This is like event.data.port in the getPort handler
      
      // Simulate the page's getPort handler: transfer worker.port through the channel
      pagePort.postMessage(worker.port, [worker.port]);
      
      // Now channel.port1 in the page has the worker.port as the received message
      // (In SW, this would be a.port1.onmessage receiving worker.port)
      
      // But we're in the page, not SW. Let's simulate what the SW does:
      // The SW receives worker.port via a.port1.onmessage
      // Then calls bs(worker.port) which does ping/pong
      
      // Let's manually do what bs() does:
      const pingChannel = new MessageChannel();
      try {
        const pong = await Promise.race([
          new Promise(resolve => {
            pingChannel.port1.onmessage = e => {
              pingChannel.port1.close();
              resolve(e.data?.type === 'pong' ? 'PONG OK' : 'unexpected: ' + JSON.stringify(e.data));
            };
            // worker.port.postMessage (after transfer, it's neutered on this side)
            // But we can use the channel.port1 which received the transferred port
            // The received data IS the port, stored in... hmm, we need to receive it
            
            // Actually the problem is we can't receive the transferred port from channel.port1
            // because we're on the page, not the SW. The transferred port goes to the SW.
            // Let me try a different approach - use worker.port BEFORE transfer
            
            // Try pinging directly through worker.port
            worker.port.postMessage({message:{type:'ping'}, port:pingChannel.port2}, [pingChannel.port2]);
          }),
          new Promise((_,rej) => setTimeout(() => rej(new Error('timeout')), 2000))
        ]);
        return 'Direct ping (no transfer): ' + pong;
      } catch(e) {
        return 'Direct ping failed: ' + e.message;
      }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log('Manual test:', result);
  
  // Step 4: Check SW state by looking at UV's internal state
  console.log('\n--- Step 4: SW internal state ---');
  const swState = evalValue(await cdp.send('Runtime.evaluate',{expression:`
    (async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        if (!reg.active) return 'no active sw';
        // Send a custom message asking for state
        const ch = new MessageChannel();
        const resp = await Promise.race([
          new Promise(r => { ch.port1.onmessage = e => { ch.port1.close(); r(JSON.stringify(e.data)); }; reg.active.postMessage({type:'SYNC_PORT_STATE',checkHealth:true}, [ch.port2]); }),
          new Promise((_,rj) => setTimeout(() => rj('TIMEOUT'), 5000))
        ]);
        return 'SW response: ' + resp;
      } catch(e) {
        return 'ERR: ' + e.message;
      }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log(swState);
  
  // Step 5: Check the HTML console logs for any errors
  console.log('\n--- Step 5: Errors & warnings ---');
  for(const l of cdp.logs) {
    if(l.includes('ERROR')||l.includes('Error')||l.includes('error')||l.includes('FAIL')||l.includes('fail')||l.includes('[TRACE]')||l.includes('[BOOT-SW]')) 
      console.log('  ' + l);
  }
  
  chrome.kill();
  setTimeout(()=>process.exit(0),500);
}
main().catch(e=>{console.error('FATAL:',e);process.exit(1)});
