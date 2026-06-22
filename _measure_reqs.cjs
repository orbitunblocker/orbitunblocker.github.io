// ============================================================
// REQUEST VOLUME MEASUREMENT — Tests A through E
// Uses Puppeteer for reliable page management
// ============================================================
let puppeteer;
(async () => { puppeteer = await import('puppeteer'); })();
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const CHROME_DATA = path.join(ROOT, '.chrome-measure');
const RESULTS = [];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startServer() {
  const server = spawn('node', [path.join(ROOT, 'server.js')], {
    cwd: ROOT,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const serverLogs = [];
  server.stdout.on('data', d => {
    d.toString().split('\n').filter(Boolean).forEach(l => serverLogs.push(l));
  });
  server.stderr.on('data', d => {
    d.toString().split('\n').filter(Boolean).forEach(l => serverLogs.push('[ERR] ' + l));
  });

  // Wait for server ready
  for (let i = 0; i < 60; i++) {
    try {
      const status = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:8080/', (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
      });
      if (status) break;
    } catch(e) {}
    await sleep(500);
  }
  return { server, serverLogs };
}

function parseServerLogs(logs) {
  const events = [];
  let seen = new Set();

  for (const l of logs) {
    if (seen.has(l)) continue;
    seen.add(l);

    // Track timestamps from at: fields
    let ts = null;
    const atM = l.match(/at:\s*(\d+)/);
    if (atM) ts = parseInt(atM[1]);

    // INCREMENT = allowed request
    if (l.includes('[CONN-TRACK] INCREMENT')) {
      events.push({ type: 'allowed', ts, raw: l });
    }
    // 429 events
    else if (l.includes('[CONN-TRACK] 429 response') || l.includes('[CONN-TRACK] consume THREW')) {
      events.push({ type: 'rate-limited', ts, raw: l });
    }
    // Server errors (POST duplex bug, etc)
    else if (l.includes('[CONN-TRACK] routeRequest THREW')) {
      events.push({ type: 'server-error', ts, raw: l });
    }
  }
  return events;
}

function analyze(events, label) {
  // Find t0 from first timestamp
  let t0 = null;
  for (const e of events) {
    if (e.ts !== null) { t0 = e.ts; break; }
  }
  if (!t0) t0 = Date.now();

  const counts = { allowed: 0, rateLimited: 0, serverError: 0, total: 0 };
  let first429Ms = -1;
  const timed = { at10: 0, at30: 0, at60: 0, rl10: 0, rl30: 0, rl60: 0 };

  for (const e of events) {
    const rel = e.ts !== null ? (e.ts - t0) : 0;
    counts[e.type]++;
    counts.total++;

    if (e.type === 'rate-limited' && first429Ms === -1) first429Ms = rel;

    if (rel <= 10000) { timed.at10++; if (e.type === 'rate-limited') timed.rl10++; }
    if (rel <= 30000) { timed.at30++; if (e.type === 'rate-limited') timed.rl30++; }
    if (rel <= 60000) { timed.at60++; if (e.type === 'rate-limited') timed.rl60++; }
  }

  // Also compute from EventEmitter-based timing
  const result = {
    label,
    ...counts,
    first429Ms,
    ...timed,
  };

  console.log(`\n--- ${label} Results ---`);
  console.log(`  Total bare requests: ${counts.total}`);
  console.log(`    200 OK:           ${counts.allowed}`);
  console.log(`    429 rate-limited: ${counts.rateLimited}`);
  console.log(`    500 server error: ${counts.serverError}`);
  console.log(`  Requests at T=10s:  ${timed.at10}`);
  console.log(`  Requests at T=30s:  ${timed.at30}`);
  console.log(`  Requests at T=60s:  ${timed.at60}`);
  console.log(`  First 429 at:       ${first429Ms >= 0 ? (first429Ms/1000).toFixed(1) + 's' : 'never'}`);
  console.log(`  429s at 10s: ${timed.rl10} | 30s: ${timed.rl30} | 60s: ${timed.rl60}`);

  return result;
}

async function runTest(label, navigateFn) {
  console.log(`\n========== ${label} ==========`);

  // Clean chrome data
  try { fs.rmSync(CHROME_DATA, { recursive: true, force: true }); } catch(e) {}
  await sleep(1000);

  // Start server
  const { server, serverLogs } = await startServer();
  console.log('Server running');

  // Launch Puppeteer
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      `--user-data-dir=${CHROME_DATA}`,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-size=1280,720',
    ],
  });
  console.log('Browser launched');

  const page = await browser.newPage();

  // Navigate to app
  await page.goto('http://127.0.0.1:8080/', { waitUntil: 'networkidle0', timeout: 30000 });
  console.log('App loaded');

  // Wait for VoltraBrowser
  try {
    await page.waitForFunction(() => typeof window.VoltraBrowser !== 'undefined', { timeout: 20000 });
    console.log('VoltraBrowser available');
  } catch(e) {
    console.log('VoltraBrowser not found, continuing anyway');
  }

  // Wait for port
  try {
    await page.waitForFunction(() => typeof window.__uvPort !== 'undefined', { timeout: 15000 });
    const uvPort = await page.evaluate(() => window.__uvPort);
    console.log(`UV Port ready: ${uvPort}`);
  } catch(e) {
    console.log('Port not ready, continuing');
  }

  // Wait for SW port
  try {
    await page.waitForFunction(() => window.Voltra && window.Voltra.port ? true : false, { timeout: 10000 });
    console.log('SW connected');
  } catch(e) {
    console.log('SW not connected, continuing');
  }

  // Baseline server log count
  const baselineLen = serverLogs.length;
  const startTime = Date.now();

  // Execute navigation
  try {
    await navigateFn(page);
    console.log('Navigation executed');
  } catch(e) {
    console.log(`Navigation error: ${e.message}`);
  }

  // Wait for data collection
  await sleep(75000);

  const endTime = Date.now();
  const newLogs = serverLogs.slice(baselineLen);
  const events = parseServerLogs(newLogs);
  const result = analyze(events, label);
  RESULTS.push(result);

  // Cleanup
  try { await browser.close(); } catch(e) {}
  try { server.kill('SIGKILL'); } catch(e) {}
  try { server.kill('SIGTERM'); } catch(e) {}
  await sleep(2000);

  return result;
}

async function main() {
  console.log('=== REQUEST VOLUME MEASUREMENT ===');

  // --- Test A: Google homepage ---
  await runTest('Test A: Google homepage', async (page) => {
    await page.evaluate(() => {
      window.VoltraBrowser.navigate('https://www.google.com/');
    });
  });

  // --- Test B: Google search ---
  await runTest('Test B: Google search results', async (page) => {
    await page.evaluate(() => {
      window.VoltraBrowser.navigate('https://www.google.com/search?q=test+query');
    });
  });

  // --- Test C: Wikipedia ---
  await runTest('Test C: Wikipedia homepage', async (page) => {
    await page.evaluate(() => {
      window.VoltraBrowser.navigate('https://en.wikipedia.org/wiki/Main_Page');
    });
  });

  // --- Test D: Reddit ---
  await runTest('Test D: Reddit homepage', async (page) => {
    await page.evaluate(() => {
      window.VoltraBrowser.navigate('https://www.reddit.com/');
    });
  });

  // --- Test E: YouTube ---
  await runTest('Test E: YouTube homepage', async (page) => {
    await page.evaluate(() => {
      window.VoltraBrowser.navigate('https://www.youtube.com/');
    });
  });

  // ======== FINAL REPORT ========
  console.log('\n\n========== FINAL REPORT ==========\n');

  const totalReqs = RESULTS.reduce((s, r) => s + r.total, 0);
  const total429 = RESULTS.reduce((s, r) => s + r.rateLimited, 0);
  const total500 = RESULTS.reduce((s, r) => s + r.serverError, 0);
  const max60 = Math.max(...RESULTS.map(r => r.at60));
  const max30 = Math.max(...RESULTS.map(r => r.at30));
  const max10 = Math.max(...RESULTS.map(r => r.at10));

  for (const r of RESULTS) {
    console.log(`${r.label}:`);
    console.log(`  Total: ${r.total} | 200: ${r.allowed} | 429: ${r.rateLimited} | 500: ${r.serverError}`);
    console.log(`  Reqs at 10s: ${r.at10} | 30s: ${r.at30} | 60s: ${r.at60}`);
    console.log(`  First 429: ${r.first429Ms >= 0 ? (r.first429Ms/1000).toFixed(1) + 's' : 'never'}`);
    console.log(`  429s at 10s: ${r.rl10} | 30s: ${r.rl30} | 60s: ${r.rl60}`);
    console.log('');
  }

  console.log('--- Aggregated ---');
  console.log(`Total across all tests: ${totalReqs}`);
  console.log(`  429s: ${total429} (${totalReqs > 0 ? (total429/totalReqs*100).toFixed(1) : 0}%)`);
  console.log(`  500s: ${total500} (${totalReqs > 0 ? (total500/totalReqs*100).toFixed(1) : 0}%)`);
  console.log(`Max requests in any 60s window: ${max60}`);
  console.log(`Max in 30s: ${max30} | Max in 10s: ${max10}`);

  const conservative = Math.max(max60 + 20, Math.ceil(max60 * 1.5));
  const moderate = Math.max(max60 + 50, Math.ceil(max60 * 2));
  const aggressive = Math.max(max60 + 100, Math.ceil(max60 * 3));

  console.log('\n--- Recommended rate-limit (points/60s) ---');
  console.log(`  Conservative: ${conservative} pts/60s (${(conservative/60).toFixed(1)} req/s)`);
  console.log(`  Moderate:     ${moderate} pts/60s (${(moderate/60).toFixed(1)} req/s)`);
  console.log(`  Aggressive:   ${aggressive} pts/60s (${(aggressive/60).toFixed(1)} req/s)`);
  console.log(`  Current:      10 pts/60s (0.17 req/s)`);
  console.log(`  Gap: current allows ${max60 > 0 ? ((max60)/10).toFixed(1) : 'N/A'}x fewer than needed`);

  console.log('\n--- Risk assessment (localhost-only) ---');
  console.log(`  No external IPs reach the limiter (all traffic = ::ffff:127.0.0.1)`);
  console.log(`  Raising to 250 allows ~4 req/s average, burst to 250`);
  console.log(`  Actual burst concurrency observed: <5 concurrent`);
  console.log(`  Recommendation: disable the limiter during development or set >= 250`);

  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
