import { spawn } from 'child_process';
import http from 'http';

const SITES = [
  { label: 'Google',     url: 'https://www.google.com' },
  { label: 'Wikipedia',  url: 'https://www.wikipedia.org' },
  { label: 'Reddit',     url: 'https://www.reddit.com' },
  { label: 'GitHub',     url: 'https://github.com' },
  { label: 'Example',    url: 'https://example.com' },
];

const PORT = 8080;
const CHROME_ARGS = ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1280,900'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// -------- START SERVER --------
console.log('[BOOT] Starting server...');
const serverProc = spawn('node', ['server.js'], {
  cwd: process.cwd(),
  stdio: ['ignore', 'pipe', 'pipe'],
  detached: false,
});
serverProc.stdout.on('data', d => {
  const s = d.toString().trim();
  if (s) process.stdout.write('[SERVER-OUT] ' + s + '\n');
});
serverProc.stderr.on('data', d => {
  const s = d.toString().trim();
  if (s) process.stderr.write('[SERVER-ERR] ' + s + '\n');
});

await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error('Server start timeout')), 30000);
  const check = () => {
    http.get(`http://localhost:${PORT}/`, (res) => { clearTimeout(timeout); resolve(); })
      .on('error', () => setTimeout(check, 500));
  };
  setTimeout(check, 500);
});
console.log('[BOOT] Server running');

// -------- LAUNCH PUPPETEER --------
console.log('[BOOT] Launching headless Chrome...');
const puppeteer = await import('puppeteer');
const browser = await puppeteer.launch({ headless: 'new', args: CHROME_ARGS });
console.log('[BOOT] Chrome launched (pid:', browser.process().pid, ')');

const page = await browser.newPage();

// Collect ALL console messages
const consoleLogs = [];
const pageErrors = [];
const failedRequests = [];

page.on('console', msg => {
  const text = msg.text();
  const type = msg.type();
  consoleLogs.push({ type, text, ts: Date.now() });
  if (type === 'error') process.stdout.write(`[PAGE-ERROR] ${text}\n`);
  else if (text.includes('[UV-ROUTE]') || text.includes('[PORT_SYNC]') || text.includes('[BOOT]'))
    process.stdout.write(`[PAGE-LOG] ${text}\n`);
});
page.on('pageerror', err => { pageErrors.push(err.message); process.stdout.write(`[PAGE-EXCEPTION] ${err.message}\n`); });
page.on('requestfailed', req => {
  failedRequests.push({ url: req.url().substring(0, 200), failure: req.failure() ? req.failure().errorText : 'unknown' });
});
page.on('dialog', async dialog => { process.stdout.write(`[DIALOG] ${dialog.type()}: ${dialog.message()}\n`); await dialog.dismiss().catch(() => {}); });

// -------- NAVIGATE TO ORBIT --------
console.log('\n[NAV] Navigating to http://localhost:8080 ...');
await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(e => console.log('[NAV]', e.message));
await sleep(2000);

// Dismiss intro
const hasIntro = await page.evaluate(() => {
  const btn = document.getElementById('enterButton');
  return btn && btn.offsetParent !== null;
});
if (hasIntro) { await page.click('#enterButton'); await sleep(1500); console.log('[UI] Intro dismissed'); }
else console.log('[UI] No intro (already dismissed)');

// Wait for hero reveal
for (let i = 0; i < 30; i++) {
  const r = await page.evaluate(() => document.querySelector('.hero.reveal') !== null);
  if (r) { console.log('[BOOT] Hero revealed after', (i+1)*0.5, 's'); break; }
  await sleep(500);
}

// Wait for UV boot
for (let i = 0; i < 40; i++) {
  const ready = await page.evaluate(() => window.__UV_BOOT_STATUS__?.portReady === true);
  if (ready) { console.log('[UV] portReady after', (i+1)*0.5, 's'); break; }
  await sleep(500);
}

// Load browser
console.log('[UI] Loading browser...');
await page.evaluate(() => { if (typeof window.loadSection === 'function') window.loadSection('browser'); });
await sleep(2000);

const browserReady = await page.evaluate(() => !!window.VoltraBrowser && !!document.getElementById('browserAddressInput'));
if (!browserReady) {
  await page.evaluate(() => {
    if (window.VoltraBrowser && typeof window.VoltraBrowser.render === 'function') {
      const mount = document.getElementById('browserMount') || document.body;
      window.VoltraBrowser.render(mount);
    }
  });
  await sleep(2000);
}
console.log('[UI] Browser ready:', browserReady);

// -------- INITIAL STATE --------
const initialBootStatus = await page.evaluate(() => {
  const bs = window.__UV_BOOT_STATUS__;
  if (!bs) return { error: 'not defined' };
  return {
    swReady: bs.swReady,
    portReady: bs.portReady,
    bareMuxReady: bs.bareMuxReady,
    failedStage: bs.failedStage,
    swPortStatus: bs.swPortStatus,
  };
});
console.log('[STATE] Initial boot status:', JSON.stringify(initialBootStatus));

const swInfo = await page.evaluate(async () => {
  try {
    const reg = await navigator.serviceWorker.ready;
    return { controlled: navigator.serviceWorker.controller !== null, active: reg.active !== null, scope: reg.scope, state: reg.active ? reg.active.state : 'none' };
  } catch(e) { return { error: e.message }; }
});
console.log('[STATE] SW:', JSON.stringify(swInfo));

// Bare-mux diag
const bareMuxDiag = await page.evaluate(async () => {
  try {
    if (!navigator.serviceWorker.controller) return { connected: false, reason: 'no controller' };
    return await new Promise((resolve) => {
      const mc = new MessageChannel();
      const t = setTimeout(() => resolve({ connected: false, reason: 'timeout' }), 5000);
      mc.port1.onmessage = e => {
        clearTimeout(t); mc.port1.close();
        resolve({ connected: true, data: e.data });
      };
      navigator.serviceWorker.controller.postMessage({ type: 'GET_DIAG' }, [mc.port2]);
    });
  } catch(e) { return { connected: false, error: e.message }; }
});
console.log('[STATE] Bare-mux diag:', JSON.stringify(bareMuxDiag));

// -------- SITE TESTING --------
console.log('\n' + '='.repeat(80));
console.log('SITE PROXY TESTS');
console.log('='.repeat(80));

const siteResults = {};

async function testSite(label, url) {
  console.log(`\n--- ${label}: ${url} ---`);

  const preErrorCount = consoleLogs.filter(l => l.type === 'error').length;
  const preFailedCount = failedRequests.length;

  // Clear performance data
  await page.evaluate(() => performance.clearResourceTimings()).catch(() => {});

  // Navigate via address bar
  const inputSel = '#browserAddressInput';
  const hasInput = await page.$(inputSel);
  if (hasInput) {
    await hasInput.click({ clickCount: 3 }); // select all
    await hasInput.type(url, { delay: 10 });
    await sleep(200);
    await page.keyboard.press('Enter');
  } else {
    // Fallback: use navigate API
    await page.evaluate((u) => { window.VoltraBrowser.navigate(u); }, url);
  }

  // Wait for iframe navigation with better detection
  let pollResult = { loaded: false, src: '' };
  for (let i = 0; i < 50; i++) {
    const r = await page.evaluate(() => {
      const t = window.VoltraBrowser?._browserUI?.tabManager?.getActiveTab();
      if (!t) return { state: 'no-tab' };
      const f = document.getElementById('browserFrame-' + t.id);
      if (!f) return { state: 'no-iframe' };
      const src = f.src || '';
      if (!src || src === 'about:blank' || src === '') return { state: 'blank', src };
      // Check if contentDocument is accessible
      try {
        const doc = f.contentDocument;
        if (doc) {
          const hasContent = doc.body && doc.body.innerHTML && doc.body.innerHTML.length > 50;
          const hasTitle = doc.title && doc.title.length > 0;
          const isReady = doc.readyState === 'complete' || doc.readyState === 'interactive';
          return { state: isReady ? 'ready' : 'loading', src, title: doc.title || '', hasContent, isReady };
        }
        // Cross-origin but src is set
        return { state: 'cross-origin', src };
      } catch(e) {
        // Cross-origin or UV error
        return { state: 'src-set', src };
      }
    });
    if (r && r.src && r.src !== 'about:blank' && (r.state === 'ready' || r.state === 'src-set' || r.state === 'cross-origin')) {
      if (r.state === 'ready' || r.state === 'src-set') {
        pollResult = { loaded: true, src: r.src, title: r.title || '', hasContent: r.hasContent };
        console.log('[NAV] Loaded after', (i+1)*0.5, 's:', r.state, 'src:', r.src.substring(0, 100));
        break;
      }
    }
    await sleep(500);
  }

  // Extra settle time
  await sleep(3000);

  // Detailed iframe inspection
  const iframeInfo = await page.evaluate(() => {
    const result = {
      iframeUrl: '',
      hasServicePrefix: false,
      title: '',
      readyState: '',
      hasContent: false,
      isErrorPage: false,
      bodyPreview: '',
      contentLength: 0,
      uvErrorTitle: null,
      uvErrorMessage: null,
      uvErrorTrace: null,
      error: null,
    };
    const t = window.VoltraBrowser?._browserUI?.tabManager?.getActiveTab();
    if (!t) { result.error = 'no active tab'; return result; }
    const f = document.getElementById('browserFrame-' + t.id);
    if (!f) { result.error = 'no iframe'; return result; }
    result.iframeUrl = f.src || '';
    result.hasServicePrefix = (f.src || '').includes('/service/');
    try {
      const doc = f.contentDocument;
      if (doc) {
        result.title = doc.title || '';
        result.readyState = doc.readyState;
        if (doc.body) {
          result.contentLength = doc.body.innerHTML.length;
          result.bodyPreview = (doc.body.innerText || '').substring(0, 400);
          result.hasContent = doc.body.innerHTML.length > 100;
          const errTitle = doc.getElementById('errorTitle');
          if (errTitle) {
            result.isErrorPage = true;
            result.uvErrorTitle = errTitle.textContent;
            const errMsg = doc.getElementById('errorMessage');
            result.uvErrorMessage = errMsg ? errMsg.textContent : '';
            const errTrace = doc.getElementById('errorTrace');
            result.uvErrorTrace = errTrace ? errTrace.value : '';
          }
        }
      } else {
        result.note = 'cross-origin (contentDocument not accessible)';
      }
    } catch(e) { result.accessError = e.message; }
    return result;
  });

  // Route debug
  const routeDebug = await page.evaluate(() => window.__UV_ROUTE_DEBUG__ || {});

  // Performance entries
  const perfEntries = JSON.parse(await page.evaluate(() => JSON.stringify(
    performance.getEntriesByType('resource')
      .filter(e => e.name.includes('/bare/') || e.name.includes('/service/'))
      .map(e => ({ name: e.name.substring(0, 150), status: e.responseStatus, size: e.transferSize, dur: e.duration }))
  )).catch(() => '[]'));

  const bareEntries = perfEntries.filter(e => e.name.includes('/bare/'));
  const serviceEntries = perfEntries.filter(e => e.name.includes('/service/'));

  // New errors for this site
  const newErrors = consoleLogs.filter(l => l.type === 'error').slice(preErrorCount);
  const newFailed = failedRequests.slice(preFailedCount);

  // BARE MISSING tracking
  const bareMissingMsgs = consoleLogs.filter(l => l.text.includes('BARE MISSING X-Bare-Status'));
  const retryCount = consoleLogs.filter(l => l.text.includes('BARE MISSING X-Bare-Status') && !l.text.includes('after retries')).length;
  const retryFailedCount = consoleLogs.filter(l => l.text.includes('BARE MISSING X-Bare-Status after retries')).length;
  const rangeErrorCount = newErrors.filter(e => e.text.includes('RangeError') && e.text.includes('Failed to construct')).length;

  const result = {
    label, url,
    pollResult,
    iframeUrl: iframeInfo.iframeUrl || '(none)',
    title: iframeInfo.title || '(empty)',
    readyState: iframeInfo.readyState || '',
    rendered: iframeInfo.hasContent ? 'yes' :
              iframeInfo.isErrorPage ? 'no (UV error page)' :
              iframeInfo.error ? `error: ${iframeInfo.error}` : 'no',
    contentLength: iframeInfo.contentLength,
    isErrorPage: iframeInfo.isErrorPage,
    uvErrorTitle: iframeInfo.uvErrorTitle,
    uvErrorMessage: iframeInfo.uvErrorMessage,
    finalStatus: iframeInfo.isErrorPage ? `ERROR: ${iframeInfo.uvErrorTitle}` :
                 iframeInfo.hasContent ? '200 OK (content rendered)' :
                 pollResult.loaded ? 'PENDING (no content)' : 'NOT LOADED',
    bareCount: bareEntries.length,
    serviceCount: serviceEntries.length,
    bareEntries: bareEntries.map(e => `${e.name.split('?')[0]}:${e.status}`),
    routeDebug,
    bareMissingCount: bareMissingMsgs.length,
    retryCount, retryFailedCount, rangeErrorCount,
    newErrors: newErrors.map(e => e.text),
    newFailed: newFailed.map(e => `${e.url}: ${e.failure}`),
  };

  console.log(`  Loaded:           ${pollResult.loaded}`);
  console.log(`  iframe:           ${(result.iframeUrl || '').substring(0, 120)}`);
  console.log(`  Title:            ${result.title}`);
  console.log(`  Content length:   ${result.contentLength}`);
  console.log(`  Rendered:         ${result.rendered}`);
  console.log(`  Final status:     ${result.finalStatus}`);
  console.log(`  Bare entries:     ${result.bareCount} [${result.bareEntries.join(', ')}]`);
  if (result.isErrorPage) console.log(`  UV error:         ${result.uvErrorTitle} — ${result.uvErrorMessage}`);
  if (result.newErrors.length) result.newErrors.forEach(e => console.log(`  ERROR: ${e.substring(0, 200)}`));
  if (result.newFailed.length) result.newFailed.forEach(e => console.log(`  FAIL:  ${e.substring(0, 200)}`));

  return result;
}

// Run tests
for (const site of SITES) {
  siteResults[site.label] = await testSite(site.label, site.url);
}

// -------- GOOGLE ANALYSIS --------
const g = siteResults['Google'];
const googleA = g ? (g.rendered === 'yes' || g.contentLength > 100 ? 'yes' : 'no') : 'N/A';
const googleB = g && g.rangeErrorCount === 0 ? 'yes (completely gone)' : `no (${g ? g.rangeErrorCount : 'N/A'} occurrences)`;
const googleC = g ? g.retryCount : 'N/A';
const googleD = g ? (g.retryFailedCount > 0 ? `yes (${g.retryFailedCount})` : 'no') : 'N/A';
const googleE = g ? `finalStatus="${g.finalStatus}", bareHits=${g.bareCount}, serviceHits=${g.serviceCount}, contentLen=${g.contentLength}, title="${g.title}", routeDebug=${JSON.stringify(g.routeDebug)}` : 'N/A';

// -------- FINAL REPORT --------
console.log('\n\n' + '#'.repeat(80));
console.log('#  COMPREHENSIVE VALIDATION REPORT');
console.log('#'.repeat(80));

console.log('\n## SYSTEM STATUS');
console.log(`  SW Control:            ${swInfo.controlled ? 'YES' : 'NO'}`);
console.log(`  SW Active:             ${swInfo.active ? 'YES' : 'NO'}`);
console.log(`  SW Scope:              ${swInfo.scope}`);
console.log(`  SW State:              ${swInfo.state}`);
console.log(`  UV swReady:            ${initialBootStatus.swReady}`);
console.log(`  UV portReady:          ${initialBootStatus.portReady}`);
console.log(`  UV bareMuxReady:       ${initialBootStatus.bareMuxReady}`);
console.log(`  UV failedStage:        ${initialBootStatus.failedStage}`);
console.log(`  UV swPortStatus:       ${initialBootStatus.swPortStatus}`);
console.log(`  Bare-Mux diag:         ${bareMuxDiag.connected ? 'Connected' : 'Disconnected'} ${bareMuxDiag.reason || ''}`);

console.log('\n## SITE TEST RESULTS');
console.log('  ' + '-'.repeat(130));
const hdr = `  ${'SITE'.padEnd(12)} ${'Loaded'.padEnd(7)} ${'Rendered'.padEnd(16)} ${'Content'.padEnd(8)} ${'Final Status'.padEnd(38)} ${'Bare'.padEnd(6)} ${'Errors'.padEnd(6)}`;
console.log(hdr);
console.log('  ' + '-'.repeat(130));
for (const site of SITES) {
  const r = siteResults[site.label];
  if (!r) continue;
  const errCount = r.newErrors.length;
  const failCount = r.newFailed.length;
  console.log(`  ${r.label.padEnd(12)} ${(r.pollResult.loaded ? 'YES' : 'NO').padEnd(7)} ${String(r.rendered).padEnd(16)} ${String(r.contentLength).padEnd(8)} ${String(r.finalStatus).padEnd(38)} ${String(r.bareCount).padEnd(6)} ${String(errCount + failCount).padEnd(6)}`);
  if (r.isErrorPage) console.log(`  ${''.padEnd(12)} UV_ERROR: ${r.uvErrorTitle} — ${r.uvErrorMessage}`);
  if (r.routeDebug && r.routeDebug.lastUrl) console.log(`  ${''.padEnd(12)} Route: ${JSON.stringify(r.routeDebug)}`);
}
console.log('  ' + '-'.repeat(130));

console.log('\n## GOOGLE-SPECIFIC ANSWERS');
console.log(`  A. Renders successfully? ${googleA}`);
console.log(`  B. RangeError gone?      ${googleB}`);
console.log(`  C. Retry count?          ${googleC}`);
console.log(`  D. 502 path returned?    ${googleD}`);
console.log(`  E. Runtime evidence:     ${googleE}`);

console.log('\n## CONSOLE SUMMARY');
console.log(`  Total: ${consoleLogs.length}, Errors: ${consoleLogs.filter(l=>l.type==='error').length}, Warnings: ${consoleLogs.filter(l=>l.type==='warning').length}`);
const bareMissing = consoleLogs.filter(l => l.text.includes('BARE MISSING'));
if (bareMissing.length > 0) {
  console.log('\n  BARE MISSING X-Bare-Status messages:');
  bareMissing.forEach(l => console.log(`    ${l.text.substring(0, 200)}`));
}
const allErrors = consoleLogs.filter(l => l.type === 'error');
if (allErrors.length > 0) {
  console.log('\n  ALL ERRORS:');
  allErrors.forEach(l => console.log(`    [${l.type}] ${l.text.substring(0, 300)}`));
}
if (pageErrors.length > 0) {
  console.log('\n  PAGE EXCEPTIONS:');
  pageErrors.forEach(e => console.log(`    ${e}`));
}

console.log('\n## VERDICT');
let blockers = [];
let allOk = true;

for (const site of SITES) {
  const r = siteResults[site.label];
  if (!r) { blockers.push(`${site.label}: no result`); allOk = false; continue; }
  if (!r.pollResult.loaded) blockers.push(`${site.label}: iframe did not load`);
  if (r.rendered === 'no' || (typeof r.rendered === 'string' && r.rendered.startsWith('no')))
    blockers.push(`${site.label}: not rendered (${r.rendered})`);
  if (r.isErrorPage) blockers.push(`${site.label}: UV error page — ${r.uvErrorTitle}: ${r.uvErrorMessage}`);
}
if (swInfo.controlled !== true) blockers.push('Service worker not controlling page');
if (initialBootStatus.portReady !== true) blockers.push('UV port not ready');
if (initialBootStatus.bareMuxReady !== true) blockers.push('Bare Mux not ready');

if (allOk && blockers.length === 0) {
  console.log('  >>> READY FOR PRODUCTION TESTING <<<');
} else {
  console.log('  >>> NOT READY <<<');
  console.log('\n  Remaining blockers:');
  blockers.forEach((b, i) => console.log(`  ${i+1}. ${b}`));
}

// Cleanup
console.log('\n[CLEANUP] Shutting down...');
await browser.close().catch(() => {});
serverProc.kill();
setTimeout(() => process.exit(0), 1000);
