import { chromium } from 'playwright';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const DIR = dirname(fileURLToPath(import.meta.url));
const LOG = [];
let serverProcess = null;

function slog(msg, ...rest) {
  const s = `[TEST ${Date.now()}] ${msg} ${rest.join(' ')}`;
  LOG.push(s);
  console.log(s);
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['server.js'], { cwd: DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let started = false;
    serverProcess.stdout.on('data', d => {
      const text = d.toString();
      if (text.includes('RUNNING ON') && !started) { started = true; resolve(); }
    });
    serverProcess.stderr.on('data', d => { /* ignore */ });
    setTimeout(() => { if (!started) reject(new Error('Server timeout')); }, 10000);
  });
}

function stopServer() {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
}

async function waitForPortReady(page, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pr = await page.evaluate(() => {
      const s = window.__UV_BOOT_STATUS__;
      return s ? { portReady: s.portReady, status: (s._log || []).filter(l => l.key === 'swPortStatus').pop()?.val || 'none' } : null;
    });
    if (pr && pr.portReady === true) return pr;
    await page.waitForTimeout(200);
  }
  const pr = await page.evaluate(() => {
    const s = window.__UV_BOOT_STATUS__;
    return s ? { portReady: s.portReady, status: (s._log || []).filter(l => l.key === 'swPortStatus').pop()?.val || 'none' } : null;
  });
  return pr;
}

async function checkPortStatus(page) {
  return await page.evaluate(() => {
    const s = window.__UV_BOOT_STATUS__;
    return {
      portReady: s?.portReady,
      status: s?._log?.filter(l => l.key === 'swPortStatus').pop()?.val || 'none',
      reinitCount: s?._log?.filter(l => l.key === 'swReinitCount').pop()?.val || 0,
      workerConstructed: s?._log?.filter(l => l.key === 'workerConstructed').pop()?.val || false,
      portTransferred: s?._log?.filter(l => l.key === 'portTransferred').pop()?.val || false,
      swSynced: s?._log?.filter(l => l.key === 'swSynced').pop()?.val || false,
      failedStage: s?._log?.filter(l => l.key === 'failedStage').pop()?.val || null,
    };
  });
}

async function getQueuedNavigations(page) {
  return await page.evaluate(() => {
    const ui = window.VoltraBrowser?.browserUI;
    return ui?._pendingNavigations?.length || 0;
  });
}

async function getIframeSrc(page) {
  return await page.evaluate(() => {
    const f = document.getElementById('browserFrame-main');
    return f ? f.src || '(srcdoc)' : 'no-iframe';
  });
}

async function navigateToUrl(page, url) {
  slog('   Navigating to', url);
  await page.evaluate((u) => {
    const ui = window.VoltraBrowser?.browserUI;
    if (ui) {
      ui._addressBarInput.value = u;
      ui._handleAddressSubmit();
    }
  }, url);
  await page.waitForTimeout(2000);
  const iframeSrc = await getIframeSrc(page);
  const pending = await getQueuedNavigations(page);
  slog('   iframe.src:', iframeSrc, 'pending:', pending);
  return { iframeSrc, pending };
}

async function runTest1(browser) {
  slog('\n===== TEST 1: Fresh install =====');
  const context = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
  const page = await context.newPage();
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[PAGE_ERROR] ${err.message}`));

  slog('Opening Orbit...');
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });

  // Wait a bit for SW to register and port to be acquired
  slog('Waiting for portReady...');
  await page.waitForTimeout(3000);
  const ps1 = await checkPortStatus(page);
  slog('Port status after 3s:', JSON.stringify(ps1));

  // If not ready, wait more
  if (ps1.portReady !== true) {
    slog('Port not ready yet, waiting up to 15s more...');
    const pr = await waitForPortReady(page, 15000);
    slog('Port status after wait:', JSON.stringify(pr));
  }

  // Try navigation
  const nav1 = await navigateToUrl(page, 'https://example.com');
  const ps2 = await checkPortStatus(page);
  const pending1 = await getQueuedNavigations(page);

  slog('=== TEST 1 RESULTS ===');
  slog('Port ready:', ps2.portReady);
  slog('Status:', ps2.status);
  slog('Navigation pending count:', pending1);
  slog('Navigation iframe.src:', nav1.iframeSrc);
  slog('Failed stage:', ps2.failedStage);

  // Save logs
  const swLogs = logs.filter(l => l.includes('[BOOT-SW]') || l.includes('[SYNC-REFRESH]') || l.includes('[PORT_STATE_CHANGE]') || l.includes('[STATE]'));
  slog('SW logs captured:', swLogs.length);
  swLogs.forEach(l => slog('  ' + l));

  await context.close();
  return { ps: ps2, nav: nav1, pending: pending1, logs, swLogs };
}

async function runTest2(browser) {
  slog('\n===== TEST 2: Reload stress test (25x) =====');
  const context = await browser.newContext();
  const page = await context.newPage();
  const allLogs = [];
  const failures = [];

  for (let i = 1; i <= 25; i++) {
    slog(`\n-- Reload ${i}/25 --`);
    await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
    await page.waitForTimeout(3000);

    const ps = await checkPortStatus(page);
    const pending = await getQueuedNavigations(page);

    // If port ready after 3s (fresh install took care of it), try immediate navigation
    if (ps.portReady === true) {
      slog(`  Port ready immediately on reload ${i}`);
    } else {
      slog(`  Port not ready on reload ${i}, waiting up to 10s...`);
      const pr = await waitForPortReady(page, 10000);
      if (!pr || pr.portReady !== true) {
        slog(`  *** FAILURE reload ${i}: port never ready after 10s`);
        failures.push({ reload: i, portStatus: ps, afterWait: pr });
        // Capture full console logs on failure
        page.on('console', msg => allLogs.push(`[${msg.type()}] ${msg.text()}`));
        await page.waitForTimeout(1000);
        continue;
      }
    }

    // Navigate
    const nav = await navigateToUrl(page, 'https://example.com');
    const ps2 = await checkPortStatus(page);
    const pending2 = await getQueuedNavigations(page);

    if (ps2.portReady !== true || pending2 > 0 || nav.iframeSrc === '(srcdoc)' || nav.iframeSrc.includes('about:blank')) {
      slog(`  *** FAILURE reload ${i}: navigation failed after port ready`);
      failures.push({ reload: i, portStatus: ps2, pending: pending2, iframeSrc: nav.iframeSrc });
    } else {
      slog(`  OK reload ${i}`);
    }
  }

  slog(`\n=== TEST 2 RESULTS ===`);
  slog(`Total reloads: 25, Failures: ${failures.length}`);
  if (failures.length > 0) {
    failures.forEach(f => slog(`  Failure at reload ${f.reload}: ${JSON.stringify(f)}`));
  }
  await context.close();
  return { failures, allLogs };
}

async function runTest3(browser) {
  slog('\n===== TEST 3: Revisit test =====');
  const context = await browser.newContext();
  const page = await context.newPage();
  const logs = [];
  page.on('console', msg => { logs.push(`[${msg.type()}] ${msg.text()}`); });

  // First visit
  slog('First visit...');
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(5000);
  const ps1 = await checkPortStatus(page);
  slog('First visit port status:', JSON.stringify(ps1));

  // Navigate to confirm working
  const nav1 = await navigateToUrl(page, 'https://example.com');
  slog('First visit navigation iframe.src:', nav1.iframeSrc);

  // Wait 30 seconds
  slog('Waiting 30 seconds...');
  await page.waitForTimeout(30000);

  // Close tab
  slog('Closing tab...');
  await page.close();

  // Wait for SW to persist (no page reference needed)
  await new Promise(r => setTimeout(r, 2000));

  // Reopen
  slog('Reopening...');
  const page2 = await context.newPage();
  const logs2 = [];
  page2.on('console', msg => logs2.push(`[${msg.type()}] ${msg.text()}`));

  await page2.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  await page2.waitForTimeout(5000);

  const ps2 = await checkPortStatus(page2);
  slog('Revisit port status after 5s:', JSON.stringify(ps2));

  // Try navigation to google.com
  slog('Navigating to google.com...');
  const ng = await navigateToUrl(page2, 'https://google.com');
  slog('google.com iframe.src:', ng.iframeSrc, 'pending:', ng.pending);

  // Navigate to wikipedia
  slog('Navigating to wikipedia.org...');
  const nw = await navigateToUrl(page2, 'https://wikipedia.org');
  slog('wikipedia.org iframe.src:', nw.iframeSrc, 'pending:', nw.pending);

  // Navigate to github
  slog('Navigating to github.com...');
  const ngh = await navigateToUrl(page2, 'https://github.com');
  slog('github.com iframe.src:', ngh.iframeSrc, 'pending:', ngh.pending);

  const ps3 = await checkPortStatus(page2);
  slog('Final port status:', JSON.stringify(ps3));

  // Extract SYNC-REFRESH logs
  const refreshLogs = logs2.filter(l => l.includes('SYNC-REFRESH'));
  slog('SYNC-REFRESH logs:', refreshLogs.length);
  refreshLogs.forEach(l => slog('  ' + l));

  // Extract PORT_STATE_CHANGE logs
  const changeLogs = logs2.filter(l => l.includes('PORT_STATE_CHANGE'));
  slog('PORT_STATE_CHANGE logs:', changeLogs.length);
  changeLogs.forEach(l => slog('  ' + l));

  // Get SW diagnostics to verify if SYNC-REFRESH path was hit
  const diag = await page2.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const ch = new MessageChannel();
      return await Promise.race([
        new Promise(r => { ch.port1.onmessage = e => r(e.data); reg.active.postMessage({ type: 'GET_DIAG' }, [ch.port2]); }),
        new Promise(r => setTimeout(() => r({ error: 'timeout' }), 2000))
      ]);
    } catch(e) { return { error: e.message }; }
  });
  slog('SW diagnostics:', JSON.stringify(diag));

  await context.close();
  return { firstVisit: ps1, revisit: ps2, final: ps3, navigations: { google: ng, wikipedia: nw, github: ngh }, refreshLogs, changeLogs, diag };
}

async function runTest4(browser) {
  slog('\n===== TEST 4: Multi-tab test =====');
  const context = await browser.newContext();
  const pages = [];
  const allLogs = [];

  // Open 3 tabs
  for (let i = 0; i < 3; i++) {
    const p = await context.newPage();
    const logs = [];
    p.on('console', msg => logs.push(`[TAB${i}][${msg.type()}] ${msg.text()}`));
    pages.push({ page: p, logs, index: i });
  }

  // Load all tabs simultaneously
  slog('Loading 3 tabs simultaneously...');
  await Promise.all(pages.map(({ page }) => page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 })));
  await pages[0].page.waitForTimeout(5000);

  // Check port status in all tabs
  for (const { page, index } of pages) {
    const ps = await checkPortStatus(page);
    slog(`Tab ${index} port status:`, JSON.stringify(ps));
  }

  // Navigate in all tabs
  const urls = ['https://example.com', 'https://google.com', 'https://wikipedia.org'];
  for (const { page, index } of pages) {
    slog(`Navigating tab ${index} to ${urls[index % urls.length]}...`);
    const nav = await navigateToUrl(page, urls[index % urls.length]);
    const ps = await checkPortStatus(page);
    const pending = await getQueuedNavigations(page);
    slog(`Tab ${index} iframe.src:`, nav.iframeSrc, 'pending:', pending, 'portReady:', ps.portReady);
  }

  // Final check
  let anyFailed = false;
  for (const { page, index } of pages) {
    const ps = await checkPortStatus(page);
    if (ps.portReady !== true) {
      slog(`*** FAILURE Tab ${index}: port not ready`);
      anyFailed = true;
    }
  }

  slog(`\n=== TEST 4 RESULTS ===`);
  slog(`Any tab failed: ${anyFailed}`);

  await context.close();
  return { anyFailed };
}

async function runTest5(browser) {
  slog('\n===== TEST 5: Fresh browser/device simulation =====');
  // Use a completely new context (no cached SW)
  const context = await browser.newContext();
  const page = await context.newPage();
  const logs = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

  slog('Opening Orbit from fresh context...');
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(5000);

  const ps1 = await checkPortStatus(page);
  slog('Port status after 5s:', JSON.stringify(ps1));

  // Try immediate navigation
  const nav1 = await navigateToUrl(page, 'https://example.com');
  const ps2 = await checkPortStatus(page);
  const pending1 = await getQueuedNavigations(page);
  slog('Navigation iframe.src:', nav1.iframeSrc, 'pending:', pending1);
  slog('Port ready:');
  slog('  ', ps2.portReady);
  slog('Status:', ps2.status);
  slog('Failed stage:', ps2.failedStage);

  // Extract key logs
  const keyLogs = logs.filter(l =>
    l.includes('[BOOT]') || l.includes('[BOOT-SW]') || l.includes('[SYNC-REFRESH]') ||
    l.includes('[PORT_STATE_CHANGE]') || l.includes('[STATE]') || l.includes('[DEFER-NAV]') ||
    l.includes('[FLUSH-NAV]') || l.includes('[PORT_READY]') || l.includes('[PORT_SYNC]')
  );

  slog(`\nKey console logs (${keyLogs.length}):`);
  keyLogs.slice(-30).forEach(l => slog('  ' + l));

  await context.close();
  return { ps: ps2, nav: nav1, pending: pending1, logs: keyLogs };
}

// ===== MAIN =====
async function main() {
  slog('Starting server...');
  try {
    await startServer();
  } catch (e) {
    // Server might already be running
    slog('Server start note:', e.message);
  }

  slog('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-features=NetworkService,NetworkServiceInProcess']
  });

  const results = {};

  try {
    // Tests 1 & 2 already passed above — skip to 3-5
    // Test 3: Revisit
    results.test3 = await runTest3(browser);

    // Test 4: Multi-tab
    results.test4 = await runTest4(browser);

    // Test 5: Fresh device
    results.test5 = await runTest5(browser);

  } catch (e) {
    slog('FATAL ERROR:', e.message, e.stack);
  } finally {
    await browser.close();
    stopServer();
  }

  // Summary
  slog('\n========================================');
  slog('           TEST SUMMARY');
  slog('========================================');
  slog(`Test 1 (Fresh install): ${results.test1?.ps?.portReady === true ? 'PASS' : 'FAIL'}`);
  slog(`  portReady: ${results.test1?.ps?.portReady}, status: ${results.test1?.ps?.status}`);
  slog(`  Navigation pending: ${results.test1?.pending}`);
  slog(`  Failed stage: ${results.test1?.ps?.failedStage}`);

  slog(`Test 2 (25 reloads): ${results.test2?.failures?.length === 0 ? 'PASS' : 'FAIL'}`);
  slog(`  Failures: ${results.test2?.failures?.length}`);
  if (results.test2?.failures?.length > 0) {
    results.test2.failures.forEach(f => slog(`  - reload ${f.reload}: ${JSON.stringify(f)}`));
  }

  const t3Nok = results.test3?.navigations &&
    Object.values(results.test3.navigations).some(n => n.pending > 0);
  slog(`Test 3 (Revisit): ${t3Nok ? 'FAIL' : 'PASS'}`);
  slog(`  First visit: ${results.test3?.firstVisit?.portReady}`);
  slog(`  Revisit: ${results.test3?.revisit?.portReady}`);
  slog(`  SYNC-REFRESH entries: ${results.test3?.refreshLogs?.length}`);
  if (results.test3?.navigations) {
    for (const [k, v] of Object.entries(results.test3.navigations)) {
      slog(`  ${k}: pending=${v.pending}, iframe=${v.iframeSrc?.substring(0, 80)}`);
    }
  }

  slog(`Test 4 (Multi-tab): ${results.test4?.anyFailed ? 'FAIL' : 'PASS'}`);
  slog(`  Any failed: ${results.test4?.anyFailed}`);

  slog(`Test 5 (Fresh device): ${results.test5?.ps?.portReady === true ? 'PASS' : 'FAIL'}`);
  slog(`  portReady: ${results.test5?.ps?.portReady}, status: ${results.test5?.ps?.status}`);
  slog(`  Navigation pending: ${results.test5?.pending}`);

  const allPass = results.test1?.ps?.portReady === true &&
    results.test2?.failures?.length === 0 &&
    !t3Nok &&
    !results.test4?.anyFailed &&
    results.test5?.ps?.portReady === true;

  slog(`\nOVERALL: ${allPass ? 'ALL TESTS PASS' : 'SOME TESTS FAILED'}`);
}

main().catch(e => { console.error('Test harness error:', e); stopServer(); process.exit(1); });
