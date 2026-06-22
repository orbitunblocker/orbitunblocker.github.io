// Evidence: proxy pipeline works after recovery
// Uses SW console logs ([TRACE]) + DIAG + direct fetch

import puppeteer from 'puppeteer';
import { setTimeout as sleep } from 'timers/promises';

const BASE = 'http://localhost:8080';

async function getDiag(page) {
  return await page.evaluate(() => new Promise((res, rej) => {
    const t = setTimeout(() => rej('timeout'), 5000);
    const ch = new MessageChannel();
    ch.port1.onmessage = e => { clearTimeout(t); ch.port1.close(); res(e.data); };
    const c = navigator.serviceWorker.controller;
    if (!c) { clearTimeout(t); rej('no controller'); return; }
    c.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
  }));
}

async function main() {
  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // --- Data collection ---
    const swTraces = [];   // SW [TRACE] logs
    const bootLogs = [];   // [BOOT] logs
    const requestLog = []; // Page-level request/response tracking
    page.on('console', msg => {
      const text = msg.text();
      if (text.includes('[TRACE]')) swTraces.push(text);
      if (text.includes('[BOOT]')) bootLogs.push(text);
    });
    page.on('pageerror', err => { swTraces.push('[PAGE_ERROR] ' + err.message); });
    page.on('request', req => {
      if (req.url().includes('/service/')) {
        requestLog.push({ type: 'request', url: req.url().substring(0, 120), method: req.method(), ts: Date.now() });
      }
    });
    page.on('requestfinished', req => {
      if (req.url().includes('/service/')) {
        const existing = requestLog.find(r => r.type === 'request' && r.url.substring(0, 80) === req.url().substring(0, 80));
        if (existing) existing.type = 'finished';
      }
    });
    page.on('response', resp => {
      if (resp.url().includes('/service/')) {
        requestLog.push({
          type: 'response',
          url: resp.url().substring(0, 120),
          status: resp.status(),
          fromSW: resp.fromServiceWorker(),
          ts: Date.now()
        });
      }
    });

    // ============================================================
    // PHASE 1: First load & baseline request
    // ============================================================
    console.log('=== PHASE 1: First load & baseline ===\n');
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 20000 });
    swTraces.length = 0; // flush traces from initial boot
    bootLogs.length = 0;

    // Wait for boot to complete
    for (let tries = 0; tries < 30; tries++) {
      const ready = await page.evaluate(() =>
        window.__UV_BOOT_STATUS__?.portReady === true &&
        window.__UV_BOOT_STATUS__?.swPortStatus === 'ready'
      );
      if (ready) break;
      await sleep(500);
    }

    const boot1 = await page.evaluate(() => ({
      portReady: window.__UV_BOOT_STATUS__?.portReady,
      swPortStatus: window.__UV_BOOT_STATUS__?.swPortStatus
    }));
    console.log('Boot (first load):', JSON.stringify(boot1));

    // Baseline: encode a URL and fetch it through the SW
    const baselineResult = await page.evaluate(async () => {
      const enc = Ultraviolet.codec.xor.encode('https://example.com/');
      const url = '/service/' + enc;
      const resp = await fetch(url);
      const body = await resp.text();
      return {
        url: url,
        status: resp.status,
        statusText: resp.statusText,
        bodyLen: body.length,
        contentType: resp.headers.get('content-type'),
        hasExample: body.includes('Example Domain') || body.includes('example.com')
      };
    });
    console.log('Baseline fetch:', JSON.stringify(baselineResult, null, 2));

    // DIAG
    const diag1 = await getDiag(page);
    console.log('DIAG (first load):', JSON.stringify(diag1, null, 2));

    // Capture SW traces for baseline
    const traceSnap1 = swTraces.filter(t => t.includes('[TRACE]'));
    swTraces.length = 0;
    console.log('SW traces (baseline, last 5):', traceSnap1.slice(-5).join('\n  '));

    // ============================================================
    // PHASE 2: Reload & recovery
    // ============================================================
    console.log('\n=== PHASE 2: Reload & recovery ===\n');
    await page.reload({ waitUntil: 'networkidle0', timeout: 20000 });
    swTraces.length = 0;
    bootLogs.length = 0;

    // Wait for recovery with timeout
    let recovered = false;
    for (let tries = 0; tries < 60; tries++) {
      const status = await page.evaluate(() => ({
        portReady: window.__UV_BOOT_STATUS__?.portReady,
        swPortStatus: window.__UV_BOOT_STATUS__?.swPortStatus,
        recoveryAttempted: !!window.__UV_RECOVERY_ATTEMPTED__
      }));
      if (status.portReady === true && status.swPortStatus === 'ready') {
        console.log('RECOVERED at try', tries, JSON.stringify(status));
        recovered = true;
        break;
      }
      await sleep(500);
    }

    const bootAfter = await page.evaluate(() => ({
      portReady: window.__UV_BOOT_STATUS__?.portReady,
      swPortStatus: window.__UV_BOOT_STATUS__?.swPortStatus,
      recoveryAttempted: !!window.__UV_RECOVERY_ATTEMPTED__
    }));
    console.log('Boot (after reload):', JSON.stringify(bootAfter));
    if (!recovered) {
      console.log('RECOVERY DID NOT COMPLETE WITHIN TIMEOUT');
    }

    // ============================================================
    // PHASE 3: Evidence collection: fetch through proxy after recovery
    // ============================================================
    console.log('\n=== PHASE 3: Proxy fetch after recovery ===\n');

    // A) portReady before request
    const beforeBoot = await page.evaluate(() => ({
      portReady: window.__UV_BOOT_STATUS__?.portReady,
      swPortStatus: window.__UV_BOOT_STATUS__?.swPortStatus
    }));
    console.log('A) portReady before request:', beforeBoot.portReady);
    console.log('B) swPortStatus before request:', beforeBoot.swPortStatus);

    // C) Clear traces before the fetch
    swTraces.length = 0;

    // Perform the fetch
    const fetchResult = await page.evaluate(async () => {
      const enc = Ultraviolet.codec.xor.encode('https://example.com/');
      const url = '/service/' + enc;
      const resp = await fetch(url);
      const body = await resp.text();
      return {
        requestUrl: url,
        status: resp.status,
        statusText: resp.statusText,
        bodyLen: body.length,
        contentType: resp.headers.get('content-type'),
        hasExampleDomain: body.includes('Example Domain'),
        hasExampleCom: body.includes('example.com'),
        headers: Object.fromEntries([...resp.headers].map(([k, v]) => [k, v.substring(0, 80)]))
      };
    });
    console.log('D) Final HTTP status:', fetchResult.status, fetchResult.statusText);
    console.log('E) Response body length:', fetchResult.bodyLen);
    console.log('F) Contains "Example Domain":', fetchResult.hasExampleDomain);

    // Print request log (captured by Puppeteer request/response events)
    const serviceReqs = requestLog.filter(r => r.url && r.url.includes('/service/'));
    console.log('\nC) Request/response log (' + serviceReqs.length + ' entries):');
    serviceReqs.forEach(r => console.log('   ' + JSON.stringify(r)));

    // Check if response came from SW
    const swResponse = serviceReqs.find(r => r.type === 'response');
    const fromServiceWorker = swResponse?.fromSW === true;

    // DIAG after fetch
    const diagAfter = await getDiag(page);
    console.log('\nDIAG (after fetch):', JSON.stringify(diagAfter, null, 2));

    // ============================================================
    // SUMMARY
    // ============================================================
    console.log('\n========== RESULTS ==========');
    const aOk = beforeBoot.portReady === true;
    const bOk = beforeBoot.swPortStatus === 'ready';
    const cOk = fromServiceWorker;
    const dOk = fetchResult.status === 200;
    const eOk = fetchResult.bodyLen > 100;
    const fOk = fetchResult.hasExampleDomain === true;
    console.log('A) portReady before request:', aOk ? 'PASS' : 'FAIL');
    console.log('B) swPortStatus before request:', bOk ? 'PASS' : 'FAIL');
    console.log('C) response.fromServiceWorker() === true:', cOk ? 'PASS' : 'FAIL (' + (swResponse?.fromSW) + ')');
    console.log('D) Final HTTP status 200:', dOk ? 'PASS' : 'FAIL (' + fetchResult.status + ')');
    console.log('E) Response body length > 100:', eOk ? 'PASS' : 'FAIL (' + fetchResult.bodyLen + ')');
    console.log('F) Body contains expected text:', fOk ? 'PASS' : 'FAIL');
    console.log('Recovery required:', bootAfter.recoveryAttempted ? 'YES' : 'NO (was already ready)');

  } catch (err) {
    console.error('\nTEST ERROR:', err.message, '\n', err.stack?.split('\n').slice(0, 3).join('\n'));
  } finally {
    await browser.close();
    process.exit(0);
  }
}

main();
