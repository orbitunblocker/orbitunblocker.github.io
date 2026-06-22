// Evidence collection for SYNC_PORT_STATE response-path fix
// Tests A-F

import puppeteer from 'puppeteer';
import { setTimeout as sleep } from 'timers/promises';

const BASE = 'http://localhost:8080';

async function retry(page, fn, retries = 5, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries - 1) throw e;
      await sleep(delayMs);
    }
  }
}

async function waitForController(page) {
  await retry(page, async () => {
    const has = await page.evaluate(() => !!navigator.serviceWorker.controller);
    if (!has) throw new Error('no controller yet');
  }, 15, 1000);
}

async function main() {
  console.log('=== SYNC_PORT_STATE FIX EVIDENCE ===\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for SW to fully activate and port to be ready
    console.log('Waiting for SW controller...');
    await waitForController(page);
    console.log('Controller ready.');
    await sleep(3000);

    // ========== A) Sync resolves via MessageChannel ==========
    console.log('\n[TEST A] syncPortStateFromSW() resolution...');
    const syncResult = await page.evaluate(async () => {
      const start = Date.now();
      await syncPortStateFromSW();
      const elapsed = Date.now() - start;
      return {
        elapsed,
        portReady: window.__UV_BOOT_STATUS__.portReady,
        failedStage: window.__UV_BOOT_STATUS__.failedStage,
        swPortStatus: window.__UV_BOOT_STATUS__.swPortStatus
      };
    });
    console.log('sync result:', JSON.stringify(syncResult, null, 2));
    const solved = syncResult.failedStage !== 'sync' && syncResult.elapsed < 3000;
    console.log('A) Resolved through MessageChannel (no timeout):', solved ? 'PASS' : 'FAIL');

    // ========== B) failedStage ==========
    const fs = await page.evaluate(() => window.__UV_BOOT_STATUS__.failedStage);
    console.log('\n[TEST B] failedStage:', fs);
    console.log('B) failedStage !== "sync":', fs !== 'sync' ? 'PASS' : 'FAIL');

    // ========== C) Full boot status ==========
    console.log('\n[TEST C] __UV_BOOT_STATUS__:');
    const boot = await page.evaluate(() => {
      const bs = window.__UV_BOOT_STATUS__;
      return {
        swReady: bs.swReady,
        portReady: bs.portReady,
        bareMuxReady: bs.bareMuxReady,
        failedStage: bs.failedStage
      };
    });
    console.log(JSON.stringify(boot, null, 2));
    console.log('C) boot status collected');

    // ========== D) SW DIAG ==========
    console.log('\n[TEST D] SW DIAG...');
    const diag = await retry(page, async () => {
      return await page.evaluate(() => {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout')), 5000);
          const ch = new MessageChannel();
          ch.port1.onmessage = e => {
            clearTimeout(t);
            ch.port1.close();
            resolve(e.data);
          };
          const c = navigator.serviceWorker.controller;
          if (!c) { clearTimeout(t); reject(new Error('no controller')); return; }
          c.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
        });
      });
    }, 3, 2000);
    console.log(JSON.stringify(diag, null, 2));
    console.log('D) DIAG collected');

    // ========== E) Reload test ==========
    console.log('\n[TEST E] Reload test...');
    console.log('portReady before reload:', boot.portReady);

    await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
    console.log('Waiting after reload...');
    await waitForController(page);
    await sleep(5000);

    const bootAfter = await page.evaluate(() => {
      const bs = window.__UV_BOOT_STATUS__;
      return {
        swReady: bs.swReady,
        portReady: bs.portReady,
        bareMuxReady: bs.bareMuxReady,
        failedStage: bs.failedStage,
        swPortStatus: bs.swPortStatus
      };
    });
    console.log('Boot after reload:', JSON.stringify(bootAfter, null, 2));

    // Also run sync explicitly
    const syncAfter = await page.evaluate(async () => {
      await syncPortStateFromSW();
      return {
        portReady: window.__UV_BOOT_STATUS__.portReady,
        failedStage: window.__UV_BOOT_STATUS__.failedStage,
        swPortStatus: window.__UV_BOOT_STATUS__.swPortStatus
      };
    });
    console.log('Sync after reload:', JSON.stringify(syncAfter, null, 2));

    const portReadyAfterReload = bootAfter.portReady || syncAfter.portReady;
    console.log('E) portReady after reload:', portReadyAfterReload ? 'true (PASS)' : 'false (FAIL)');

    // ========== F) reinitCount ==========
    console.log('\n[TEST F] reinitCount...');
    const diagFinal = await retry(page, async () => {
      return await page.evaluate(() => {
        return new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('timeout')), 5000);
          const ch = new MessageChannel();
          ch.port1.onmessage = e => {
            clearTimeout(t);
            ch.port1.close();
            resolve(e.data);
          };
          const c = navigator.serviceWorker.controller;
          if (!c) { clearTimeout(t); reject(new Error('no controller')); return; }
          c.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
        });
      });
    }, 3, 2000);
    console.log('DIAG reinitCount:', diagFinal.portState?.reinitCount);
    const reinitOk = diagFinal.portState?.reinitCount === 0;
    console.log('F) reinitCount unchanged (0):', reinitOk ? 'PASS' : 'FAIL');

    // ========== SUMMARY ==========
    console.log('\n========== FINAL SUMMARY ==========');
    console.log('A) MessageChannel sync resolution:', solved ? 'PASS' : 'FAIL');
    console.log('B) failedStage != "sync":', fs !== 'sync' ? 'PASS' : 'FAIL');
    console.log('C) Boot status:', JSON.stringify(boot));
    console.log('D) DIAG:', JSON.stringify(diag.portState));
    console.log('E) portReady after reload:', portReadyAfterReload ? 'PASS' : 'FAIL');
    console.log('F) reinitCount unchanged:', reinitOk ? 'PASS' : 'FAIL');

  } catch (err) {
    console.error('\nTEST FAILED:', err.message, err.stack);
  } finally {
    await browser.close();
    process.exit(0);
  }
}

main();
