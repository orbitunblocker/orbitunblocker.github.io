const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9234;

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
      send: (m, p = {}) => new Promise(r => { let id = ++mid; pend[id] = r; ws.send(JSON.stringify({id, method: m, params: p})); setTimeout(() => { if(pend[id]) { delete pend[id]; r({timedout:true}); }}, 15000); })
    }));
    ws.on('error', reject);
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        else if(m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ');
          logs.push({ text: args, ts: Date.now() });
        }
      } catch(e) {}
    });
  });
}

async function main() {
  console.log('=== RELOAD TEST ===');

  // Kill old
  try {
    const existing = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
    if (existing && Array.isArray(existing)) { for (const t of existing) { try { http.get(`http://127.0.0.1:${PORT}/json/close/${t.id}`); } catch(e) {} } }
    await sleep(500);
  } catch(e) {}

  // Start server
  const server = spawn('node', ['server.js'], { cwd: 'C:\\Users\\abeni\\Downloads\\orbit', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, env: { ...process.env, PORT: '8080' } });
  let serverLog = '';
  server.stdout.on('data', d => serverLog += d.toString());
  server.stderr.on('data', d => serverLog += d.toString());
  await sleep(3000);
  for(let i=0;i<15;i++) { try { await fetchJSON('http://127.0.0.1:8080/'); break; } catch(e) { await sleep(1000); } }

  // Start Chrome
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let version; for(let i=0;i<30;i++) { try { version = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch(e) { await sleep(1000); } }
  if (!version) { chrome.kill(); server.kill(); process.exit(1); }
  let pageTarget; for(let i=0;i<20;i++) { await sleep(500); const t = await fetchJSON(`http://127.0.0.1:${PORT}/json`); pageTarget = t.find(x => x.type === 'page'); if (pageTarget) break; }
  if (!pageTarget) { chrome.kill(); server.kill(); process.exit(1); }

  const page = await connectCDP(pageTarget.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');

  // Navigate to app
  await page.send('Page.navigate', { url: 'http://127.0.0.1:8080/' });

  // Wait for first load + port ready
  console.log('Waiting for first load...');
  let firstReady = false;
  for(let i=0;i<30;i++) {
    await sleep(500);
    const r = await page.send('Runtime.evaluate', { expression: `window.__UV_BOOT_STATUS__?.portReady === true`, returnByValue: true });
    if (r?.result?.result?.value) { firstReady = true; console.log('Port ready after first load at ~' + (i*500) + 'ms'); break; }
  }
  if (!firstReady) console.log('Warning: port never got ready on first load');

  // Wait a bit, then capture SW logs from first load
  await sleep(2000);
  let swCDP1 = null;
  for(let i=0;i<20;i++) {
    const targets = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
    const swt = targets.find(t => t.type === 'service_worker');
    if (swt) {
      const ws = new WebSocket(swt.webSocketDebuggerUrl);
      const swLogs = [];
      await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); setTimeout(() => rej('timeout'), 5000); });
      ws.on('message', d => {
        try { const m = JSON.parse(d.toString()); if(m.method === 'Runtime.consoleAPICalled') { const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' '); swLogs.push({ text: args, ts: Date.now() }); } } catch(e) {}
      });
      ws.send(JSON.stringify({id:1,method:'Runtime.enable',params:{}}));
      await sleep(500);
      swCDP1 = { ws, logs: swLogs };
      break;
    }
    await sleep(500);
  }

  // Collect first-load SW logs
  const sw1Logs = swCDP1 ? [...swCDP1.logs] : [];
  const page1Logs = [...page.logs];

  // Clear for reload phase
  page.logs.length = 0;
  if (swCDP1) swCDP1.logs.length = 0;

  // === RELOAD ===
  console.log('\nReloading...');
  await page.send('Runtime.evaluate', { expression: `location.href = location.href` });

  // Wait for reload + port state
  console.log('Waiting for reload...');
  let reloadReady = false;
  let reloadStatus = null;
  for(let i=0;i<40;i++) {
    await sleep(500);
    const r = await page.send('Runtime.evaluate', {
      expression: `JSON.stringify({readyState: document.readyState, portReady: window.__UV_BOOT_STATUS__?.portReady, status: window.__UV_BOOT_STATUS__?.swPortStatus})`,
      returnByValue: true
    });
    if (r?.result?.result?.value) {
      reloadStatus = JSON.parse(r.result.result.value);
      if (reloadStatus.readyState === 'complete' && reloadStatus.status) {
        reloadReady = true;
        console.log('Reload state:', JSON.stringify(reloadStatus));
        break;
      }
    }
  }

  // Wait extra for recovery attempts
  await sleep(12000);

  // Capture reload-phase SW logs
  let swLogs2 = [];
  if (swCDP1) {
    swLogs2 = [...swCDP1.logs];
  } else {
    // Try to connect again
    for(let i=0;i<20;i++) {
      const targets = await fetchJSON(`http://127.0.0.1:${PORT}/json`);
      const swt = targets.find(t => t.type === 'service_worker');
      if (swt) {
        const ws = new WebSocket(swt.webSocketDebuggerUrl);
        await new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); setTimeout(() => rej('timeout'), 5000); });
        ws.on('message', d => {
          try { const m = JSON.parse(d.toString()); if(m.method === 'Runtime.consoleAPICalled') { const args = (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' '); swLogs2.push({ text: args, ts: Date.now() }); } } catch(e) {}
        });
        ws.send(JSON.stringify({id:1,method:'Runtime.enable',params:{}}));
        await sleep(500);
        break;
      }
      await sleep(500);
    }
  }

  const page2Logs = [...page.logs];

  // === OUTPUT ===
  console.log('\n========================================');
  console.log('RAW EVIDENCE');
  console.log('========================================');

  console.log('\n--- FIRST LOAD PAGE LOGS ---');
  page1Logs.forEach(l => console.log(`  ts=${l.ts} ${l.text.substring(0,400)}`));

  console.log('\n--- FIRST LOAD SW LOGS ---');
  sw1Logs.forEach(l => console.log(`  ts=${l.ts} ${l.text.substring(0,400)}`));

  console.log('\n--- RELOAD PAGE LOGS ---');
  page2Logs.forEach(l => console.log(`  ts=${l.ts} ${l.text.substring(0,400)}`));

  console.log('\n--- RELOAD SW LOGS ---');
  swLogs2.forEach(l => console.log(`  ts=${l.ts} ${l.text.substring(0,400)}`));

  // Summary
  const allSWFirst = sw1Logs;
  const allSWReload = swLogs2;
  const allPageFirst = page1Logs;
  const allPageReload = page2Logs;

  console.log('\n========================================');
  console.log('KEY VALUES');
  console.log('========================================');

  console.log('\n3. clients.length (first load):');
  const m1 = allSWFirst.filter(l => l.text.includes('[YNINSTR] matchAll'));
  m1.forEach(l => console.log(' ', l.text.substring(0, 200)));
  if (!m1.length) console.log('  (not found)');

  console.log('\n   clients.length (reload):');
  const m2 = allSWReload.filter(l => l.text.includes('[YNINSTR] matchAll'));
  m2.forEach(l => console.log(' ', l.text.substring(0, 200)));
  if (!m2.length) console.log('  (not found - SW may have survived)');

  console.log('\n4. getPort SEND events (reload):');
  const gs = allSWReload.filter(l => l.text.includes('[YNINSTR] getPort sending'));
  gs.forEach(l => console.log(' ', l.text.substring(0, 250)));
  if (!gs.length) console.log('  (none - yn() may not have been called again)');

  console.log('\n5. getPort RECEIVE events (reload):');
  const gr = allPageReload.filter(l => l.text.includes('getPort received'));
  gr.forEach(l => console.log(' ', l.text.substring(0, 250)));
  if (!gr.length) console.log('  (none - getPort may not have been sent)');

  console.log('\n6. SharedWorker onconnect (reload):');
  const wc = allSWReload.filter(l => l.text.includes('[BOOT-WORKER] port connected'));
  wc.forEach(l => console.log(' ', l.text.substring(0, 250)));
  if (!wc.length) console.log('  (none)');

  console.log('\n7. port TRANSFERRED (reload):');
  const pt = allPageReload.filter(l => l.text.includes('TRANSFERRED'));
  pt.forEach(l => console.log(' ', l.text.substring(0, 250)));
  if (!pt.length) console.log('  (none)');

  console.log('\n8. portState transitions (reload):');
  const st = allSWReload.filter(l => l.text.includes('[STATE]') || l.text.includes('[PORT_STATE_CHANGE]'));
  st.forEach(l => console.log(' ', l.text.substring(0, 400)));
  if (!st.length) console.log('  (none)');

  console.log('\n8b. portState transitions (first load):');
  const st1 = allSWFirst.filter(l => l.text.includes('[STATE]') || l.text.includes('[PORT_STATE_CHANGE]'));
  st1.forEach(l => console.log(' ', l.text.substring(0, 400)));

  console.log('\n9. First event → failed (reload):');
  const ff = allSWReload.filter(l => l.text.includes('failed'));
  ff.forEach(l => console.log(' ', l.text.substring(0, 400)));
  if (!ff.length) console.log('  (none - port did not fail)');

  console.log('\n9b. First event → failed (first load):');
  const ff1 = allSWFirst.filter(l => l.text.includes('failed'));
  ff1.forEach(l => console.log(' ', l.text.substring(0, 400)));
  if (!ff1.length) console.log('  (none - port did not fail)');

  console.log('\n10. trackPort rejection (reload):');
  const tr = allSWReload.filter(l => l.text.includes('[TRACKPORT] PROMISE REJECTED'));
  tr.forEach(l => console.log(' ', l.text.substring(0, 500)));
  if (!tr.length) console.log('  (none - trackPort promise did not reject)');

  console.log('\n10b. trackPort rejection (first load):');
  const tr1 = allSWFirst.filter(l => l.text.includes('[TRACKPORT] PROMISE REJECTED'));
  tr1.forEach(l => console.log(' ', l.text.substring(0, 500)));
  if (!tr1.length) console.log('  (none - trackPort promise did not reject)');

  console.log('\nFinal reload status:', JSON.stringify(reloadStatus));
  const finalCheck = await page.send('Runtime.evaluate', { expression: `JSON.stringify({portReady: window.__UV_BOOT_STATUS__?.portReady, bareMuxReady: window.__UV_BOOT_STATUS__?.bareMuxReady, swPortStatus: window.__UV_BOOT_STATUS__?.swPortStatus})`, returnByValue: true });
  console.log('Final boot status:', finalCheck?.result?.result?.value || 'N/A');

  if (swCDP1) { try { swCDP1.ws.close(); } catch(e) {} }
  chrome.kill();
  server.kill();
  console.log('\nDone.');
  setTimeout(() => process.exit(0), 1000);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); });
