const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9233;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {};
    const logs = [];
    ws.on('open', () => resolve({
      ws, logs,
      send: (m, p = {}) => new Promise(r => {
        let id = ++mid;
        pend[id] = r;
        ws.send(JSON.stringify({id, method: m, params: p}));
        setTimeout(() => { if(pend[id]) { delete pend[id]; r({timedout:true}); }}, 15000);
      })
    }));
    ws.on('error', reject);
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        else if(m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
          logs.push({ text: args, ts: Date.now(), timestamp: m.params.timestamp });
        }
      } catch(e) {}
    });
  });
}

async function main() {
  console.log('=== EVIDENCE CAPTURE: Port Transport Failure ===');
  console.log('');

  // Kill any existing Chrome on our debug port
  try {
    const existing = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
    if (existing && Array.isArray(existing)) {
      for (const t of existing) {
        try { http.get(`http://127.0.0.1:${PORT}/json/close/${t.id}`); } catch(e) {}
      }
      await sleep(500);
    }
  } catch(e) {}

  // Start app server
  console.log('Starting app server on port 8080...');
  const server = spawn('node', ['server.js'], {
    cwd: 'C:\\Users\\abeni\\Downloads\\orbit',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, PORT: '8080' }
  });
  let serverLog = '';
  server.stdout.on('data', d => serverLog += d.toString());
  server.stderr.on('data', d => serverLog += d.toString());
  await sleep(3000);

  // Verify server
  for(let i=0;i<15;i++) {
    try { await fetchJSON('http://127.0.0.1:8080/'); console.log('Server ready.'); break; }
    catch(e) { await sleep(1000); }
  }

  // Start Chrome headless
  console.log('Starting Chrome headless...');
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--disable-background-networking', '--disable-default-apps',
    '--disable-sync', '--no-default-browser-check',
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let version;
  for(let i=0;i<30;i++) {
    try { version = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; }
    catch(e) { await sleep(1000); }
  }
  if (!version) { console.log('Chrome failed to start'); chrome.kill(); server.kill(); process.exit(1); }
  console.log('Chrome:', version.Browser);

  // Wait for blank page target
  let pageTarget;
  for(let i=0;i<20;i++) {
    await sleep(500);
    const targets = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
    pageTarget = targets.find(x => x.type === 'page');
    if (pageTarget) break;
  }
  if (!pageTarget) { console.log('No page target'); chrome.kill(); server.kill(); process.exit(1); }

  // Connect to page
  console.log('Connecting to page...');
  const page = await connectCDP(pageTarget.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');
  await page.send('Page.setLifecycleEventsEnabled', { enabled: true });

  // Start capturing BEFORE navigation
  console.log('Starting capture... (navigating in 2s)');
  await sleep(2000);

  // Navigate to the app
  console.log('Navigating to http://127.0.0.1:8080/');
  await page.send('Page.navigate', { url: 'http://127.0.0.1:8080/' });

  // Wait for page load + SW registration + port failure (20s should be enough)
  console.log('Waiting for page to load...');
  let pageReady = false;
  for(let i=0;i<40;i++) {
    await sleep(500);
    const r = await page.send('Runtime.evaluate', {
      expression: `JSON.stringify({readyState:document.readyState, hasUV:!!window.__UV_BOOT_STATUS__, portReady:window.__UV_BOOT_STATUS__?window.__UV_BOOT_STATUS__.portReady:null, status:window.__UV_BOOT_STATUS__?window.__UV_BOOT_STATUS__.swPortStatus:null})`,
      returnByValue: true
    });
    if (r && r.result && r.result.result && r.result.result.value) {
      const state = JSON.parse(r.result.result.value);
      if (state.readyState === 'complete' && state.hasUV) {
        pageReady = true;
        console.log('Page ready:', JSON.stringify(state));
        break;
      }
    }
  }
  if (!pageReady) console.log('Page did not fully load, continuing');

  // Wait more for port negotiation to settle
  console.log('Waiting for port negotiation to settle (8s)...');
  await sleep(8000);

  // Now connect to SW if available
  let swCDP = null;
  for(let i=0;i<30;i++) {
    const targets = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
    const swTarget = targets.find(t => t.type === 'service_worker');
    if (swTarget) {
      console.log('SW target found:', swTarget.url, 'id:', swTarget.id);
      const ws = new WebSocket(swTarget.webSocketDebuggerUrl);
      const swLogs = [];
      await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); setTimeout(() => rej('timeout'), 5000); });
      ws.on('message', d => {
        try {
          const m = JSON.parse(d.toString());
          if(m.method === 'Runtime.consoleAPICalled') {
            const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
            swLogs.push({ text: args, ts: Date.now(), timestamp: m.params.timestamp });
          }
        } catch(e) {}
      });
      ws.send(JSON.stringify({id:1,method:'Runtime.enable',params:{}}));
      await sleep(500);
      swCDP = { ws, logs: swLogs };
      console.log('SW connected.');
      break;
    }
    await sleep(500);
  }
  if (!swCDP) console.log('No SW target found - SW might not have registered');

  // Collect more logs
  await sleep(2000);

  // === DUMP ALL EVIDENCE ===

  console.log('\n');
  console.log('========================================');
  console.log('            RAW EVIDENCE');
  console.log('========================================');

  console.log('\n--- SERVER LOG ---');
  serverLog.split('\n').filter(l => l.trim()).forEach(l => console.log('  ' + l));

  console.log('\n--- PAGE CONSOLE LOGS ---');
  page.logs.forEach((l, i) => console.log(`  [PAGE #${i}] ts=${l.ts} text=${l.text.substring(0,500)}`));

  if (swCDP) {
    console.log('\n--- SW CONSOLE LOGS ---');
    swCDP.logs.forEach((l, i) => console.log(`  [SW #${i}] ts=${l.ts} text=${l.text.substring(0,500)}`));
  }

  // === TIMELINE ===
  console.log('\n');
  console.log('========================================');
  console.log('       MILLISECOND TIMELINE');
  console.log('========================================');
  const allEvents = [];
  page.logs.forEach(l => allEvents.push({ ts: l.ts, text: l.text, source: 'PAGE' }));
  if (swCDP) swCDP.logs.forEach(l => allEvents.push({ ts: l.ts, text: l.text, source: 'SW' }));
  allEvents.sort((a, b) => a.ts - b.ts);
  if (allEvents.length > 0) {
    const base = allEvents[0].ts;
    allEvents.forEach(e => console.log(`  +${String(e.ts - base).padStart(8)}ms [${e.source}] ${e.text.substring(0,500)}`));
  }

  // === KEY VALUES ===
  console.log('\n');
  console.log('========================================');
  console.log('       KEY EVIDENCE EXTRACTION');
  console.log('========================================');

  // 3. clients.length
  const matchAllLogs = allEvents.filter(e => e.text.includes('[YNINSTR] matchAll'));
  console.log('\n3. clients.length from yn():');
  matchAllLogs.forEach(l => console.log(`  ${l.source} +${l.ts - (allEvents[0]?.ts || 0)}ms: ${l.text}`));
  if (!matchAllLogs.length) console.log('  (not found)');

  // 4. getPort send events
  const getPortSendLogs = allEvents.filter(e => e.text.includes('[YNINSTR] getPort sending'));
  console.log('\n4. getPort SEND events:');
  getPortSendLogs.forEach(l => console.log(`  ${l.source} +${l.ts - (allEvents[0]?.ts || 0)}ms: ${l.text}`));
  if (!getPortSendLogs.length) console.log('  (none)');

  // 5. getPort receive events
  const getPortRecvLogs = allEvents.filter(e => e.text.includes('getPort received'));
  console.log('\n5. getPort RECEIVE events:');
  getPortRecvLogs.forEach(l => console.log(`  ${l.source} +${l.ts - (allEvents[0]?.ts || 0)}ms: ${l.text}`));
  if (!getPortRecvLogs.length) console.log('  (none)');

  // 6. SharedWorker onconnect
  const workerConnLogs = allEvents.filter(e => e.text.includes('[BOOT-WORKER] port connected'));
  console.log('\n6. SharedWorker onconnect events:');
  workerConnLogs.forEach(l => console.log(`  ${l.source} +${l.ts - (allEvents[0]?.ts || 0)}ms: ${l.text}`));
  if (!workerConnLogs.length) console.log('  (none)');

  // 7. MessagePort transfer
  const transferLogs = allEvents.filter(e => e.text.includes('port TRANSFERRED') || e.text.includes('port transferred'));
  console.log('\n7. MessagePort transfer events:');
  transferLogs.forEach(l => console.log(`  ${l.source} +${l.ts - (allEvents[0]?.ts || 0)}ms: ${l.text}`));
  if (!transferLogs.length) console.log('  (none)');

  // 8. portState transitions
  const stateLogs = allEvents.filter(e => e.text.includes('[STATE]'));
  console.log('\n8. portState transitions:');
  stateLogs.forEach(l => console.log(`  ${l.source} +${l.ts - (allEvents[0]?.ts || 0)}ms: ${l.text}`));
  if (!stateLogs.length) console.log('  (none)');

  // 9. First event causing failed
  const firstFailed = stateLogs.find(e => e.text.includes('failed'));
  console.log('\n9. First event causing portState.status → "failed":');
  if (firstFailed) console.log(`  ${firstFailed.source} +${firstFailed.ts - (allEvents[0]?.ts || 0)}ms: ${firstFailed.text}`);
  else console.log('  (not found - port may have succeeded)');

  // Final boot status
  const finalCheck = await page.send('Runtime.evaluate', {
    expression: `JSON.stringify({portReady: window.__UV_BOOT_STATUS__?.portReady, bareMuxReady: window.__UV_BOOT_STATUS__?.bareMuxReady, swPortStatus: window.__UV_BOOT_STATUS__?.swPortStatus, logLen: window.__UV_BOOT_STATUS__?._log?.length || 0})`,
    returnByValue: true
  });
  console.log('\nFinal boot status:', finalCheck?.result?.result?.value || 'N/A');

  // Cleanup
  if (swCDP) { try { swCDP.ws.close(); } catch(e) {} }
  chrome.kill();
  server.kill();
  console.log('\nDone.');
  setTimeout(() => process.exit(0), 1000);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
