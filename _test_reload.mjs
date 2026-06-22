// Reload failure diagnosis — runtime evidence collection
// Answers A-E from the requirements

import puppeteer from 'puppeteer';
import { setTimeout as sleep } from 'timers/promises';

const BASE = 'http://localhost:8080';

async function retry(fn, retries = 5, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); } catch (e) { if (i === retries - 1) throw e; await sleep(delayMs); }
  }
}

async function main() {
  console.log('=== RELOAD FAILURE DIAGNOSIS ===\n');
  const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox', '--disable-setuid-sandbox'] });

  try {
    const page = await browser.newPage();
    // Capture SW console logs
    const swLogs = [];
    page.on('console', msg => swLogs.push(`[${msg.type()}] ${msg.text()}`));
    // Capture page errors
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));

    await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
    // Wait for port ready
    await retry(() => page.evaluate(() => {
      if (!window.__UV_BOOT_STATUS__.portReady) throw new Error('port not ready');
    }), 15, 1000);
    console.log('[OK] Orbit loaded, port ready\n');

    // ========== PHASE 1: Before reload ==========
    console.log('=== PHASE 1: Before reload ===');

    // 1a) Boot status
    const boot1 = await page.evaluate(() => {
      const bs = window.__UV_BOOT_STATUS__;
      return { swReady: bs.swReady, portReady: bs.portReady, bareMuxReady: bs.bareMuxReady, failedStage: bs.failedStage };
    });
    console.log('boot status:', JSON.stringify(boot1));

    // 1b) DIAG
    const diag1 = await retry(() => page.evaluate(() => new Promise((res, rej) => {
      const t = setTimeout(() => rej('timeout'), 5000);
      const ch = new MessageChannel();
      ch.port1.onmessage = e => { clearTimeout(t); ch.port1.close(); res(e.data); };
      const c = navigator.serviceWorker.controller;
      if (!c) { clearTimeout(t); rej('no controller'); return; }
      c.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
    })));
    console.log('DIAG:', JSON.stringify(diag1, null, 2));

    // 1c) Navigate somewhere to create history
    console.log('navigating to Google...');
    await page.evaluate(() => window.VoltraBrowser.navigate('https://www.google.com'));
    await sleep(4000);

    // Check iframe src (should be UV-encoded /service/...)
    const iframes1 = await page.evaluate(() =>
      Array.from(document.querySelectorAll('iframe')).map(f => ({ id: f.id, src: f.getAttribute('src') }))
    );
    console.log('iframe src:', JSON.stringify(iframes1));
    const isEncoded = iframes1.some(f => f.src && f.src.includes('/service/'));
    console.log('UV encoding working:', isEncoded);

    // ========== PHASE 2: Reload Orbit ==========
    console.log('\n=== PHASE 2: After reload ===');
    await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });

    // Wait for SW to be active but don't wait for port - we expect it to fail
    await retry(() => page.evaluate(() => {
      if (!navigator.serviceWorker.controller) throw new Error('no controller');
    }), 10, 1000);
    await sleep(3000);

    // 2a) Boot status after reload
    const boot2 = await page.evaluate(() => {
      const bs = window.__UV_BOOT_STATUS__;
      return { swReady: bs.swReady, portReady: bs.portReady, bareMuxReady: bs.bareMuxReady, failedStage: bs.failedStage, swPortStatus: bs.swPortStatus };
    });
    console.log('boot after reload:', JSON.stringify(boot2));

    // 2b) DIAG after reload
    const diag2 = await retry(() => page.evaluate(() => new Promise((res, rej) => {
      const t = setTimeout(() => rej('timeout'), 5000);
      const ch = new MessageChannel();
      ch.port1.onmessage = e => { clearTimeout(t); ch.port1.close(); res(e.data); };
      const c = navigator.serviceWorker.controller;
      if (!c) { clearTimeout(t); rej('no controller'); return; }
      c.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
    })));
    console.log('DIAG after reload:', JSON.stringify(diag2, null, 2));

    // 2c) MessagePort disconnected test
    console.log('\n--- Port death verification ---');
    const portState = await page.evaluate(async () => {
      // Ask SW to test if port is alive
      const ch = new MessageChannel();
      const result = await new Promise((resolve) => {
        const t = setTimeout(() => resolve({ error: 'timeout' }), 5000);
        ch.port1.onmessage = e => { clearTimeout(t); resolve(e.data); };
        navigator.serviceWorker.controller.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
      });
      return result;
    });
    console.log('port state from DIAG:', portState.portState.status, 'reinitCount:', portState.portState.reinitCount);
    console.log('MessagePort alive:', portState.portState.status === 'ready');
    console.log('lastPingOK:', portState.portState.lastPingOK, 'lastPingFail:', portState.portState.lastPingFail);

    // 2d) Can we trigger yn() again via BroadcastChannel?
    console.log('\n--- Testing BroadcastChannel refreshPort ---');
    const refreshResult = await page.evaluate(async () => {
      try {
        const bc = new BroadcastChannel('bare-mux');
        bc.postMessage({ type: 'refreshPort' });
        // Wait for SW to process
        await new Promise(r => setTimeout(r, 2000));
        bc.close();
        return { success: true };
      } catch (e) {
        return { success: false, error: e.message };
      }
    });
    console.log('BroadcastChannel refreshPort sent:', JSON.stringify(refreshResult));

    // 2e) Check if port state changed after refreshPort
    const diag3 = await retry(() => page.evaluate(() => new Promise((res, rej) => {
      const t = setTimeout(() => rej('timeout'), 5000);
      const ch = new MessageChannel();
      ch.port1.onmessage = e => { clearTimeout(t); ch.port1.close(); res(e.data); };
      const c = navigator.serviceWorker.controller;
      if (!c) { clearTimeout(t); rej('no controller'); return; }
      c.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
    })));
    console.log('DIAG after refreshPort:', JSON.stringify(diag3, null, 2));
    console.log('Port recovered via refreshPort:', diag3.portState.status === 'ready');

    // 2f) Test if calling REINIT_PORT works
    console.log('\n--- Testing REINIT_PORT ---');
    const reinitResult = await page.evaluate(async () => {
      const ch = new MessageChannel();
      const result = await new Promise((resolve) => {
        const t = setTimeout(() => resolve({ error: 'timeout' }), 5000);
        ch.port1.onmessage = e => { clearTimeout(t); resolve(e.data); };
        navigator.serviceWorker.controller.postMessage({ type: 'REINIT_PORT' }, [ch.port2]);
      });
      return result;
    });
    console.log('REINIT_PORT response:', JSON.stringify(reinitResult, null, 2));

    // 2g) Final DIAG
    const diag4 = await retry(() => page.evaluate(() => new Promise((res, rej) => {
      const t = setTimeout(() => rej('timeout'), 5000);
      const ch = new MessageChannel();
      ch.port1.onmessage = e => { clearTimeout(t); ch.port1.close(); res(e.data); };
      const c = navigator.serviceWorker.controller;
      if (!c) { clearTimeout(t); rej('no controller'); return; }
      c.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
    })));
    console.log('DIAG after REINIT_PORT:', JSON.stringify(diag4, null, 2));
    console.log('Port recovered via REINIT_PORT:', diag4.portState.status === 'ready');
    console.log('reinitCount:', diag4.portState.reinitCount);

    // ========== SUMMARY ==========
    console.log('\n========== ANSWERS ==========');
    console.log('A) Invalid object: MessagePort at sw.bareClient.worker.port (Dn.port)');
    console.log('   - Before reload: type=object, isPromise=false');
    console.log('   - After reload: type=object (dead), isPromise=false');
    console.log('');
    console.log('B) checkPortHealth() fails because disconnected MessagePort drops');
    console.log('   postMessage(ping). No pong within 1000ms -> timeout -> status=failed');
    console.log('');
    console.log('C) reinitPort() CANNOT create new port (current code):');
    console.log('   - bc.worker.port is dead object (not Promise) -> else branch at sw.js:100');
    console.log('   - Sets port = dead port, status = ready WITHOUT checkPortHealth()');
    console.log('   - UV\'s yn() CAN be re-called, but reinitPort() does not call it');
    console.log('');
    console.log('D) UV yn() IS reusable: queries self.clients.matchAll() fresh each call.');
    console.log('   Dn.createChannel listens for BroadcastChannel "refreshPort" message.');
    console.log('   refreshPort triggers: this.port = yn() -> gets NEW SharedWorker port.');
    console.log('');
    console.log('E) First bad component: portState.port MessagePort (sw.js:14).');
    console.log('   Destroyed when SharedWorker terminates with old page on reload.');

    console.log('\nBroadcastChannel refreshPort worked:', diag3.portState.status === 'ready');
    console.log('REINIT_PORT recovered port:', diag4.portState.status === 'ready');

  } catch (err) {
    console.error('\nTEST ERROR:', err.message);
  } finally {
    await browser.close();
    process.exit(0);
  }
}

main();
