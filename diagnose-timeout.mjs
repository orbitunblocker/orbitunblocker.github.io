import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const DIR = dirname(fileURLToPath(import.meta.url));
let serverProcess = null;

function slog(msg, ...rest) {
  console.log(`[DIAG ${Date.now()}]`, msg, ...rest);
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['server.js'], { cwd: DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let started = false;
    serverProcess.stdout.on('data', d => {
      const text = d.toString();
      if (text.includes('RUNNING ON') && !started) { started = true; resolve(); }
    });
    serverProcess.stderr.on('data', d => {});
    setTimeout(() => { if (!started) reject(new Error('Server timeout')); }, 15000);
  });
}
function stopServer() { if (serverProcess) { serverProcess.kill(); serverProcess = null; } }

async function main() {
  slog('Starting server...');
  try { await startServer(); } catch (e) { slog('Server note:', e.message); }

  slog('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  const timeline = [];

  function mark(label, detail) {
    timeline.push({ t: Date.now(), label, detail });
  }

  // Console + errors
  page.on('console', msg => {
    const text = msg.text();
    if (text.includes('[BOOT-SW]') || text.includes('[HOP]') || text.includes('[SW-FETCH]') || text.includes('[DN-SEND]') || text.includes('[UV-ROUTE]') || text.includes('[DEFER-NAV]') || text.includes('[FLUSH-NAV]') || text.includes('[PORT_SYNC]') || text.includes('[PORT_READY]') || text.includes('[SYNC-REFRESH]') || text.includes('[PORT_STATE') || text.includes('[STATE]')) {
      mark('sw:' + text.substring(0, 150), '');
    }
    if (text.includes('503') || text.includes('timeout') || text.includes('error')) {
      const t = Date.now();
      slog(`  [PAGE ${t}] [${msg.type().toUpperCase()}] ${text.substring(0, 200)}`);
    }
  });
  page.on('pageerror', err => mark('page-error', err.message));

  // Network: capture ALL requests including SW-handled
  const requests = [];
  const failedReqs = [];
  page.on('request', req => {
    requests.push({ url: req.url(), method: req.method(), type: req.resourceType(), ts: Date.now(), stage: 'requested', status: null, error: null });
  });
  page.on('requestfailed', req => {
    const entry = requests.find(r => r.url === req.url() && r.stage === 'requested');
    if (entry) { entry.stage = 'failed'; entry.error = req.failure()?.errorText; }
    failedReqs.push({ url: req.url(), error: req.failure()?.errorText, ts: Date.now() });
    mark('network-fail', `${req.url().substring(0, 100)} - ${req.failure()?.errorText}`);
  });
  page.on('response', resp => {
    const entry = requests.find(r => r.url === resp.url() && r.stage === 'requested');
    if (entry) { entry.stage = 'responded'; entry.status = resp.status(); entry.responseTs = Date.now(); }
    // Check for error status from SW
    if (resp.status() >= 400) {
      mark('http-error', `${resp.status()} ${resp.url().substring(0, 100)}`);
    }
  });

  // Step 1: Open Orbit
  slog('Opening Orbit...');
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  mark('page-loaded', 'initial load complete');

  // Step 2: Wait for port ready
  const navStart = Date.now();
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(200);
    const ps = await page.evaluate(() => {
      const s = window.__UV_BOOT_STATUS__;
      return s ? { portReady: s.portReady, status: (s._log || []).filter(l => l.key === 'swPortStatus').pop()?.val || 'none' } : null;
    });
    if (ps && ps.portReady === true) {
      mark('port-ready', JSON.stringify(ps));
      slog(`Port ready at T+${Date.now() - navStart}ms:`, JSON.stringify(ps));
      break;
    }
    if (i === 49) slog('Port never ready');
  }

  // Step 3: Click Browser nav to render the browser UI (creates the iframe)
  slog('Clicking Browser nav icon...');
  await page.evaluate(() => {
    const navIcon = document.querySelector('.nav-icon[data-section="browser"]');
    if (navIcon) navIcon.click();
  });
  await page.waitForTimeout(2000);
  mark('browser-nav-clicked', '');

  // Check if iframe exists now
  const iframeExists = await page.evaluate(() => !!document.getElementById('browserFrame-main'));
  slog(`Browser iframe exists: ${iframeExists}`);
  if (!iframeExists) {
    slog('*** CRITICAL: browserFrame-main iframe not found even after clicking Browser nav');
    mark('critical', 'iframe-missing-after-nav-click');
  } else {
    mark('iframe-exists', 'browserFrame-main found');
  }

  // Get initial iframe state
  const iframeInitial = await page.evaluate(() => {
    const f = document.getElementById('browserFrame-main');
    if (!f) return { error: 'no iframe' };
    return { src: f.src, srcdoc: !!f.srcdoc, title: f.contentDocument?.title };
  });
  slog('Initial iframe:', JSON.stringify(iframeInitial));
  mark('iframe-initial', JSON.stringify(iframeInitial));

  // Step 4: Get SW diagnostics BEFORE navigation
  const diagBefore = await page.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const ch = new MessageChannel();
      return await Promise.race([
        new Promise(r => { ch.port1.onmessage = e => r(e.data); reg.active.postMessage({ type: 'GET_DIAG' }, [ch.port2]); }),
        new Promise(r => setTimeout(() => r({ error: 'timeout' }), 2000))
      ]);
    } catch(e) { return { error: e.message }; }
  });
  slog('SW diag:', JSON.stringify(diagBefore, null, 2));
  mark('sw-diag', JSON.stringify(diagBefore));

  // Step 5: Navigate using VoltraBrowser.navigate()
  const TEST_URL = 'https://example.com';
  slog(`\n--- NAVIGATING TO ${TEST_URL} ---`);
  mark('navigate-start', TEST_URL);

  await page.evaluate((url) => {
    try {
      window.VoltraBrowser.navigate(url);
    } catch(e) {
      console.error('[NAV-ERROR]', e.message);
    }
  }, TEST_URL);

  await page.waitForTimeout(1000);
  mark('navigate-1s', '');

  // Check UV_Route_Debug
  const routeDebug = await page.evaluate(() => window.__UV_ROUTE_DEBUG__ || {});
  slog('UV route debug:', JSON.stringify(routeDebug));
  mark('route-debug', JSON.stringify(routeDebug));

  // Check iframe
  const iframeNow = await page.evaluate(() => {
    const f = document.getElementById('browserFrame-main');
    if (!f) return { error: 'no iframe' };
    return { src: f.src, srcdoc: !!f.srcdoc, title: f.contentDocument?.title, bodyText: f.contentDocument?.body?.innerText?.substring(0, 200) };
  });
  slog('iframe after nav:', JSON.stringify(iframeNow));
  mark('iframe-after-nav', iframeNow.src);

  // Step 6: Poll for 25s watching for 503
  slog('Polling 25s for timeout...');
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(500);
    const state = await page.evaluate(() => {
      const f = document.getElementById('browserFrame-main');
      if (!f) return { error: 'no iframe' };
      try {
        const body = f.contentDocument?.body?.innerText || '';
        return {
          src: f.src,
          bodyPreview: body.substring(0, 300),
          bodySize: body.length,
          title: f.contentDocument?.title,
        };
      } catch(e) {
        return { src: f.src, accessError: e.message };
      }
    });
    if (state.bodyPreview && (state.bodyPreview.includes('503') || state.bodyPreview.includes('Proxy Timeout') || state.bodyPreview.includes('Proxy Not Ready'))) {
      slog(`*** 503 DETECTED at T+${Date.now() - navStart}ms`);
      slog(`    body: ${state.bodyPreview.substring(0, 200)}`);
      mark('503-detected', `T+${Date.now() - navStart}ms`);
      // Get the exact error
      if (state.bodyPreview.includes('Proxy Not Ready')) {
        slog('*** REASON: port-not-ready (status was not ready when SW received fetch)');
      } else if (state.bodyPreview.includes('Proxy Timeout')) {
        slog('*** REASON: SW 5s timeout (sw.fetch took >5s)');
      }
      break;
    }
    if (state.title && !state.title.includes('Orbit') && !state.title.includes('about:blank') && state.bodySize > 50) {
      slog(`*** NAVIGATION SUCCEEDED to "${state.title}" at T+${Date.now() - navStart}ms`);
      mark('nav-success', state.title);
      break;
    }
  }

  // Step 7: Final diagnostics
  const diagAfter = await page.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const ch = new MessageChannel();
      return await Promise.race([
        new Promise(r => { ch.port1.onmessage = e => r(e.data); reg.active.postMessage({ type: 'GET_DIAG' }, [ch.port2]); }),
        new Promise(r => setTimeout(() => r({ error: 'timeout' }), 2000))
      ]);
    } catch(e) { return { error: e.message }; }
  });
  slog('SW diag after:', JSON.stringify(diagAfter, null, 2));
  mark('sw-diag-after', JSON.stringify(diagAfter));

  // ===== REPORT =====
  slog('\n' + '='.repeat(70));
  slog('           TIMEOUT DIAGNOSTIC REPORT');
  slog('='.repeat(70));
  slog(`Test URL: ${TEST_URL}`);
  slog(`Total requests: ${requests.length}`);
  slog(`Failed requests: ${failedReqs.length}`);
  
  if (failedReqs.length > 0) {
    slog('\n--- FAILED REQUESTS ---');
    failedReqs.forEach((r, i) => slog(`  ${i+1}. ${r.url.substring(0, 120)} error: ${r.error}`));
  }

  const httpErrors = requests.filter(r => r.status && r.status >= 400);
  if (httpErrors.length > 0) {
    slog('\n--- HTTP ERRORS ---');
    httpErrors.forEach(r => slog(`  ${r.status} ${r.url.substring(0, 120)}`));
  }

  slog('\n--- TIMELINE (key events) ---');
  const navT = timeline.find(t => t.label === 'navigate-start')?.t || navStart;
  timeline.forEach(({ t, label, detail }) => {
    const rel = t - navT;
    if (rel > -5000 && rel < 30000) {
      slog(`  T${rel >= 0 ? '+' : ''}${rel}ms [${label}] ${detail ? detail.substring(0, 120) : ''}`);
    }
  });

  slog('\n--- ANALYSIS ---');
  const isPortNotReady = diagAfter?.portState?.status !== 'ready';
  const wantsToVisit = 'https://example.com';
  slog(`Port status: ${diagAfter?.portState?.status}`);
  slog(`lastPingOK: ${diagAfter?.portState?.lastPingOK}`);
  slog(`lastPingFail: ${diagAfter?.portState?.lastPingFail}`);
  slog(`reinitCount: ${diagAfter?.portState?.reinitCount}`);
  slog(`isPromise: ${diagAfter?.isPromise}`);

  await context.close();
  await browser.close();
  stopServer();

  const report = { timeline, requests, failedReqs, diagBefore, diagAfter, iframeInitial, iframeNow, routeDebug };
  fs.writeFileSync(join(DIR, 'timeout-report.json'), JSON.stringify(report, null, 2));
  slog('\nReport saved to timeout-report.json');
}

main().catch(e => { console.error('Fatal:', e); stopServer(); process.exit(1); });
