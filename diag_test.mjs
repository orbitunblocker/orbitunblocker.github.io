import { chromium } from 'playwright';
import { setTimeout as sleep } from 'timers/promises';

const URL = 'http://localhost:8080';

async function getSWDiag(page) {
  return page.evaluate(async () => {
    const results = [];
    function log(x) { results.push(x); }
    
    if (!('serviceWorker' in navigator)) return { error: 'no-sw', log: results };
    log('has-sw');
    
    // First check controller
    const controller = navigator.serviceWorker.controller;
    log('controller: ' + (controller ? controller.constructor.name || 'yes' : 'null'));
    
    const reg = await navigator.serviceWorker.ready;
    log('sw-ready: active=' + (reg.active ? 'yes' : 'no') + ' installing=' + (reg.installing ? 'yes' : 'no') + ' waiting=' + (reg.waiting ? 'yes' : 'no'));
    
    if (!reg.active) return { error: 'no-active', log: results };
    
    const { port1, port2 } = new MessageChannel();
    log('channel-created');
    
    const response = await new Promise((resolve) => {
      let resolved = false;
      port1.onmessage = e => { if (!resolved) { resolved = true; resolve(e.data); } };
      setTimeout(() => { if (!resolved) { resolved = true; resolve({ error: 'timeout', log: results }); } }, 3000);
      try {
        reg.active.postMessage({ type: 'GET_DIAG' }, [port2]);
        log('postMessage-sent');
      } catch(e) {
        if (!resolved) { resolved = true; resolve({ error: 'postMessage-failed: ' + e.message, log: results }); }
      }
    });
    
    if (response && response.diagLog) {
      // returned diag response
    }
    return response;
  }).catch(e => ({ error: 'exception: ' + e.message }));
}

async function main() {
  console.log('[TEST] Launching browser...');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Collect all logs
  const allLogs = [];
  page.on('console', msg => allLogs.push(`[PAGE ${msg.type()}] ${msg.text()}`));

  console.log('[TEST] Navigating to', URL);
  await page.goto(URL, { waitUntil: 'load', timeout: 15000 });
  console.log('[TEST] Page loaded. Page title:', await page.title());
  await sleep(2000);

  // Poll diagnostics for 20 seconds
  for (let tick = 0; tick < 40; tick++) {
    await sleep(500);
    const diag = await getSWDiag(page);
    if (diag && diag.type === 'DIAG_RESPONSE') {
      const ps = diag.portState;
      const entries = diag.diagLog || [];
      console.log(`[TEST] t=${(tick+1)*500}ms status=${ps.status} portIsNull=${ps.portIsNull} reinit=${ps.reinitCount} diagEntries=${entries.length} portId=${diag.portIdentity}`);
      
      // Print ALL diag entries on first successful poll
      if (tick === 0 || tick % 10 === 0) {
        for (const e of entries) {
          console.log(`  [${e.context}] ${e.msg}${e.extra ? ' ' + JSON.stringify(e.extra) : ''}`);
        }
      }
      
      if (ps.status === 'ready') {
        console.log('[TEST] *** PORT READY ***');
        break;
      }
    } else {
      console.log(`[TEST] t=${(tick+1)*500}ms diag type:`, diag ? (diag.type || diag.error || typeof diag) : 'null', diag && diag.log ? diag.log.join(',') : '');
    }
  }

  // Final diagnostic dump
  console.log('\n[TEST] === FINAL DIAG ===');
  const finalDiag = await getSWDiag(page);
  if (finalDiag && finalDiag.diagLog) {
    console.log(JSON.stringify(finalDiag.diagLog, null, 2));
  }
  if (finalDiag && finalDiag.portState) {
    console.log('\n[TEST] PortState:', JSON.stringify(finalDiag.portState));
  }

  console.log('\n[TEST] === PAGE LOGS (last 30) ===');
  allLogs.slice(-30).forEach(l => console.log(l));

  await browser.close();
  console.log('[TEST] Done');
}

main().catch(err => { console.error('[TEST] FATAL:', err); process.exit(1); });
