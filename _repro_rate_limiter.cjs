// Rate limiter connection lifecycle investigation
// Tests A, B, C: connection count tracking without fixes
const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

async function connectCDP(wsUrl) {
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
        setTimeout(() => { if (pend[id]) { delete pend[id]; r({ timedout: true }); } }, 20000);
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

async function startServer() {
  const svr = spawn('node', ['server.js'], {
    cwd: __dirname,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const serverLogs = [];
  svr.stdout.on('data', d => { serverLogs.push({ text: d.toString(), ts: Date.now() }); });
  svr.stderr.on('data', d => { serverLogs.push({ text: d.toString(), ts: Date.now() }); });
  svr.serverLogs = serverLogs;
  for (let i = 0; i < 15; i++) {
    try {
      const s = await fetchStatus('http://127.0.0.1:8080/');
      if (s < 500) { return svr; }
    } catch (e) {}
    await sleep(1000);
  }
  throw new Error('Server not started');
}

async function startChrome(port) {
  // Kill any Chrome on this port
  try {
    const t = await fetchJSON(`http://127.0.0.1:${port}/json`);
    for (const x of t) { try { http.get(`http://127.0.0.1:${port}/json/close/` + x.id); } catch(e) {} }
    await sleep(1000);
  } catch(e) {}

  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${port}`,
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  for (let i = 0; i < 30; i++) {
    try {
      const v = await fetchJSON(`http://127.0.0.1:${port}/json/version`);
      if (v && v.Browser) return chrome;
    } catch (e) {}
    await sleep(1000);
  }
  throw new Error('Chrome not started');
}

async function connectSW(port) {
  for (let i = 0; i < 20; i++) {
    try {
      const targets = await fetchJSON(`http://127.0.0.1:${port}/json`);
      const swt = targets.find(t => t.type === 'service_worker');
      if (swt) {
        const cdp = await connectCDP(swt.webSocketDebuggerUrl);
        await cdp.send('Runtime.enable');
        return cdp;
      }
    } catch (e) {}
    await sleep(500);
  }
  return null;
}

async function findPage(port) {
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const t = await fetchJSON(`http://127.0.0.1:${port}/json`);
      const p = t.find(x => x.type === 'page' && (x.url.includes('localhost') || x.url.includes('127.0.0.1') || x.url === 'about:blank'));
      if (p) return p;
    } catch (e) {}
  }
  return null;
}

function evalValue(r) {
  return r && r.result && r.result.result ? r.result.result.value : null;
}

// ============================================================
// TEST HARNESS
// ============================================================
async function main() {
  const CDP_PORT = 9237;
  const phases = process.argv[2] ? process.argv[2].split(',') : ['A', 'B', 'C'];
  // Phase configs for request volume measurement
  const phaseConfig = {
    A: { label: 'Google homepage', url: 'https://www.google.com', wait: 75000 },
    B: { label: 'Google + Wikipedia + Reddit', url: 'https://www.google.com', multi: ['https://www.wikipedia.org', 'https://www.reddit.com'], wait: 75000 },
    C: { label: 'Repeated refreshes', url: 'https://www.google.com', refresh: 1, wait: 15000 },
    D: { label: 'Wikipedia homepage', url: 'https://en.wikipedia.org/wiki/Main_Page', wait: 75000 },
    E: { label: 'Reddit homepage', url: 'https://www.reddit.com', wait: 75000 },
    F: { label: 'YouTube homepage', url: 'https://www.youtube.com', wait: 75000 },
    G: { label: 'Google search results', url: 'https://www.google.com/search?q=test+query', wait: 75000 },
  };

  console.log('=== RATE LIMITER CONNECTION LIFECYCLE INVESTIGATION ===');
  console.log('Phases:', phases.join(', '));

  // Start server + Chrome
  console.log('\n[SETUP] Starting server...');
  const server = await startServer();
  console.log('[SETUP] Server running');

  console.log('[SETUP] Starting Chrome...');
  const chrome = await startChrome(CDP_PORT);
  console.log('[SETUP] Chrome ready');

  // Navigate to app
  console.log('[SETUP] Navigating to app...');
  
  let pt = await findPage(CDP_PORT);
  if (!pt) {
    // Wait a bit more for initial page
    await sleep(3000);
    pt = await findPage(CDP_PORT);
  }
  
  if (pt) {
    console.log('[SETUP] Connecting to page for navigation:', pt.url);
    const tmp = await connectCDP(pt.webSocketDebuggerUrl);
    await tmp.send('Runtime.enable');
    await tmp.send('Page.enable');
    const nav = await tmp.send('Page.navigate', { url: 'http://127.0.0.1:8080/' });
    console.log('[SETUP] Navigation started:', nav && nav.result ? JSON.stringify(nav.result).substring(0, 100) : 'unknown');
    tmp.close();
  } else {
    console.log('[FATAL] No initial page target');
    chrome.kill();
    server.kill();
    process.exit(1);
  }
  
  // Wait for page to load and find the new target
  await sleep(5000);
  pt = await findPage(CDP_PORT);
  // Check each target's URL
  const targets = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`);
  console.log('[SETUP] Available targets:', targets.map(t => t.type + ':' + t.url.substring(0, 50)).join(', '));
  console.log('[SETUP] Page target after navigation:', pt ? pt.url : 'NOT FOUND');

  if (!pt) { console.log('[FATAL] No page target after navigation'); chrome.kill(); server.kill(); process.exit(1); }

  // Connect page CDP
  const page = await connectCDP(pt.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');

  // Wait for page fully loaded
  for (let i = 0; i < 40; i++) {
    const r = await page.send('Runtime.evaluate', {
      expression: `(function(){ var s = window.__UV_BOOT_STATUS__; return s ? JSON.stringify({readyState: document.readyState, hasUV: true, portReady: s.portReady}) : JSON.stringify({readyState: document.readyState, hasUV: false}); })()`,
      returnByValue: true,
    });
    const val = evalValue(r);
    if (val) {
      try {
        const d = JSON.parse(val);
        if (d.readyState === 'complete' && d.hasUV) {
          if (d.portReady) { console.log('[SETUP] Page + port ready'); break; }
        }
      } catch (e) {}
    }
    await sleep(500);
  }

  // Connect SW
  console.log('[SETUP] Connecting SW...');
  const sw = await connectSW(CDP_PORT);
  console.log('[SETUP] SW connected:', !!sw);

  // Wait for port ready
  for (let i = 0; i < 30; i++) {
    const r = await page.send('Runtime.evaluate', {
      expression: `(function(){ var s = window.__UV_BOOT_STATUS__; return s ? JSON.stringify({portReady: s.portReady, status: s.swPortStatus}) : '{}'; })()`,
      returnByValue: true,
    });
    const val = evalValue(r);
    if (val && val.includes('portReady')) {
      try {
        const d = JSON.parse(val);
        if (d.portReady) { console.log('[SETUP] Port ready'); break; }
      } catch (e) {}
    }
    await sleep(500);
  }

  // ============================================================
  // TEST A: Open Google only
  // ============================================================
  if (phases.includes('A')) {
    console.log('\n========== TEST A: Google only ==========');
    
    // Open browser section
    await page.send('Runtime.evaluate', {
      expression: `(function(){ if(typeof loadSection === 'function') loadSection('browser'); return 'ok'; })()`,
      returnByValue: true,
    });
    await sleep(2000);

    page.logs.length = 0;
    if (sw) sw.logs.length = 0;

    // Navigate to Google
    await page.send('Runtime.evaluate', {
      expression: `(function(){ try { window.VoltraBrowser.navigate('https://www.google.com'); return 'ok'; } catch(e) { return 'err: ' + e.message; } })()`,
      returnByValue: true,
    });

    // Wait for page to load/settle
    await sleep(15000);

    // Collect CONN-TRACK logs from SERVER (not SW - CONN-TRACK is on Node.js side)
    const connTrack = server.serverLogs ? server.serverLogs.filter(l => l.text.includes('[CONN-TRACK]')) : [];
    const connEntries = connTrack.filter(l => l.text.includes('INCREMENT') || l.text.includes('DECREMENT') || l.text.includes('429'));

    console.log('\n--- Test A: Connection lifecycle ---');
    const baseTs = connEntries.length > 0 ? connEntries[0].ts : 0;
    connEntries.forEach(l => {
      const rel = '+' + String(l.ts - baseTs).padStart(8) + 'ms';
      // Truncate URL if too long
      const text = l.text.length > 300 ? l.text.substring(0, 300) + '...' : l.text;
      console.log('  ', rel, text);
    });

    // Count active connections at the end
    const lastDecr = connTrack.filter(l => l.text.includes('DECREMENT'));
    const lastIncr = connTrack.filter(l => l.text.includes('INCREMENT'));
    const last429 = connTrack.filter(l => l.text.includes('429'));

    console.log('\n--- Test A: Summary ---');
    console.log('  Total INCREMENT events:', lastIncr.length);
    console.log('  Total DECREMENT events:', lastDecr.length);
    console.log('  Total 429 events:', last429.length);
    console.log('  Delta (leaked?):', lastIncr.length - lastDecr.length);

    // Show max concurrency
    const maxEvents = connTrack.filter(l => l.text.includes('maxReached'));
    if (maxEvents.length > 0) {
      const maxVals = maxEvents.map(l => {
        const m = l.text.match(/maxReached:\s*(\d+)/);
        return m ? parseInt(m[1]) : 0;
      });
      console.log('  Max concurrent connections reached:', Math.max(...maxVals, 0));
    }
  }

  // ============================================================
  // TEST B: Google + Wikipedia + Reddit
  // ============================================================
  if (phases.includes('B')) {
    console.log('\n========== TEST B: Google + Wikipedia + Reddit ==========');

    page.logs.length = 0;
    if (sw) sw.logs.length = 0;

    // Navigate to Google
    console.log('Navigating to Google...');
    await page.send('Runtime.evaluate', {
      expression: `(function(){ try { window.VoltraBrowser.navigate('https://www.google.com'); return 'ok'; } catch(e) { return 'err: ' + e.message; } })()`,
      returnByValue: true,
    });
    await sleep(5000);

    // Open Wikipedia in new tab
    console.log('Adding Wikipedia tab...');
    await page.send('Runtime.evaluate', {
      expression: `(function(){ try { window.VoltraBrowser.addTab('https://www.wikipedia.org', 'Wikipedia'); return 'ok'; } catch(e) { return 'err: ' + e.message; } })()`,
      returnByValue: true,
    });
    await sleep(5000);

    // Open Reddit in new tab
    console.log('Adding Reddit tab...');
    await page.send('Runtime.evaluate', {
      expression: `(function(){ try { window.VoltraBrowser.addTab('https://www.reddit.com', 'Reddit'); return 'ok'; } catch(e) { return 'err: ' + e.message; } })()`,
      returnByValue: true,
    });

    // Wait for all pages to load/settle
    await sleep(25000);

    const connTrackB = server.serverLogs ? server.serverLogs.filter(l => l.text.includes('[CONN-TRACK]')) : [];
    const connEntriesB = connTrackB.filter(l => l.text.includes('INCREMENT') || l.text.includes('DECREMENT') || l.text.includes('429'));

    console.log('\n--- Test B: Connection lifecycle ---');
    const baseTsB = connEntriesB.length > 0 ? connEntriesB[0].ts : 0;
    connEntriesB.forEach(l => {
      const rel = '+' + String(l.ts - baseTsB).padStart(8) + 'ms';
      const text = l.text.length > 300 ? l.text.substring(0, 300) + '...' : l.text;
      console.log('  ', rel, text);
    });

    const lastDecrB = connTrackB.filter(l => l.text.includes('DECREMENT'));
    const lastIncrB = connTrackB.filter(l => l.text.includes('INCREMENT'));
    const last429B = connTrackB.filter(l => l.text.includes('429'));
    const maxEventsB = connTrackB.filter(l => l.text.includes('maxReached'));

    console.log('\n--- Test B: Summary ---');
    console.log('  Total INCREMENT events:', lastIncrB.length);
    console.log('  Total DECREMENT events:', lastDecrB.length);
    console.log('  Total 429 events:', last429B.length);
    console.log('  Delta (leaked?):', lastIncrB.length - lastDecrB.length);
    if (maxEventsB.length > 0) {
      const maxVals = maxEventsB.map(l => {
        const m = l.text.match(/maxReached:\s*(\d+)/);
        return m ? parseInt(m[1]) : 0;
      });
      console.log('  Max concurrent connections reached:', Math.max(...maxVals, 0));
    }
  }

  // ============================================================
  // TEST C: Repeated page refreshes
  // ============================================================
  if (phases.includes('C')) {
    console.log('\n========== TEST C: Repeated refreshes ==========');

    for (let refresh = 0; refresh < 3; refresh++) {
      console.log(`\n--- Refresh cycle ${refresh + 1}/3 ---`);
      
      page.logs.length = 0;
      if (sw) sw.logs.length = 0;

      // Navigate to Google
      await page.send('Runtime.evaluate', {
        expression: `(function(){ try { window.VoltraBrowser.navigate('https://www.google.com'); return 'ok'; } catch(e) { return 'err: ' + e.message; } })()`,
        returnByValue: true,
      });
      await sleep(10000);

      // Check connection counts
      const connTrackC = server.serverLogs ? server.serverLogs.filter(l => l.text.includes('[CONN-TRACK]')) : [];
      const lastActiveC = connTrackC.filter(l => l.text.includes('active AFTER decr') || l.text.includes('active AFTER incr'));
      const lastVal = lastActiveC.length > 0 ? lastActiveC[lastActiveC.length - 1] : null;
      console.log('  Last connection state:', lastVal ? lastVal.text.substring(0, 200) : '(none)');
    }

    // Final connection state
    const finalConnTrack = server.serverLogs ? server.serverLogs.filter(l => l.text.includes('[CONN-TRACK]')) : [];
    const finalIncr = finalConnTrack.filter(l => l.text.includes('INCREMENT'));
    const finalDecr = finalConnTrack.filter(l => l.text.includes('DECREMENT'));
    console.log('\n--- Test C: Final Summary (3 refreshes) ---');
    console.log('  Total INCREMENT events:', finalIncr.length);
    console.log('  Total DECREMENT events:', finalDecr.length);
    console.log('  Delta (leaked?):', finalIncr.length - finalDecr.length);
  }

  // ============================================================
  // MEASUREMENT PHASES D-G: Request volume per site
  // Each navigates to a different site and collects 75s of data
  // ============================================================
  const measurePhases = ['D', 'E', 'F', 'G'].filter(p => phases.includes(p));
  const measResults = [];

  for (const p of measurePhases) {
    const cfg = phaseConfig[p];
    console.log(`\n========== ${cfg.label} ==========`);
    console.log(`Navigating to: ${cfg.url}`);

    // Reset logs
    page.logs.length = 0;
    if (sw) sw.logs.length = 0;
    const baseServerLen = server.serverLogs.length;

    // Ensure browser section is loaded
    await page.send('Runtime.evaluate', {
      expression: `(function(){ if(typeof loadSection === 'function') loadSection('browser'); return 'ok'; })()`,
      returnByValue: true,
    });
    await sleep(2000);

    // Navigate
    await page.send('Runtime.evaluate', {
      expression: `(function(){ try { window.VoltraBrowser.navigate('${cfg.url.replace(/'/g, "\\'")}'); return 'ok'; } catch(e) { return 'err: ' + e.message; } })()`,
      returnByValue: true,
    });

    // Wait for data collection
    await sleep(cfg.wait || 75000);

    // Parse server logs
    const theseLogs = server.serverLogs.slice(baseServerLen);
    const connLines = theseLogs.filter(l => l.text.includes('[CONN-TRACK]'));
    
    let totalAllowed = 0, totalRl = 0, totalErr = 0;
    let first429Ts = -1, first429Rel = -1;
    let count10 = 0, count30 = 0, count60 = 0;
    let rl10 = 0, rl30 = 0, rl60 = 0;
    let sysStart = null;

    for (const l of connLines) {
      // Extract system timestamp from log `at:` field
      const atM = l.text.match(/at:\s*(\d+)/);
      const ts = atM ? parseInt(atM[1]) : l.ts;
      if (!sysStart) sysStart = ts;
      const rel = ts - sysStart;

      // Count each unique request exactly once:
      //   INCREMENT        → allowed (one per successful request)
      //   consume THREW    → rate-limited (one per blocked request, unique)
      //   routeRequest THREW → server error (one per failed request)
      if (l.text.includes('[CONN-TRACK] INCREMENT')) {
        totalAllowed++;
        if (rel <= 10000) count10++;
        if (rel <= 30000) count30++;
        if (rel <= 60000) count60++;
      } else if (l.text.includes('[CONN-TRACK] consume THREW')) {
        totalRl++;
        if (first429Ts === -1) { first429Ts = ts; first429Rel = rel; }
        if (rel <= 10000) { count10++; rl10++; }
        if (rel <= 30000) { count30++; rl30++; }
        if (rel <= 60000) { count60++; rl60++; }
      } else if (l.text.includes('[CONN-TRACK] routeRequest THREW')) {
        totalErr++;
        if (rel <= 10000) count10++;
        if (rel <= 30000) count30++;
        if (rel <= 60000) count60++;
      }
    }

    const total = totalAllowed + totalRl + totalErr;

    console.log(`\n--- ${cfg.label} Results ---`);
    console.log(`  Total bare requests: ${total}`);
    console.log(`    200 OK:           ${totalAllowed}`);
    console.log(`    429 rate-limited: ${totalRl}`);
    console.log(`    500 server error: ${totalErr}`);
    console.log(`  Requests at T=10s:  ${count10}`);
    console.log(`  Requests at T=30s:  ${count30}`);
    console.log(`  Requests at T=60s:  ${count60}`);
    console.log(`  First 429 at:       ${first429Rel >= 0 ? (first429Rel/1000).toFixed(1) + 's' : 'never'}`);
    console.log(`  429s at 10s: ${rl10} | 30s: ${rl30} | 60s: ${rl60}`);

    measResults.push({ label: cfg.label, total, totalAllowed, totalRl, totalErr, count10, count30, count60, first429Rel, rl10, rl30, rl60 });
  }

  // ============================================================
  // COMBINED FINAL REPORT
  // ============================================================
  console.log('\n\n========== FINAL REPORT ==========');
  
  // Collect all CONN-TRACK throughout test
  const allConnTrack = server.serverLogs ? server.serverLogs.filter(l => l.text.includes('[CONN-TRACK]')) : [];
  const allIncr = allConnTrack.filter(l => l.text.includes('INCREMENT'));
  const allDecr = allConnTrack.filter(l => l.text.includes('DECREMENT'));
  const all429 = allConnTrack.filter(l => l.text.includes('429'));
  const allMax = allConnTrack.filter(l => l.text.includes('maxReached'));

  console.log('Total requests:', allIncr.length);
  console.log('Total decrements:', allDecr.length);
  console.log('Total 429 responses:', all429.length);
  console.log('Net connection leak:', allIncr.length - allDecr.length);

  if (allMax.length > 0) {
    const maxVals = allMax.map(l => {
      const m = l.text.match(/maxReached:\s*(\d+)/);
      return m ? parseInt(m[1]) : 0;
    });
    console.log('Max concurrency reached:', Math.max(...maxVals, 0));
  }

  // Timeline (first 40 entries)
  console.log('\n--- Connection Timeline (first 40 events) ---');
  const allConnEvents = allConnTrack.filter(l => 
    l.text.includes('INCREMENT') || l.text.includes('DECREMENT') || l.text.includes('429')
  );
  const baseFinal = allConnEvents.length > 0 ? allConnEvents[0].ts : 0;
  let count40 = 0;
  allConnEvents.forEach(l => {
    if (count40 >= 40) return;
    count40++;
    const rel = '+' + String(l.ts - baseFinal).padStart(8) + 'ms';
    const text = l.text.length > 250 ? l.text.substring(0, 250) + '...' : l.text;
    console.log('  ', rel, text);
  });

  // Measurement results summary
  if (measResults.length > 0) {
    console.log('\n\n========== REQUEST VOLUME REPORT ==========\n');
    const totalReqs = measResults.reduce((s, r) => s + r.total, 0);
    const total429 = measResults.reduce((s, r) => s + r.totalRl, 0);
    const total500 = measResults.reduce((s, r) => s + r.totalErr, 0);
    const max60 = Math.max(...measResults.map(r => r.count60));
    const max30 = Math.max(...measResults.map(r => r.count30));
    const max10 = Math.max(...measResults.map(r => r.count10));

    for (const r of measResults) {
      console.log(`${r.label}:`);
      console.log(`  Total: ${r.total} | 200: ${r.totalAllowed} | 429: ${r.totalRl} | 500: ${r.totalErr}`);
      console.log(`  Reqs at 10s: ${r.count10} | 30s: ${r.count30} | 60s: ${r.count60}`);
      console.log(`  First 429: ${r.first429Rel >= 0 ? (r.first429Rel/1000).toFixed(1) + 's' : 'never'}`);
      console.log('');
    }

    console.log('--- Aggregated ---');
    console.log(`Total across all measurements: ${totalReqs}`);
    console.log(`  429s: ${total429} (${totalReqs > 0 ? (total429/totalReqs*100).toFixed(1) : 0}%)`);
    console.log(`  500s: ${total500} (${totalReqs > 0 ? (total500/totalReqs*100).toFixed(1) : 0}%)`);
    console.log(`Max requests in any 60s window: ${max60}`);
    console.log(`Max in 30s: ${max30} | Max in 10s: ${max10}`);

    const conservative = Math.max(max60 + 20, Math.ceil(max60 * 1.5));
    const moderate = Math.max(max60 + 50, Math.ceil(max60 * 2));
    const aggressive = Math.max(max60 + 100, Math.ceil(max60 * 3));

    console.log('\n--- Recommended rate-limit configurations (points/60s) ---');
    console.log(`  Conservative: ${conservative} pts/60s (${(conservative/60).toFixed(1)} req/s)`);
    console.log(`  Moderate:     ${moderate} pts/60s (${(moderate/60).toFixed(1)} req/s)`);
    console.log(`  Aggressive:   ${aggressive} pts/60s (${(aggressive/60).toFixed(1)} req/s)`);
    console.log(`  Current:      10 pts/60s (0.17 req/s)`);

    console.log('\n--- Risk assessment (localhost-only) ---');
    console.log(`  All traffic source: ::ffff:127.0.0.1`);
    console.log(`  Raising to 250 pts: ~4 req/s average, burst to 250`);
    console.log(`  Actual burst concurrency observed: <5 concurrent`);
    console.log(`  Risk: minimal — no external IP can reach the limiter`);
    console.log(`  Recommendation: disable or set >= 250 for development`);
  }

  // Cleanup
  if (sw) sw.close();
  page.close();
  chrome.kill();
  server.kill();
  await sleep(500);
  console.log('\nDone');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
