// Trace: why UV Reload succeeds when initial navigation fails
// and why saved tabs block after Orbit reload

import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import fs from 'fs';

const ORBIT_DIR = 'C:\\Users\\abeni\\Downloads\\orbit';
const LOG_FILE = ORBIT_DIR + '\\_trace_reload_out.txt';
function log(msg) { const line = `[${Date.now()}] ${msg}`; console.log(line); fs.appendFileSync(LOG_FILE, line + '\n'); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
fs.writeFileSync(LOG_FILE, '');

const server = spawn('node', ['server.js'], { cwd: ORBIT_DIR, stdio: 'pipe' });
server.stderr.on('data', () => {});
await sleep(3000);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-web-security']
});

// =============================================================
// EVIDENCE 5: Fast navigation before portReady — reproduce failure
// =============================================================
log('=== EVIDENCE 5: Initial navigation timing vs portReady ===');
{
  const page = await browser.newPage();
  const cdp = await page.target().createCDPSession();
  await cdp.send('Network.enable');

  const swEvents = [];
  const reqTimestamps = [];

  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('[BOOT]') || t.includes('[PORT_SYNC]') || t.includes('[TRACE]') || t.includes('getPort')) {
      swEvents.push({ time: Date.now(), text: t.substring(0, 200) });
    }
  });

  cdp.on('Network.requestWillBeSent', p => {
    if (p.type === 'Document') {
      reqTimestamps.push({ url: p.request.url, time: Date.now(), phase: 'will-be-sent' });
    }
  });
  cdp.on('Network.responseReceived', p => {
    const r = p.response;
    if (p.type === 'Document') {
      reqTimestamps.push({ url: r.url, time: Date.now(), status: r.status, fromSW: r.fromServiceWorker, phase: 'received' });
    }
  });

  // Load page and navigate immediately (before port may be ready)
  await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await sleep(1000); // Only 1 second wait — might be before portReady=true

  // Check port status
  let portReady = await page.evaluate(() => window.__UV_BOOT_STATUS__?.portReady || false).catch(() => false);
  log(`Port ready after 1s: ${portReady}`);
  log(`SW events so far: ${swEvents.length} events`);

  // Open browser and navigate
  await page.evaluate(() => { if (typeof loadSection === 'function') loadSection('browser'); });
  await sleep(2000);
  await page.evaluate(() => { window.VoltraBrowser.navigate('https://www.google.com'); });
  await sleep(8000);

  // Check iframe state
  const iframeState = await page.evaluate(() => {
    const f = document.querySelector('iframe');
    if (!f) return { error: 'no iframe' };
    try {
      const d = f.contentDocument || f.contentWindow?.document;
      if (!d) return { error: 'no doc' };
      return {
        title: d.title,
        bodyLen: (d.body?.innerText || '').length,
        isErrorPage: (d.body?.innerHTML || '').includes('Error processing') || (d.body?.innerHTML || '').includes('Failed to load'),
        errorMsg: d.getElementById('errorMessage')?.textContent || '',
        readyState: d.readyState,
        bodyPreview: (d.body?.innerText || '').substring(0, 300)
      };
    } catch(e) { return { error: e.message }; }
  }).catch(() => ({}));
  log(`\nEVIDENCE 5 result: ${JSON.stringify(iframeState, null, 2)}`);

  log(`\nPort ready timing analysis:`);
  const readyEvent = swEvents.find(e => e.text.includes('portReady: true') || e.text.includes('bareMuxReady: true'));
  const navEvent = reqTimestamps.find(r => r.url.includes('google'));
  if (readyEvent) log(`  portReady event: +${readyEvent.time - swEvents[0]?.time || 0}ms from first event`);
  if (navEvent) log(`  Google nav: at ${navEvent.time}`);

  // Now try reload
  if (iframeState.isErrorPage) {
    log('\nError page detected — clicking UV Reload...');
    await page.evaluate(() => {
      const f = document.querySelector('iframe');
      if (!f) return;
      try {
        const d = f.contentDocument || f.contentWindow?.document;
        if (!d) return;
        d.getElementById('reload')?.click();
      } catch(e) {}
    });
    await sleep(8000);

    const afterReload = await page.evaluate(() => {
      const f = document.querySelector('iframe');
      if (!f) return { error: 'no iframe' };
      try {
        const d = f.contentDocument || f.contentWindow?.document;
        if (!d) return { error: 'no doc' };
        return {
          title: d.title,
          bodyLen: (d.body?.innerText || '').length,
          isErrorPage: (d.body?.innerHTML || '').includes('Error processing'),
          readyState: d.readyState
        };
      } catch(e) { return { error: e.message }; }
    }).catch(() => ({}));
    log(`After Reload: ${JSON.stringify(afterReload)}`);
    log(`Reload verdict: ${afterReload.isErrorPage ? 'STILL FAILING' : 'RECOVERED — Reload succeeded when initial did not'}`);
  } else {
    log('\nNo error page (navigation succeeded on first try)');
  }

  await page.close();
}

// =============================================================
// EVIDENCE 6: Saved tabs blocked after Orbit reload
// =============================================================
log('\n\n=== EVIDENCE 6: Orbit reload tab blocking ===');
{
  const page = await browser.newPage();
  await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await sleep(5000);

  // Open browser and navigate to Google
  await page.evaluate(() => { if (typeof loadSection === 'function') loadSection('browser'); });
  await sleep(3000);
  await page.evaluate(() => { window.VoltraBrowser.navigate('https://www.google.com'); });
  await sleep(8000);

  const beforeReload = await page.evaluate(() => {
    const tabs = document.querySelectorAll('[id^="browserFrame-"]');
    return Array.from(tabs).map(t => ({ id: t.id, src: t.src?.substring(0, 100) || '' }));
  }).catch(() => []);
  log(`Tabs before reload: ${JSON.stringify(beforeReload)}`);

  // Capture console messages about port state after reload
  const postReloadLogs = [];
  page.on('console', msg => {
    const t = msg.text();
    if (t.includes('[PORT_SYNC]') || t.includes('[BOOT]') || t.includes('[TRACE]')) {
      postReloadLogs.push({ time: Date.now(), text: t.substring(0, 200) });
    }
  });

  // Reload Orbit
  log('Reloading Orbit...');
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 15000 });
  await sleep(6000);

  // Check port state
  const portStateAfter = await page.evaluate(() => window.__UV_BOOT_STATUS__?.swPortStatus || 'unknown').catch(() => 'unknown');
  const portReadyAfter = await page.evaluate(() => window.__UV_BOOT_STATUS__?.portReady || false).catch(() => false);
  log(`After reload — port state: ${portStateAfter}, portReady: ${portReadyAfter}`);

  log(`\nPost-reload SW events (first 20):`);
  postReloadLogs.slice(0, 20).forEach(e => log(`  +${e.time - postReloadLogs[0]?.time || 0}ms ${e.text}`));

  // Track how long until portReady becomes true
  const portReadyLog = postReloadLogs.find(e => e.text.includes('portReady: true'));
  if (portReadyLog) {
    log(`portReady=true at +${portReadyLog.time - postReloadLogs[0]?.time || 0}ms after first event`);
  }
  const portFailLog = postReloadLogs.find(e => e.text.includes('swPortStatus: "failed"'));
  if (portFailLog) {
    log(`port FAILED at +${portFailLog.time - postReloadLogs[0]?.time || 0}ms`);
  }
  const firstSync = postReloadLogs.find(e => e.text.includes('[PORT_SYNC]'));
  if (firstSync) {
    log(`First PORT_SYNC at +${firstSync.time - postReloadLogs[0]?.time || 0}ms: ${firstSync.text}`);
  }

  // Open browser and navigate again
  log('\nOpening browser after reload...');
  await page.evaluate(() => { if (typeof loadSection === 'function') loadSection('browser'); });
  await sleep(4000);

  const iframes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map(f => ({
      id: f.id,
      src: (f.src || '').substring(0, 120)
    }));
  }).catch(() => []);
  log(`Iframes after reload + browser: ${JSON.stringify(iframes)}`);

  // Check for saved tabs
  const tabsAfter = await page.evaluate(() => {
    const tabs = document.querySelectorAll('[id^="browserFrame-"]');
    return Array.from(tabs).map(t => ({ id: t.id, src: (t.src || '').substring(0, 100) || t.getAttribute('srcdoc')?.substring(0, 50) || '' }));
  }).catch(() => []);
  log(`Tabs after reload: ${JSON.stringify(tabsAfter)}`);

  await page.close();
}

log('\n========== RELOAD EVIDENCE COMPLETE ==========');
await browser.close();
server.kill();
