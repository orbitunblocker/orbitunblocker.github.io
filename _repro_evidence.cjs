// Comprehensive evidence reproduction: POST 500 + GET 502 root cause
// Reverted code + deep instrumentation. No fixes.
const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
}

function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {};
    const logs = [];
    ws.on('open', () => resolve({
      ws, logs,
      send: (m, p) => new Promise(r => {
        const id = ++mid;
        pend[id] = r;
        ws.send(JSON.stringify({ id, method: m, params: p || {} }));
        setTimeout(() => { if (pend[id]) { delete pend[id]; r({ timedout: true }); } }, 15000);
      }),
      close: () => { try { ws.close(); } catch (e) {} }
    }));
    ws.on('error', reject);
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        else if (m.method === 'Runtime.consoleAPICalled') {
          const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
          logs.push({ text: args, ts: Date.now() });
        }
      } catch (e) {}
    });
  });
}

async function findTarget(port, type, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJSON(`http://127.0.0.1:${port}/json`);
      const t = targets.find(x => x.type === type || (type === 'shared_worker' && x.type === 'worker' && x.url && x.url.includes('bare-mux')));
      if (t) return t;
    } catch (e) {}
    await sleep(500);
  }
  return null;
}

async function main() {
  const CDP_PORT = 9236;
  const APP_PORT = 8080;

  // ============================================================
  // 1. Kill stale Chrome on CDP port
  // ============================================================
  try {
    const targets = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`);
    for (const t of targets) {
      try { http.get(`http://127.0.0.1:${CDP_PORT}/json/close/` + t.id); } catch (e) {}
    }
    await sleep(1000);
  } catch (e) {}

  // ============================================================
  // 2. Start server
  // ============================================================
  console.log('[SETUP] Starting server...');
  const serverLogPath = path.join(__dirname, 'server-trace.log');
  // Delete old server log
  try { fs.unlinkSync(serverLogPath); } catch (e) {}

  const server = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let serverBuf = '';
  server.stdout.on('data', d => serverBuf += d.toString());
  server.stderr.on('data', d => serverBuf += d.toString());
  await sleep(3000);

  // Verify server is up
  for (let i = 0; i < 15; i++) {
    try {
      const status = await fetchStatus(`http://127.0.0.1:${APP_PORT}/`);
      if (status < 500) { console.log('[SETUP] Server OK, status:', status); break; }
    } catch (e) {
      if (i === 14) { console.log('[FATAL] Server not started:', e.message); server.kill(); process.exit(1); }
      await sleep(1000);
    }
  }

  // ============================================================
  // 3. Start Chrome headless
  // ============================================================
  console.log('[SETUP] Starting Chrome...');
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${CDP_PORT}`,
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let chromeVer;
  for (let i = 0; i < 30; i++) {
    try {
      const v = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (v && v.Browser) { chromeVer = v.Browser; break; }
    } catch (e) {}
    await sleep(1000);
  }
  if (!chromeVer) { console.log('[FATAL] Chrome not ready'); chrome.kill(); server.kill(); process.exit(1); }
  console.log('[SETUP] Chrome:', chromeVer);

  // ============================================================
  // 4. Navigate to app
  // ============================================================
  let pt;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const t = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`);
      pt = t.find(x => x.type === 'page' && x.url !== 'about:blank');
      if (pt) break;
      // Navigate
      if (i === 0) {
        try {
          const page = t.find(x => x.type === 'page');
          if (page) {
            const cdp = await connectCDP(page.webSocketDebuggerUrl);
            await cdp.send('Runtime.enable');
            await cdp.send('Page.enable');
            await cdp.send('Page.navigate', { url: `http://127.0.0.1:${APP_PORT}/` });
            cdp.close();
          }
        } catch (e) {}
      }
    } catch (e) {}
  }
  if (!pt) { console.log('[FATAL] No page target'); chrome.kill(); server.kill(); process.exit(1); }

  // Re-find the page target with correct URL
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const t = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`);
      const p = t.find(x => x.type === 'page' && x.url.includes('localhost'));
      if (p) { pt = p; break; }
    } catch (e) {}
  }
  console.log('[SETUP] Page target:', pt.url);

  // ============================================================
  // 5. Connect page + SW CDP
  // ============================================================
  console.log('[SETUP] Connecting page CDP...');
  const page = await connectCDP(pt.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');

  // Wait for page to fully load
  console.log('[SETUP] Waiting for page load...');
  for (let i = 0; i < 60; i++) {
    const r = await page.send('Runtime.evaluate', {
      expression: `JSON.stringify({readyState: document.readyState, hasUV: typeof window.__UV_BOOT_STATUS__ !== 'undefined'})`,
      returnByValue: true,
    });
    const val = r && r.result && r.result.result ? r.result.result.value : null;
    if (val) {
      try {
        const d = JSON.parse(val);
        if (d.readyState === 'complete' && d.hasUV) break;
      } catch (e) {}
    }
    await sleep(500);
  }
  console.log('[SETUP] Page loaded');

  // Connect SW
  console.log('[SETUP] Connecting SW CDP...');
  let sw = null;
  for (let i = 0; i < 20; i++) {
    try {
      const targets = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`);
      const swt = targets.find(t => t.type === 'service_worker');
      if (swt) {
        const swCDP = await connectCDP(swt.webSocketDebuggerUrl);
        await swCDP.send('Runtime.enable');
        sw = swCDP;
        console.log('[SETUP] SW connected');
        break;
      }
    } catch (e) {}
    await sleep(500);
  }

  // Try SharedWorker target
  console.log('[SETUP] Looking for SharedWorker target...');
  let sharedWorker = null;
  for (let i = 0; i < 10; i++) {
    try {
      const targets = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`);
      // SharedWorker may appear as type 'worker' or 'shared_worker'
      const swt = targets.find(t => (t.type === 'worker' || t.type === 'shared_worker') && t.url && t.url.includes('bare-mux'));
      if (swt) {
        const swCDP = await connectCDP(swt.webSocketDebuggerUrl);
        await swCDP.send('Runtime.enable');
        sharedWorker = swCDP;
        console.log('[SETUP] SharedWorker connected:', swt.url);
        break;
      }
    } catch (e) {}
    await sleep(1000);
  }
  if (!sharedWorker) console.log('[SETUP] SharedWorker target NOT FOUND - logs will be limited');

  // ============================================================
  // 6. SETUP: Inject 2 persisted tabs
  // ============================================================
  console.log('\n=== PHASE 1: Inject persisted tabs ===');
  page.logs.length = 0;
  if (sw) sw.logs.length = 0;
  if (sharedWorker) sharedWorker.logs.length = 0;

  const injectResult = await page.send('Runtime.evaluate', {
    expression: `
      (function(){
        try {
          localStorage.setItem('voltra-browser-tabs', JSON.stringify({
            tabs: {
              'tab-1': { id: 'tab-1', url: 'https://www.google.com', title: 'Google' },
              'tab-2': { id: 'tab-2', url: 'https://www.wikipedia.org', title: 'Wikipedia' }
            },
            activeTabId: 'tab-1',
            tabCounter: 2
          }));
          return 'OK: ' + localStorage.getItem('voltra-browser-tabs').length + ' chars';
        } catch(e) { return 'ERROR: ' + e.message; }
      })()
    `,
    returnByValue: true,
  });
  console.log('[SETUP] Tabs injected:', injectResult && injectResult.result && injectResult.result.result ? injectResult.result.result.value : 'unknown');

  // ============================================================
  // 7. Wait for port ready
  // ============================================================
  console.log('\n=== PHASE 2: Wait for port readiness ===');
  for (let i = 0; i < 30; i++) {
    const r = await page.send('Runtime.evaluate', {
      expression: `(function(){ var s = window.__UV_BOOT_STATUS__; return s ? JSON.stringify({portReady: s.portReady, status: s.swPortStatus}) : 'no_status'; })()`,
      returnByValue: true,
    });
    const val = r && r.result && r.result.result ? r.result.result.value : null;
    if (val && val.includes('portReady')) {
      try {
        const d = JSON.parse(val);
        if (d.portReady) {
          console.log('[SETUP] Port ready at', (i + 1) * 500, 'ms');
          break;
        }
        if (i < 5 || i % 10 === 0) console.log('  port status:', d.status, 'portReady:', d.portReady);
      } catch (e) {}
    }
    await sleep(500);
  }

  // Try again to find SharedWorker after port is ready
  if (!sharedWorker) {
    for (let i = 0; i < 10; i++) {
      try {
        const targets = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`);
        const swt = targets.find(t => (t.type === 'worker' || t.type === 'shared_worker') && t.url && t.url.includes('bare-mux'));
        if (swt) {
          const swCDP = await connectCDP(swt.webSocketDebuggerUrl);
          await swCDP.send('Runtime.enable');
          sharedWorker = swCDP;
          console.log('[SETUP] SharedWorker connected (2nd attempt):', swt.url);
          break;
        }
      } catch (e) {}
      await sleep(500);
    }
  }

  // ============================================================
  // 8. CONFIGURE: Set Google as active tab, navigate
  // ============================================================
  console.log('\n=== PHASE 3: Open browser section and navigate to Google ===');
  
  // Clear logs before action
  page.logs.length = 0;
  if (sw) sw.logs.length = 0;
  if (sharedWorker) sharedWorker.logs.length = 0;

  // Open browser section
  const lsResult = await page.send('Runtime.evaluate', {
    expression: `(function(){ if(typeof loadSection === 'function') { loadSection('browser'); return 'OK'; } return 'loadSection not found'; })()`,
    returnByValue: true,
  });
  const lsVal = lsResult && lsResult.result && lsResult.result.result ? lsResult.result.result.value : 'unknown';
  console.log('[PHASE 3] loadSection result:', lsVal);
  await sleep(2000);

  // Click Google shortcut
  const clickResult = await page.send('Runtime.evaluate', {
    expression: `
      (function(){
        try {
          var vtb = window.VoltraBrowser;
          if (!vtb) return 'VoltraBrowser not found';
          vtb.navigate('https://www.google.com');
          return 'navigate called';
        } catch(e) { return 'ERROR: ' + e.message; }
      })()
    `,
    returnByValue: true,
  });
  console.log('[PHASE 3] Navigate Google:', clickResult && clickResult.result && clickResult.result.result ? clickResult.result.result.value : 'unknown');

  // Wait for Google to load/fail
  await sleep(10000);

  // ============================================================
  // 9. COLLECT LOGS AFTER GOOGLE LOAD
  // ============================================================
  console.log('\n=== COLLECTION: Logs after Google load ===\n');

  const pageLogsGoogle = page.logs.slice();
  const swLogsGoogle = sw ? sw.logs.slice() : [];
  const swLogsGoogleWorker = sharedWorker ? sharedWorker.logs.slice() : [];

  // Print DN-SEND logs (SW side - shows body transfer)
  const dnSend = swLogsGoogle.filter(l => l.text.includes('[DN-SEND]'));
  console.log('--- DN-SEND logs (SW side) ---');
  dnSend.forEach(l => console.log('  ', l.text));

  // Print BOOT-WORKER logs (SharedWorker side - shows fetch attempts)
  const bwLogs = swLogsGoogleWorker.filter(l => l.text.includes('[BOOT-WORKER]') || l.text.includes('[INSTR]'));
  console.log('\n--- BOOT-WORKER / INSTR logs (SharedWorker side) ---');
  bwLogs.forEach(l => console.log('  ', l.text));

  // Print HOP trace
  const hops = swLogsGoogle.filter(l => l.text.includes('[HOP]'));
  console.log('\n--- HOP trace ---');
  hops.forEach(l => console.log('  ', l.text));

  // Print FAIL events
  const fails = swLogsGoogle.filter(l => l.text.includes('[HOP] FAIL') || (l.text.includes('[HOP]') && l.text.includes('status: 5')));
  console.log('\n--- FAIL events ---');
  fails.forEach(l => console.log('  ', l.text));

  // Print server URLs returning 429
  const server429 = swLogsGoogleWorker.filter(l => l.text.includes('429'));
  console.log('\n--- 429-related logs ---');
  server429.forEach(l => console.log('  ', l.text));

  // Print SW-FETCH logs
  const swFetchs = swLogsGoogle.filter(l => l.text.includes('[SW-FETCH]'));
  console.log('\n--- SW-FETCH (response codes) ---');
  swFetchs.forEach(l => console.log('  ', l.text));

  // ============================================================
  // 10. Now navigate to Wikipedia
  // ============================================================
  console.log('\n=== PHASE 4: Navigate to Wikipedia ===');

  page.logs.length = 0;
  if (sw) sw.logs.length = 0;
  if (sharedWorker) sharedWorker.logs.length = 0;

  // Switch to tab-2 (Wikipedia) or create new
  const wikiResult = await page.send('Runtime.evaluate', {
    expression: `
      (function(){
        try {
          var vtb = window.VoltraBrowser;
          if (!vtb) return 'VoltraBrowser not found';
          // Create a new tab for Wikipedia
          vtb.addTab('https://www.wikipedia.org', 'Wikipedia');
          return 'addTab called';
        } catch(e) { return 'ERROR: ' + e.message; }
      })()
    `,
    returnByValue: true,
  });
  console.log('[PHASE 4] Navigate Wikipedia:', wikiResult && wikiResult.result && wikiResult.result.result ? wikiResult.result.result.value : 'unknown');
  await sleep(10000);

  // ============================================================
  // 11. COLLECT ALL EVIDENCE
  // ============================================================
  console.log('\n================== COMPREHENSIVE EVIDENCE ==================\n');

  const allSWLogs = sw ? sw.logs.slice() : [];
  const allPageLogs = page.logs.slice();
  const allSWWorkerLogs = sharedWorker ? sharedWorker.logs.slice() : [];

  // Merge all SW logs
  const dnSendAll = allSWLogs.filter(l => l.text.includes('[DN-SEND]'));
  const hopsAll = allSWLogs.filter(l => l.text.includes('[HOP]'));
  const failsAll = allSWLogs.filter(l => l.text.includes('[HOP] FAIL') || l.text.includes('FAIL]'));
  const hopFailAll = allSWLogs.filter(l => l.text.includes('[HOP]') && (l.text.includes('status: 5') || l.text.includes('FAIL')));
  const swFetchAll = allSWLogs.filter(l => l.text.includes('[SW-FETCH]'));
  const instrAll = allSWWorkerLogs.filter(l => l.text.includes('[INSTR]'));
  const bwAll = allSWWorkerLogs.filter(l => l.text.includes('[BOOT-WORKER]'));

  console.log('========== A: DN-SEND (body transfer from SW to SharedWorker) ==========');
  dnSendAll.forEach(l => console.log('  ', l.text));

  console.log('\n========== B: INSTR (SharedWorker POST/GET fetch instrumentation) ==========');
  instrAll.forEach(l => console.log('  ', l.text));

  console.log('\n========== C: HOP trace (per-hop request flow) ==========');
  hopsAll.forEach(l => console.log('  ', l.text));

  console.log('\n========== D: FAIL events ==========');
  hopFailAll.forEach(l => console.log('  ', l.text));

  console.log('\n========== E: SW-FETCH response codes ==========');
  swFetchAll.forEach(l => console.log('  ', l.text));

  console.log('\n========== F: Boot-worker startup diagnostics ==========');
  bwAll.forEach(l => console.log('  ', l.text));

  // ============================================================
  // Read server-trace.log
  // ============================================================
  console.log('\n========== G: Server-trace.log ==========');
  let serverLog = '';
  try {
    serverLog = fs.readFileSync(serverLogPath, 'utf8');
    const lines = serverLog.split('\n').filter(l => l.trim());
    lines.slice(-100).forEach(l => console.log('  ', l));
    console.log('  (Total:', lines.length, 'lines)');
  } catch (e) {
    console.log('  (server-trace.log not found:', e.message, ')');
  }

  // ============================================================
  // ANALYSIS
  // ============================================================
  console.log('\n========== H: ANALYSIS ==========\n');

  // POST failure analysis
  const postDnSend = dnSendAll.filter(l => l.text.includes('method: POST'));
  console.log('--- H1: POST requests sent via DN-SEND ---');
  postDnSend.forEach(l => console.log('  ', l.text));

  // Check for ReadableStream transfers
  const rsTransfers = dnSendAll.filter(l => l.text.includes('isRS: true'));
  console.log('\n--- H2: ReadableStream bodies transferred ---');
  rsTransfers.forEach(l => console.log('  ', l.text));

  // Check for errors in INSTR logs
  const instrErrors = instrAll.filter(l => l.text.includes('THREW') || l.text.includes('ERROR') || l.text.includes('FAIL'));
  console.log('\n--- H3: SharedWorker errors ---');
  instrErrors.forEach(l => console.log('  ', l.text));

  // 502 analysis
  const gen502 = instrAll.filter(l => l.text.includes('GENERATING 502'));
  console.log('\n--- H4: 502 generation events ---');
  gen502.forEach(l => console.log('  ', l.text));

  const rateLimited = instrAll.filter(l => l.text.includes('429'));
  console.log('\n--- H5: Rate limit (429) events ---');
  rateLimited.forEach(l => console.log('  ', l.text));

  // Server-side 429 detection
  const server429lines = serverLog.split('\n').filter(l => l.includes('-> 429'));
  console.log('\n--- H6: Server-side 429 responses ---');
  server429lines.slice(0, 20).forEach(l => console.log('  ', l));
  console.log('  Total 429s:', server429lines.length);

  // Bare-fetch entries (successful requests that reached bareFetch)
  const bareFetch = serverLog.split('\n').filter(l => l.includes('BARE-FETCH') || l.includes('BARE-SRV'));
  console.log('\n--- H7: Successful bare fetch entries ---');
  bareFetch.slice(0, 20).forEach(l => console.log('  ', l));

  // Server routeRequest calls
  const routeReq = serverLog.split('\n').filter(l => l.includes('routeRequest'));
  console.log('\n--- H8: Total routeRequest calls ---');
  routeReq.slice(0, 20).forEach(l => console.log('  ', l));
  console.log('  Total routeRequest:', routeReq.length, '| Total bareFetch:', bareFetch.length, '| Diff (rate-limited):', routeReq.length - bareFetch.length);

  // ============================================================
  // TIMELINE: successful GET vs failing POST (first divergence)
  // ============================================================
  console.log('\n========== I: GET vs POST divergence timeline ==========\n');

  // Organize by method
  const getHops = hopsAll.filter(l => l.text.includes('method: GET') || (l.text.includes('dest:') && !l.text.includes('POST')));
  const postHops = hopsAll.filter(l => l.text.includes('method: POST') || (l.text.includes('POST')));

  // Print GET timeline for one failed URL
  const failedGETs = hopsAll.filter(l => l.text.includes('status: 50'));
  if (failedGETs.length > 0) {
    const firstFail = failedGETs[0];
    // Find the decoded URL
    const urlMatch = firstFail.text.match(/url:\s*(\S+)/);
    const failUrl = urlMatch ? urlMatch[1] : '(unknown)';
    console.log('Tracking GET failure for:', failUrl.substring(0, 120));
    const chain = hopsAll.filter(l => l.text.includes(failUrl.substring(0, 60)));
    chain.forEach(l => console.log('  ', l.text));
    if (chain.length === 0) {
      // Try to match by dest or partial match
      console.log('  (no chain match by URL, showing all GET 50x)');
      failedGETs.forEach(l => console.log('  ', l.text));
    }
  } else {
    console.log('  (no GET 50x failures found)');
  }

  // Print POST failures
  if (postDnSend.length > 0) {
    console.log('\nPOST requests detected. Checking outcomes...');
    postDnSend.forEach(l => console.log('  DN-SEND:', l.text));
    // Find corresponding hops
    const postFails = hopsAll.filter(l => l.text.includes('POST') || l.text.includes('dest:') && l.text.includes('status: 5'));
    postFails.forEach(l => console.log('  HOP:', l.text));
  }

  // ============================================================
  // IF NO SharedWorker, try to evaluate expression to check page status
  // ============================================================
  if (!sharedWorker) {
    console.log('\n========== J: Page-side diagnostics (SharedWorker CDP unavailable) ==========');
    const diagResult = await page.send('Runtime.evaluate', {
      expression: `
        (function(){
          try {
            var vtb = window.VoltraBrowser;
            if (!vtb) return 'No browser';
            var activeTab = vtb.tabManager && vtb.tabManager.getActiveTab();
            if (!activeTab) return 'No active tab';
            var iframe = document.getElementById('browserFrame-' + activeTab.id);
            if (!iframe) return 'No iframe for ' + activeTab.id;
            return 'Active tab: ' + activeTab.id + ' url: ' + (activeTab.url || 'none') + ' title: ' + (activeTab.title || 'none') + ' iframe src: ' + iframe.src.substring(0, 100);
          } catch(e) { return 'ERROR: ' + e.message; }
        })()
      `,
      returnByValue: true,
    });
    const diagVal = diagResult && diagResult.result && diagResult.result.result ? diagResult.result.result.value : 'unknown';
    console.log('  Page state:', diagVal);
    
    // Try to get network errors from iframe
    const networkResult = await page.send('Runtime.evaluate', {
      expression: `
        (function(){
          var entries = performance && performance.getEntriesByType ? performance.getEntriesByType('resource') : [];
          var failing = [];
          for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (e.name && e.name.includes('/service/')) {
              // Can't get response status from Resource Timing, but we can get timing
            }
          }
          return 'Total resource entries: ' + entries.length;
        })()
      `,
      returnByValue: true,
    });
    const netVal = networkResult && networkResult.result && networkResult.result.result ? networkResult.result.result.value : 'unknown';
    console.log('  Network:', netVal);
  }

  // ============================================================
  // CLEANUP
  // ============================================================
  console.log('\n========== CLEANUP ==========');
  if (sw) sw.close();
  if (sharedWorker) sharedWorker.close();
  page.close();
  chrome.kill();
  server.kill();
  await sleep(500);
  console.log('Done. Server log saved to:', serverLogPath);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
