// Evidence collection: trace every request during a Google navigation + search
// Uses CDP Network domain for full request/response capture — no source file changes

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import fs from 'fs';

const ORBIT_DIR = 'C:\\Users\\abeni\\Downloads\\orbit';
const LOG_FILE = ORBIT_DIR + '\\_trace_output.txt';
const RESULT_FILE = ORBIT_DIR + '\\_trace_results.json';

function log(msg) { const line = `[${Date.now()}] ${msg}`; console.log(line); fs.appendFileSync(LOG_FILE, line + '\n'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

fs.writeFileSync(LOG_FILE, '');
log('=== EVIDENCE COLLECTION: Google Search Navigation Trace ===');

// Start server
const server = spawn('node', ['server.js'], { cwd: ORBIT_DIR, stdio: 'pipe' });
server.stderr.on('data', () => {});
await sleep(3000);
log('Server started');

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
});

const page = await browser.newPage();

// ==================== CDP NETWORK CAPTURE ====================
const cdp = await page.target().createCDPSession();
await cdp.send('Network.enable');

const requests = {};
const responses = {};
const failures = [];
const swRequests = [];
const bareRequests = [];
const svcRequests = [];

cdp.on('Network.requestWillBeSent', p => {
  requests[p.requestId] = {
    url: p.request.url,
    type: p.type || 'Other',
    method: p.request.method,
    timestamp: p.timestamp,
    documentURL: p.documentURL
  };
});

cdp.on('Network.responseReceived', p => {
  const r = p.response;
  const req = requests[p.requestId];
  if (!req) return;
  const e = { url: r.url, status: r.status, type: req.type, fromSW: r.fromServiceWorker, fromCache: !!(r.fromDiskCache || r.fromPrefetchCache), mimeType: r.mimeType };
  responses[p.requestId] = e;
  if (r.fromServiceWorker) swRequests.push(e);
  if (r.url.includes('/bare/')) bareRequests.push(e);
  if (r.url.includes('/service/')) svcRequests.push(e);
  log(`RESP ${r.status} ${r.fromServiceWorker ? '[SW]' : '    '} ${r.fromDiskCache ? '[CACHE]' : '      '} ${(req.type || '').padEnd(10)} ${r.url.substring(0, 120)}`);
});

cdp.on('Network.loadingFailed', p => {
  const req = requests[p.requestId];
  failures.push({ url: req ? req.url : '?', type: req ? req.type : '?', errorText: p.errorText, blockedReason: p.blockedReason || 'none', canceled: p.canceled });
  log(`FAIL ${(req ? req.type : '?').padEnd(10)} ${(req ? req.url.substring(0, 120) : '?')}  err=${p.errorText}`);
});

// ==================== CONSOLE CAPTURE ====================
const consoleErrors = [];
page.on('console', msg => {
  const t = msg.text();
  if (msg.type() === 'error' || t.includes('ERROR') || t.includes('RangeError') || t.includes('status 0')) {
    consoleErrors.push({ type: msg.type(), text: t.substring(0, 300) });
    log(`CONSOLE_ERR ${t.substring(0, 300)}`);
  }
  if (t.includes('[BOOT]') || t.includes('[PORT_SYNC]') || t.includes('[TRACE]') || t.includes('[UV-ROUTE]') || t.includes('[BOOT-WORKER]') || t.includes('[BOOT-SW]')) {
    log(`CONSOLE ${t.substring(0, 300)}`);
  }
});
page.on('pageerror', err => { log(`PAGE_ERROR ${err.message.substring(0, 300)}`); });

// ==================== STEP 1: Load Orbit ====================
log('=== STEP 1: Load Orbit homepage ===');
await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 15000 });
await sleep(5000);

// Collect boot diagnostics
const bootDiag = await page.evaluate(() => {
  const bs = window.__UV_BOOT_STATUS__ || {};
  const sw = navigator.serviceWorker;
  return {
    bootStatus: JSON.parse(JSON.stringify(bs)),
    swController: sw.controller ? { state: sw.controller.state, scriptURL: sw.controller.scriptURL, scope: sw.controller.scope } : null,
    hasVoltraBrowser: typeof window.VoltraBrowser !== 'undefined',
    hasLoadSection: typeof window.loadSection !== 'undefined',
    hasLoadBrowserPage: typeof window.loadBrowserPage !== 'undefined',
    windowKeys: Object.keys(window).filter(k => k.startsWith('load') || k.startsWith('Voltra') || k.startsWith('show') || k.startsWith('open')).join(', ')
  };
}).catch(() => ({}));
log(`Boot diagnostics: ${JSON.stringify(bootDiag, null, 2)}`);

// ==================== STEP 2: Open browser ====================
log('=== STEP 2: Open browser section ===');

// Method 1: Try loadSection
let browserOpened = await page.evaluate(() => {
  if (typeof loadSection === 'function') {
    loadSection('browser');
    return 'loadSection';
  }
  if (typeof loadBrowserPage === 'function') {
    loadBrowserPage();
    return 'loadBrowserPage';
  }
  return 'neither-found';
}).catch(() => 'evaluate-error');
log(`Browser open method: ${browserOpened}`);

if (browserOpened === 'neither-found' || browserOpened === 'evaluate-error') {
  // Try finding a button that opens the browser
  const btnResult = await page.evaluate(() => {
    // Look for any "Browse" or "Browser" button
    const allBtns = document.querySelectorAll('button, a, [role="button"]');
    for (const btn of allBtns) {
      const text = (btn.textContent || '').toLowerCase();
      if (text.includes('browse') || text.includes('browser')) {
        btn.click();
        return 'clicked-' + text;
      }
    }
    return 'no-browser-button';
  }).catch(() => 'btn-evaluate-error');
  log(`Button search: ${btnResult}`);
}

await sleep(4000);

// Check what's on the page now
const pageState = await page.evaluate(() => {
  const mount = document.getElementById('browserMount');
  const container = document.getElementById('browserContainer');
  const iframes = Array.from(document.querySelectorAll('iframe')).map(f => ({ id: f.id, src: (f.src || '').substring(0, 150) }));
  return {
    mountExists: !!mount,
    containerExists: !!container,
    iframeCount: iframes.length,
    iframes: iframes,
    bodyClass: document.body.className,
    heroDisplay: document.querySelector('.hero-section')?.style?.display || 'not-checked'
  };
}).catch(() => ({}));
log(`Page state after browser open: ${JSON.stringify(pageState)}`);

// ==================== STEP 3: Navigate to Google ====================
log('=== STEP 3: Navigate to Google ===');

if (pageState.iframeCount === 0) {
  log('WARN: No iframe exists — VoltraBrowser.navigate() may have no effect');
}

const navResult = await page.evaluate(() => {
  if (window.VoltraBrowser && typeof window.VoltraBrowser.navigate === 'function') {
    window.VoltraBrowser.navigate('https://www.google.com');
    return 'navigate-called';
  }
  // Fallback: set iframe src directly
  const iframes = document.querySelectorAll('iframe');
  if (iframes.length > 0) {
    iframes[0].removeAttribute('srcdoc');
    iframes[0].src = '/service/' + encodeURIComponent('https://www.google.com/');
    return 'direct-iframe-set';
  }
  return 'no-navigation-method';
}).catch(() => 'evaluate-error');
log(`Navigation method: ${navResult}`);

await sleep(8000);

// ==================== STEP 4: Check state after Google navigation ====================
log('=== STEP 4: Check post-navigation state ===');

const postNav = await page.evaluate(() => {
  const items = [];
  document.querySelectorAll('iframe').forEach(f => {
    const entry = { id: f.id, src: (f.src || '').substring(0, 180), srcdoc_len: (f.getAttribute('srcdoc') || '').length };
    try {
      const d = f.contentDocument || f.contentWindow?.document;
      if (d) {
        entry.title = d.title;
        entry.bodyLen = (d.body?.innerText || '').length;
        entry.readyState = d.readyState;
        entry.url = d.location?.href || '';
        entry.isErrorPage = (d.body?.innerHTML || '').includes('Error processing') || (d.body?.innerHTML || '').includes('Failed to load');
        if (entry.isErrorPage) {
          entry.errorTitle = d.getElementById('errorTitle')?.textContent || '';
          entry.errorMessage = d.getElementById('errorMessage')?.textContent || '';
          entry.fetchedURL = d.getElementById('fetchedURL')?.textContent || '';
          entry.errorTrace = d.getElementById('errorTrace')?.textContent || '';
        }
      } else {
        entry.docAccess = 'denied';
      }
    } catch(e) { entry.docAccess = e.message.substring(0, 100); }
    items.push(entry);
  });
  return items;
}).catch(() => []);
log(`Post-navigation state: ${JSON.stringify(postNav, null, 2)}`);

// ==================== STEP 5: Try search if Google loaded ====================
log('=== STEP 5: Attempt Google search ===');

const googleIframe = postNav.find(f => f.title === 'Google' || (f.src && f.src.includes('google')));
if (googleIframe) {
  log('Google iframe found — attempting search');
  await sleep(2000);
  
  const searchState = await page.evaluate(() => {
    const f = document.querySelector('iframe');
    if (!f) return { error: 'no iframe' };
    try {
      const d = f.contentDocument || f.contentWindow?.document;
      if (!d) return { error: 'no doc' };
      const input = d.querySelector('input[name="q"], textarea[name="q"]');
      if (!input) return { error: 'no search input', bodyPreview: (d.body?.innerText || '').substring(0, 500) };
      input.value = 'web proxy test';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const form = input.closest('form');
      if (form) { form.submit(); return { submitted: true, method: 'form' }; }
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      return { submitted: true, method: 'enter' };
    } catch(e) { return { error: e.message }; }
  }).catch(() => ({}));
  log(`Search state: ${JSON.stringify(searchState)}`);
  
  if (searchState.submitted) {
    await sleep(10000);
    
    const resultState = await page.evaluate(() => {
      const f = document.querySelector('iframe');
      if (!f) return { error: 'no iframe after search' };
      try {
        const d = f.contentDocument || f.contentWindow?.document;
        if (!d) return { error: 'no doc after search' };
        return {
          title: d.title,
          bodyLen: (d.body?.innerText || '').length,
          url: d.location?.href || '',
          readyState: d.readyState,
          isErrorPage: (d.body?.innerHTML || '').includes('Error processing') || (d.body?.innerHTML || '').includes('Failed to load'),
          isWhitePage: (d.body?.innerHTML || '').trim() === '' || (d.body?.innerText || '').trim() === '',
          bodyPreview: (d.body?.innerText || '').substring(0, 500)
        };
      } catch(e) { return { error: e.message }; }
    }).catch(() => ({}));
    log(`Search result state: ${JSON.stringify(resultState)}`);
  }
} else {
  log('Google not detected in iframe — checking for error page...');
  const errPage = postNav.find(f => f.isErrorPage);
  if (errPage) {
    log(`UV ERROR PAGE: title="${errPage.errorTitle}" message="${errPage.errorMessage}" url="${errPage.fetchedURL}" trace="${errPage.errorTrace}"`);
  }
}

// ==================== STEP 6: Try UV Reload ====================
log('=== STEP 6: Attempt UV Reload ===');
const reloadResult = await page.evaluate(() => {
  const f = document.querySelector('iframe');
  if (!f) return 'no-iframe';
  try {
    const d = f.contentDocument || f.contentWindow?.document;
    if (!d) return 'no-doc-access';
    const btn = d.getElementById('reload');
    if (btn) { btn.click(); return 'reload-clicked'; }
    return 'no-reload-btn';
  } catch(e) { return 'error: ' + e.message; }
}).catch(() => 'evaluate-error');
log(`Reload result: ${reloadResult}`);

if (reloadResult === 'reload-clicked') {
  await sleep(8000);
  const postReload = await page.evaluate(() => {
    const f = document.querySelector('iframe');
    if (!f) return { error: 'no iframe' };
    try {
      const d = f.contentDocument || f.contentWindow?.document;
      if (!d) return { error: 'no doc' };
      return {
        title: d.title,
        bodyLen: (d.body?.innerText || '').length,
        url: d.location?.href || '',
        isErrorPage: (d.body?.innerHTML || '').includes('Error processing'),
        bodyPreview: (d.body?.innerText || '').substring(0, 500)
      };
    } catch(e) { return { error: e.message }; }
  }).catch(() => ({}));
  log(`Post-reload state: ${JSON.stringify(postReload)}`);
}

// ==================== REPORT ====================
log('\n========== EVIDENCE REPORT ===========');

// 1. Stats
const allFailed = failures;
const totalReqs = Object.keys(requests).length;
const totalResps = Object.keys(responses).length;
const swHandled = swRequests.length;
const cached = Object.values(responses).filter(r => r.fromCache).length;
const bareCount = bareRequests.length;
const svcCount = svcRequests.length;

log(`Total requests: ${totalReqs}, responses: ${totalResps}, failed: ${allFailed.length}`);
log(`SW handled: ${swHandled}, Bare: ${bareCount}, Service: ${svcCount}, Cached: ${cached}`);

// 2. Chronological failures
log('\n=== FAILURES (chronological) ===');
allFailed.forEach((f, i) => {
  log(`#${i+1} [${f.type}] ${f.errorText} blocked=${f.blockedReason} — ${f.url.substring(0, 130)}`);
});

// 3. First request that failed
if (allFailed.length > 0) {
  const first = allFailed[0];
  log(`\nFIRST FAILURE: #1 [${first.type}] ${first.url.substring(0, 130)}`);
  log(`  error: ${first.errorText}`);
  log(`  blocked: ${first.blockedReason}`);
  // Check if it's a subresource or the main doc
  log(`  This is a ${first.type} request`);
}

// 4. SW handled requests
log('\n=== ALL SW-HANDLED ===');
swRequests.forEach(r => log(`  ${r.status} ${r.type.padEnd(10)} ${r.url.substring(0, 130)}`));

// 5. Bare server requests  
log('\n=== ALL BARE REQUESTS ===');
bareRequests.forEach(r => log(`  ${r.status} ${r.type.padEnd(10)} ${r.url.substring(0, 130)}`));

// 6. Service URL requests
log('\n=== ALL SERVICE (/) REQUESTS ===');
svcRequests.forEach(r => log(`  ${r.status} ${r.type.padEnd(10)} fromSW=${r.fromSW} cache=${r.fromCache} ${r.url.substring(0, 130)}`));

// 7. Status 0 check
log('\n=== STATUS-0/RANGEERROR CHECK ===');
const badStatus = Object.values(responses).filter(r => r.status === 0 || r.status < 100 || r.status >= 600);
log(badStatus.length === 0 ? 'PASS: No invalid status codes found' : `WARN: ${badStatus.length} invalid statuses`);
badStatus.forEach(r => log(`  ${r.status} ${r.url.substring(0, 130)}`));

// 8. Console errors
log('\n=== CONSOLE ERRORS ===');
consoleErrors.slice(0, 20).forEach(e => log(`  [${e.type}] ${e.text.substring(0, 250)}`));

log('\n========== END OF REPORT ===========');

// Save results
fs.writeFileSync(RESULT_FILE, JSON.stringify({
  requests: Object.keys(requests).length,
  responses: Object.keys(responses).length,
  failures: allFailed,
  swHandled: swRequests,
  bareRequests: bareRequests,
  svcRequests: svcRequests,
  consoleErrors: consoleErrors.slice(0, 30),
  postNavState: postNav
}, null, 2));

console.log('\n========= CONSOLE SUMMARY =========');
console.log(`Requests: ${totalReqs}, Responses: ${totalResps}, Failures: ${allFailed.length}`);
console.log(`SW: ${swHandled}, Bare: ${bareCount}, SVC: ${svcCount}, Cached: ${cached}`);
console.log(`Status-0/RangeError: ${badStatus.length > 0 ? 'DETECTED' : 'NONE'}`);
if (allFailed.length > 0) {
  console.log(`\nFirst failure: [${allFailed[0].type}] ${allFailed[0].errorText}`);
  console.log(`  ${allFailed[0].url.substring(0, 120)}`);
}
console.log(`\nFull trace: ${LOG_FILE}`);
console.log(`Results JSON: ${RESULT_FILE}`);

await browser.close();
server.kill();
log('Done');
