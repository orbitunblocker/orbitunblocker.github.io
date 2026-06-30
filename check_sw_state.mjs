import { chromium } from 'playwright';

const URL = 'http://localhost:8080';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  
  // Collect console logs
  page.on('console', msg => console.log(`[PAGE ${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.log(`[PAGE-ERR] ${err}`));
  
  console.log('Navigating...');
  await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
  console.log('Page loaded. Title:', await page.title());
  await new Promise(r => setTimeout(r, 3000));
  
  // Check basic state
  const state = await page.evaluate(() => {
    const result = {};
    if (!('serviceWorker' in navigator)) {
      result.error = 'No SW support';
      return result;
    }
    result.controller = navigator.serviceWorker.controller ? 'yes' : 'no';
    result.controllerUrl = navigator.serviceWorker.controller?.scriptURL || null;
    result.register = 'attempting';
    return result;
  });
  console.log('Initial state:', JSON.stringify(state));
  
  // Wait for SW to be active
  const readyState = await page.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      return {
        active: reg.active ? 'yes' : 'no',
        activeUrl: reg.active?.scriptURL || null,
        installing: reg.installing ? 'yes' : 'no',
        waiting: reg.waiting ? 'yes' : 'no',
      };
    } catch(e) {
      return { error: e.message };
    }
  });
  console.log('SW ready state:', JSON.stringify(readyState));
  
  // Try sending GET_DIAG with timeout
  const diagResult = await page.evaluate(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sw = reg.active;
      if (!sw) return { error: 'no-active' };
      
      return await new Promise((resolve) => {
        const { port1, port2 } = new MessageChannel();
        let done = false;
        
        port1.onmessage = e => { if (!done) { done = true; resolve({ status: 'ok', data: e.data }); } };
        port1.onmessageerror = e => { if (!done) { done = true; resolve({ error: 'onmessageerror' }); } };
        
        setTimeout(() => { if (!done) { done = true; resolve({ error: 'timeout' }); } }, 5000);
        
        try {
          sw.postMessage({ type: 'GET_DIAG' }, [port2]);
        } catch(e) {
          if (!done) { done = true; resolve({ error: 'postMessage-failed: ' + e.message }); }
        }
      });
    } catch(e) {
      return { error: 'sw-error: ' + e.message };
    }
  });
  
  if (diagResult.status === 'ok') {
    const d = diagResult.data;
    console.log('GET_DIAG response type:', d.type);
    if (d.portState) console.log('  portState:', JSON.stringify(d.portState));
    if (d.portIdentity) console.log('  portIdentity:', d.portIdentity);
    if (d.diagLog && d.diagLog.length > 0) {
      console.log('  diagLog entries:');
      d.diagLog.forEach(e => console.log(`    [${e.context}] ${e.msg}${e.extra ? ' ' + JSON.stringify(e.extra) : ''}`));
    }
  } else {
    console.log('GET_DIAG failed:', JSON.stringify(diagResult));
  }
  
  // Also check UV boot status
  const bootStatus = await page.evaluate(() => {
    try { return window.__UV_BOOT_STATUS__; } catch(e) { return 'error'; }
  });
  console.log('__UV_BOOT_STATUS__:', JSON.stringify(bootStatus));
  
  await browser.close();
  console.log('Done');
}

main().catch(err => { console.error('FATAL:', err.message); process.exit(1); });
