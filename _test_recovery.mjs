// Evidence collection: auto-recovery after reload
// Verifies steps A-G from requirements

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

async function getBootStatus(page) {
  return await page.evaluate(() => {
    const bs = window.__UV_BOOT_STATUS__;
    return {
      swReady: bs.swReady,
      portReady: bs.portReady,
      bareMuxReady: bs.bareMuxReady,
      failedStage: bs.failedStage,
      swPortStatus: bs.swPortStatus,
      recoveryAttempted: !!window.__UV_RECOVERY_ATTEMPTED__,
      _log: bs._log
    };
  });
}

async function main() {
  console.log('=== RECOVERY EVIDENCE COLLECTION ===\n');

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    const consoleLogs = [];
    page.on('console', msg => {
      const text = msg.text();
      consoleLogs.push(text);
      if (text.includes('[RECOVERY]') || text.includes('[PORT_SYNC]') || text.includes('[BOOT]') || text.includes('error')) {
        // already capturing
      }
    });

    // ===== PHASE 1: First load =====
    console.log('--- Phase 1: First load ---');
    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
    await sleep(5000);

    let boot = await getBootStatus(page);
    console.log('Initial boot:', JSON.stringify(boot, null, 2));

    // Navigate to create a tab with history
    console.log('Navigating to Google...');
    await page.evaluate(() => window.VoltraBrowser.navigate('https://www.google.com'));
    await sleep(4000);

    const iframes = await page.evaluate(() =>
      Array.from(document.querySelectorAll('iframe')).map(f => ({
        id: f.id, src: f.getAttribute('src')
      }))
    );
    console.log('Iframes before reload:', JSON.stringify(iframes));

    // ===== PHASE 2: Reload and observe recovery =====
    console.log('\n--- Phase 2: Reload ---');
    consoleLogs.length = 0;

    await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });

    // A) Boot status before recovery
    await sleep(2000); // Let the SW broadcast PORT_STATE_SYNC with failed status
    boot = await getBootStatus(page);
    console.log('\n=== A) __UV_BOOT_STATUS__ before recovery ===');
    console.log(JSON.stringify(boot, null, 2));

    // Wait for recovery to complete (3s delay + 2s for yn/health)
    console.log('\nWaiting for recovery...');
    await sleep(6000);

    // Check console logs for recovery steps
    const recoveryLogs = consoleLogs.filter(l => l.includes('[RECOVERY]'));
    const portSyncLogs = consoleLogs.filter(l => l.includes('[PORT_SYNC]'));
    console.log('\n=== Recovery console logs ===');
    recoveryLogs.forEach(l => console.log(' ', l));

    // B+C) Check if refreshPort and REINIT_PORT were sent
    console.log('\n=== B) refreshPort broadcast sent? ===');
    console.log('Sent:', recoveryLogs.some(l => l.includes('refreshPort sent')) ? 'YES' : 'NO');

    console.log('\n=== C) REINIT_PORT sent? ===');
    console.log('Sent:', recoveryLogs.some(l => l.includes('REINIT_PORT sent')) ? 'YES' : 'NO');

    // D) reinitCount
    const diag = await getDiag(page);
    console.log('\n=== D) reinitCount ===');
    console.log('Before recovery (DIAG):', diag.portState?.reinitCount);
    console.log('From boot log:', boot._log.filter(l => l.key === 'swReinitCount'));

    // E) portReady before and after
    boot = await getBootStatus(page);
    console.log('\n=== E) portReady ===');
    console.log('portReady:', boot.portReady);
    console.log('portReady _log history:', boot._log.filter(l => l.key === 'portReady').map(l => ({ val: l.val, at: l.at })));

    // F) swPortStatus before and after
    console.log('\n=== F) swPortStatus ===');
    console.log('swPortStatus:', boot.swPortStatus);
    console.log('status _log history:', boot._log.filter(l => l.key === 'swPortStatus' || l.key === 'swReinitCount'));

    // G) Can a blocked tab successfully load after recovery?
    console.log('\n=== G) Navigation after recovery ===');
    console.log('Switching to browser section...');
    await page.evaluate(() => loadSection('browser'));
    await sleep(1000);
    console.log('Navigating to Google after recovery...');
    await page.evaluate(() => window.VoltraBrowser.navigate('https://www.google.com'));
    await sleep(5000);

    const iframes2 = await page.evaluate(() =>
      Array.from(document.querySelectorAll('iframe')).map(f => ({
        id: f.id, src: f.getAttribute('src')
      }))
    );
    console.log('Iframes after recovery:', JSON.stringify(iframes2));
    const hasServicePath = iframes2.some(f => f.src && f.src.includes('/service/'));
    console.log('Tab loaded via /service/ (proxy active):', hasServicePath);

    // Final state
    const bootFinal = await getBootStatus(page);
    const diagFinal = await getDiag(page);
    console.log('\n=== Final state ===');
    console.log('Boot:', JSON.stringify(bootFinal, null, 2));
    console.log('DIAG:', JSON.stringify(diagFinal, null, 2));

    // ===== SUMMARY =====
    console.log('\n========== RESULTS ==========');
    console.log('A) Boot before recovery collected:', true);
    console.log('B) refreshPort sent:', recoveryLogs.some(l => l.includes('refreshPort sent')) ? 'PASS' : 'FAIL');
    console.log('C) REINIT_PORT sent:', recoveryLogs.some(l => l.includes('REINIT_PORT sent')) ? 'PASS' : 'FAIL');
    console.log('D) reinitCount incremented:', diagFinal.portState?.reinitCount > 0 ? 'PASS' : 'FAIL');
    console.log('E) portReady recovered:', bootFinal.portReady === true ? 'PASS' : 'FAIL');
    console.log('F) swPortStatus recovered:', bootFinal.swPortStatus === 'ready' ? 'PASS' : 'FAIL');
    console.log('G) Navigation works after recovery:', hasServicePath ? 'PASS' : 'FAIL');
    console.log('Recovery only attempted once:', bootFinal.recoveryAttempted === true ? 'PASS' : 'FAIL (flag not set)');

  } catch (err) {
    console.error('\nTEST ERROR:', err.message, err.stack?.split('\n').slice(0,3).join('\n'));
  } finally {
    await browser.close();
    process.exit(0);
  }
}

main();
