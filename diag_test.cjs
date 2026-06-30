// Diagnostic test — captures SW runtime logs to prove where STARTUP-RECOVERY fails
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');

const SERVER_DIR = __dirname;
const SERVER_CMD = 'node';
const SERVER_ARGS = ['server.js'];
const TEST_URL = 'http://localhost:8080';
const MAX_WAIT_MS = 30000;
const POLL_INTERVAL = 500;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn(SERVER_CMD, SERVER_ARGS, {
      cwd: SERVER_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });
    let started = false;
    const timer = setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error('Server start timeout'));
      }
    }, 15000);

    proc.stdout.on('data', (data) => {
      const text = data.toString();
      process.stdout.write('[SERVER] ' + text);
      if (text.includes('listening') || text.includes('8080') || text.includes('port')) {
        if (!started) {
          started = true;
          clearTimeout(timer);
          resolve(proc);
        }
      }
    });
    proc.stderr.on('data', (data) => {
      process.stderr.write('[SERVER-ERR] ' + data.toString());
    });
    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    // Fallback: resolve after 3s even if we didn't catch the log line
    setTimeout(() => {
      if (!started) {
        started = true;
        clearTimeout(timer);
        console.log('[TEST] Fallback: assuming server started');
        resolve(proc);
      }
    }, 3000);
  });
}

async function getSWDiagnostics(page) {
  try {
    const result = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return { error: 'no-sw' };
      const reg = await navigator.serviceWorker.ready;
      if (!reg.active) return { error: 'no-active' };
      const channel = new MessageChannel();
      const response = await Promise.race([
        new Promise(resolve => {
          channel.port1.onmessage = e => resolve(e.data);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]);
      reg.active.postMessage({ type: 'GET_DIAG' }, [channel.port2]);
      return response;
    });
    return result;
  } catch (e) {
    return { error: e.message };
  }
}

async function main() {
  console.log('[TEST] Starting server...');
  const serverProc = await startServer();
  await sleep(1000);

  console.log('[TEST] Launching browser...');
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--enable-features=NetworkService,NetworkServiceInProcess']
  });

  const context = await browser.newContext({
    serviceWorkers: 'allow',
    permissions: []
  });

  const page = await context.newPage();

  // Collect page console logs
  const pageLogs = [];
  page.on('console', msg => pageLogs.push({ type: msg.type(), text: msg.text(), time: Date.now() }));
  page.on('pageerror', err => pageLogs.push({ type: 'error', text: err.message, time: Date.now() }));

  console.log('[TEST] Navigating to app...');
  await page.goto(TEST_URL, { waitUntil: 'networkidle', timeout: 15000 });
  console.log('[TEST] Page loaded, waiting for SW to settle...');

  // Wait for SW to be active
  let swReady = false;
  for (let i = 0; i < 20; i++) {
    const swStatus = await page.evaluate(async () => {
      try {
        if (!('serviceWorker' in navigator)) return 'no-sw-api';
        const reg = await navigator.serviceWorker.ready;
        if (reg.active) return 'active';
        return 'not-active';
      } catch (e) {
        return 'error: ' + e.message;
      }
    });
    console.log('[TEST] SW status at ' + (i * 500) + 'ms:', swStatus);
    if (swStatus === 'active') {
      swReady = true;
      break;
    }
    await sleep(500);
  }

  if (!swReady) {
    console.log('[TEST] SW never became active. Dumping page logs:');
    pageLogs.forEach(l => console.log('  [' + l.type + '] ' + l.text));
    await browser.close();
    serverProc.kill();
    return;
  }

  // Poll diagnostics over time
  console.log('[TEST] Polling SW diagnostics...');
  const snapshots = [];
  const startTime = Date.now();

  for (let i = 0; i < 40; i++) { // 20 seconds
    await sleep(500);
    const elapsed = Date.now() - startTime;
    const diag = await getSWDiagnostics(page);
    if (diag && diag.diagLog) {
      snapshots.push({ elapsed, diag });
      // Print new diag entries since last snapshot
      const prevLen = i > 0 ? snapshots[i-1].diag.diagLog.length : 0;
      const newEntries = diag.diagLog.slice(prevLen);
      if (newEntries.length > 0) {
        console.log('[TEST] t=' + elapsed + 'ms — ' + newEntries.length + ' new diag entries:');
        newEntries.forEach(e => {
          console.log('  [' + e.context + '] ' + e.msg + (e.extra ? ' ' + JSON.stringify(e.extra) : '') + ' t=' + e.t);
        });
      }
      // Also show port state
      if (diag.portState) {
        console.log('[TEST] PortState: status=' + diag.portState.status + ' portIsNull=' + diag.portState.portIsNull + ' reinitCount=' + diag.portState.reinitCount);
      }
      // Stop if we reached ready state
      if (diag.portState && diag.portState.status === 'ready') {
        console.log('[TEST] PORT IS READY — recovery succeeded');
        break;
      }
    } else {
      console.log('[TEST] No diag response:', diag);
    }
  }

  // Final dump
  console.log('\n[TEST] === FINAL DIAGNOSTIC DUMP ===');
  const finalDiag = await getSWDiagnostics(page);
  if (finalDiag && finalDiag.diagLog) {
    console.log(JSON.stringify(finalDiag.diagLog, null, 2));
  }
  if (finalDiag && finalDiag.portState) {
    console.log('\n[TEST] Final PortState:', JSON.stringify(finalDiag.portState));
  }

  console.log('\n[TEST] === PAGE CONSOLE LOGS (last 50) ===');
  pageLogs.slice(-50).forEach(l => console.log('  [' + l.type + '] ' + l.text));

  await browser.close();
  serverProc.kill();
  console.log('[TEST] Done.');
}

main().catch(err => {
  console.error('[TEST] FATAL:', err);
  process.exit(1);
});
