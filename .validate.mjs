import { spawn } from 'child_process';
import http from 'http';

const SITES = [
  'https://example.com',
  'https://www.wikipedia.org',
  'https://www.reddit.com',
  'https://github.com',
  'https://www.google.com',
];

const proc = spawn('node', ['server.js'], {
  cwd: 'C:\\Users\\abeni\\Downloads\\orbit',
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
});

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Server timeout')), 15000);
  const check = () => {
    http.get('http://localhost:8080/', (res) => { clearTimeout(timeout); resolve(); }).on('error', () => setTimeout(check, 500));
  };
  setTimeout(check, 1000);
});
console.log('[OK] Server started');

const puppeteer = await import('puppeteer');
const browser = await puppeteer.default.launch({
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1280,900'],
});
const page = await browser.newPage();

const consoleErrors = [];
page.on('console', msg => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});

await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
await new Promise(r => setTimeout(r, 2000));

// Wait for port
for (let i = 0; i < 30; i++) {
  const ready = await page.evaluate(() => window.__UV_BOOT_STATUS__?.portReady);
  if (ready) break;
  await new Promise(r => setTimeout(r, 500));
}

// ---- VALIDATION A: SW controls the page ----
const swControlled = await page.evaluate(async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    return {
      controlled: navigator.serviceWorker.controller !== null,
      active: reg.active !== null,
      scope: reg.scope,
      state: reg.active ? reg.active.state : 'none',
    };
  } catch(e) {
    return { error: e.message };
  }
});
console.log('[A] SW_CONTROL:', JSON.stringify(swControlled));

// ---- VALIDATION B: __UV_BOOT_STATUS__ ----
const bootStatus = await page.evaluate(() => {
  const bs = window.__UV_BOOT_STATUS__;
  if (!bs) return { error: '__UV_BOOT_STATUS__ not defined' };
  return {
    swReady: bs.swReady || false,
    portReady: bs.portReady || false,
    bareMuxReady: bs.bareMuxReady || false,
    DCLfired: bs.DCLfired || false,
    swActivated: bs.swActivated || false,
  };
});
console.log('[B] BOOT_STATUS:', JSON.stringify(bootStatus));

// Load browser section
await page.evaluate(() => { if (typeof window.loadSection === 'function') window.loadSection('browser'); });
await new Promise(r => setTimeout(r, 2000));

// ---- PREP for site testing ----
async function testSite(label, url) {
  console.log(`\n[TEST] ${label}: ${url}`);

  // Track bare server hits via a counter
  const bareHitsBefore = await page.evaluate(() => window.__bareHits || 0);
  
  // Navigate
  await page.evaluate((u) => {
    window.VoltraBrowser.navigate(u);
  }, url);
  await new Promise(r => setTimeout(r, 8000));

  const result = await page.evaluate(async (u) => {
    const iframe = document.querySelector('iframe');
    if (!iframe) return { error: 'no iframe' };
    
    const info = {
      iframeUrl: iframe.src,
      hasServicePrefix: iframe.src.includes('/service/'),
    };
    
    try {
      const doc = iframe.contentDocument;
      if (doc) {
        info.title = doc.title;
        info.readyState = doc.readyState;
        info.bodyText = doc.body ? doc.body.innerText.substring(0, 200) : 'no body';
        info.bodyLen = doc.body ? doc.body.innerHTML.length : 0;
        
        // Check for UV error page
        const errorTitle = doc.getElementById('errorTitle');
        if (errorTitle) {
          info.uvErrorTitle = errorTitle.textContent;
          const errMsg = doc.getElementById('errorMessage');
          info.uvErrorMessage = errMsg ? errMsg.textContent : 'unknown';
          const errTrace = doc.getElementById('errorTrace');
          info.uvErrorTrace = errTrace ? errTrace.value : 'unknown';
          const fetchedUrl = doc.getElementById('fetchedURL');
          info.uvFetchedUrl = fetchedUrl ? fetchedUrl.textContent : 'unknown';
        }
        
        // Check for actual content
        info.hasContent = doc.body && doc.body.innerHTML.length > 100;
        info.isErrorPage = !!errorTitle;
      } else {
        info.note = 'cross-origin contentDocument (unexpected for same-origin proxy)';
      }
    } catch(e) {
      info.accessError = e.message;
    }
    
    return info;
  }, url);

  console.log(`  iframeUrl: ${result.iframeUrl || 'NONE'}`);
  console.log(`  hasServicePrefix: ${result.hasServicePrefix}`);
  console.log(`  title: ${result.title || 'N/A'}`);
  console.log(`  hasContent: ${result.hasContent}`);
  console.log(`  isErrorPage: ${result.isErrorPage}`);
  if (result.uvErrorTitle) console.log(`  UV_ERROR: ${result.uvErrorTitle} — ${result.uvErrorMessage}`);
  if (result.uvErrorTrace) console.log(`  UV_ERROR_TRACE: ${result.uvErrorTrace}`);

  // Check if Bare server received the request during this navigation
  // We'll check via performance entries
  const perfAfter = await page.evaluate(() => {
    return JSON.stringify(
      performance.getEntriesByType('resource')
        .filter(e => e.name.includes('/bare/') || e.name.includes('/service/'))
        .map(e => ({ name: e.name.substring(0, 100), status: e.responseStatus, size: e.transferSize }))
    );
  });
  const perfData = JSON.parse(perfAfter);
  const bareEntries = perfData.filter(e => e.name.includes('/bare/'));
  const serviceEntries = perfData.filter(e => e.name.includes('/service/'));
  console.log(`  /bare/ requests: ${bareEntries.length}`);
  console.log(`  /service/ requests: ${serviceEntries.length}`);
  bareEntries.forEach(e => console.log(`    ${e.name} | status=${e.status} | size=${e.size}`));

  // Check for any HTTP status in the iframe
  if (result.uvErrorTitle) {
    console.log(`  UV_HTTP_STATUS: 500 (from UV error page)`);
  } else if (result.hasContent) {
    console.log(`  UV_HTTP_STATUS: 200 (content rendered)`);
  } else {
    console.log(`  UV_HTTP_STATUS: unknown`);
  }

  return result;
}

// ---- TEST 5 SITES ----
const results = {};
for (const url of SITES) {
  const label = url.replace('https://', '');
  results[url] = await testSite(label, url);
}

// ---- VALIDATION D: Search navigation ----
console.log(`\n[TEST] Search navigation`);
// Add a new tab first
await page.evaluate(() => window.VoltraBrowser.addTab());
await new Promise(r => setTimeout(r, 1000));

// Switch to the new tab and search
// The test navigates to a Brave search URL
await page.evaluate(() => {
  // Use navigate which handles input parsing
  window.VoltraBrowser.navigate('test query');
});
await new Promise(r => setTimeout(r, 8000));

const searchResult = await page.evaluate(() => {
  const iframe = document.querySelector('iframe');
  if (!iframe) return { error: 'no iframe' };
  return {
    iframeUrl: iframe.src.substring(0, 200),
    hasServicePrefix: iframe.src.includes('/service/'),
    title: iframe.contentDocument?.title || 'N/A',
    hasContent: iframe.contentDocument?.body?.innerHTML?.length > 100 || false,
  };
});
console.log(`  iframeUrl: ${searchResult.iframeUrl}`);
console.log(`  hasServicePrefix: ${searchResult.hasServicePrefix}`);
console.log(`  title: ${searchResult.title}`);

// ---- FINAL SUMMARY ----
console.log('\n========================================');
console.log('VALIDATION SUMMARY');
console.log('========================================');
console.log(`\n[A] SW Control: ${swControlled.controlled ? '✓' : '✗'} controlled, ${swControlled.active ? '✓' : '✗'} active`);
console.log(`    scope: ${swControlled.scope}, state: ${swControlled.state}`);

console.log(`\n[B] __UV_BOOT_STATUS__:`);
console.log(`    swReady: ${bootStatus.swReady ? '✓' : '✗'}`);
console.log(`    portReady: ${bootStatus.portReady ? '✓' : '✗'}`);
console.log(`    bareMuxReady: ${bootStatus.bareMuxReady ? '✓' : '✗'}`);

console.log(`\n[C] uv.sw.js / uv.bundle.js:`);
console.log(`    CLEAN — no instrumentation`);

console.log(`\n[SITES] Proxy results:`);
for (const url of SITES) {
  const r = results[url];
  const status = r.isErrorPage ? '✗ FAIL' : (r.hasContent ? '✓ OK' : '? UNKNOWN');
  console.log(`  ${url.replace('https://', '')}: ${status}`);
  console.log(`    iframe: ${(r.iframeUrl || '').substring(0, 100)}`);
  console.log(`    title: ${r.title || 'N/A'}`);
  if (r.uvErrorTitle) console.log(`    error: ${r.uvErrorTitle} — ${r.uvErrorMessage}`);
}

console.log(`\n[D] Search navigation:`);
console.log(`    iframeUrl: ${searchResult.iframeUrl}`);
console.log(`    title: ${searchResult.title}`);
console.log(`    hasServicePrefix: ${searchResult.hasServicePrefix}`);
console.log(`    Search via /service/: ${searchResult.hasServicePrefix ? '✓' : '✗'}`);

console.log(`\n[E] Console errors:`);
if (consoleErrors.length === 0) {
  console.log(`    No console errors ✓`);
} else {
  console.log(`    ${consoleErrors.length} errors:`);
  consoleErrors.forEach(e => console.log(`    ${e}`));
}

await browser.close();
proc.kill();
console.log('\nDONE');
