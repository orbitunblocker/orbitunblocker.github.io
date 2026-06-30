import { chromium } from 'playwright';
import { createServer } from 'http';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const DIR = dirname(fileURLToPath(import.meta.url));
const LOG = [];
let serverProcess = null;

function slog(msg, ...rest) {
  const s = `[GAME-TEST ${Date.now()}] ${msg} ${rest.join(' ')}`;
  LOG.push(s);
  console.log(s);
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['server.js'], { cwd: DIR, stdio: ['pipe', 'pipe', 'pipe'] });
    let started = false;
    serverProcess.stdout.on('data', d => {
      const text = d.toString();
      if (text.includes('RUNNING ON') && !started) { started = true; resolve(); }
    });
    serverProcess.stderr.on('data', d => {});
    setTimeout(() => { if (!started) reject(new Error('Server timeout')); }, 10000);
  });
}

function stopServer() {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
}

async function waitForPortReady(page, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pr = await page.evaluate(() => {
      const s = window.__UV_BOOT_STATUS__;
      return s ? { portReady: s.portReady, status: (s._log || []).filter(l => l.key === 'swPortStatus').pop()?.val || 'none' } : null;
    });
    if (pr && pr.portReady === true) return pr;
    await page.waitForTimeout(200);
  }
  const pr = await page.evaluate(() => {
    const s = window.__UV_BOOT_STATUS__;
    return s ? { portReady: s.portReady, status: (s._log || []).filter(l => l.key === 'swPortStatus').pop()?.val || 'none' } : null;
  });
  return pr;
}

async function getIframeSrc(page) {
  return await page.evaluate(() => {
    const f = document.getElementById('gameFrame');
    if (f) return f.src || '(no src)';
    const bf = document.getElementById('browserFrame-main');
    if (bf) return bf.src || '(srcdoc)';
    return 'no-iframe-found';
  });
}

async function getGamePageState(page) {
  return await page.evaluate(() => {
    const overlay = document.getElementById('gameLoadingOverlay');
    const frame = document.getElementById('gameFrame');
    const errorEl = overlay?.querySelector('.game-loading-error');
    return {
      overlayVisible: overlay && !overlay.classList.contains('hidden'),
      overlayHidden: overlay && overlay.classList.contains('hidden'),
      errorVisible: !!errorEl,
      errorText: errorEl?.querySelector('p')?.textContent || null,
      frameSrc: frame?.src || null,
      dataSrc: frame?.getAttribute('data-src') || null,
      gamePageActive: document.body.classList.contains('game-page-active'),
    };
  });
}

// ===== MAIN TEST =====
async function main() {
  const GAME_ID = 'cookie-clicker';
  const ORIGINAL_URL = 'https://script.google.com/macros/s/AKfycbxGM35J29NkO-2LYjxWj_cA9IUaaXypkUy-LqXyLRbGTz0R6lXmAEapz1STN1jlTIRavw/exec';

  slog('Starting server...');
  try { await startServer(); } catch (e) { slog('Server start note:', e.message); }

  slog('Launching browser...');
  const browser = await chromium.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--enable-features=NetworkService,NetworkServiceInProcess']
  });

  const REPORT = {
    gameId: GAME_ID,
    originalUrl: ORIGINAL_URL,
    proxiedUrl: null,
    requests: [],
    failedRequests: [],
    consoleLogs: [],
    pageErrors: [],
    swDiagnostics: null,
    gamePageState: null,
    firstFailedRequest: null,
    iframeContent: null,
  };

  try {
    const context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write']
    });
    const page = await context.newPage();

    // Capture all requests
    page.on('request', req => {
      const entry = {
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
        headers: req.headers(),
        timestamp: Date.now(),
      };
      REPORT.requests.push(entry);
    });

    // Capture failed requests
    page.on('requestfailed', req => {
      const entry = {
        url: req.url(),
        failure: req.failure()?.errorText || 'unknown',
        resourceType: req.resourceType(),
        method: req.method(),
        timestamp: Date.now(),
      };
      REPORT.failedRequests.push(entry);
      if (!REPORT.firstFailedRequest) REPORT.firstFailedRequest = entry;
    });

    // Capture responses
    page.on('response', resp => {
      // Find the matching request entry and add status, headers
      const match = REPORT.requests.find(r => r.url === resp.url() && !r.status);
      if (match) {
        match.status = resp.status();
        match.statusText = resp.statusText();
        match.responseHeaders = resp.headers();
        match.responseUrl = resp.url();
      }
      // Check for problematic headers
      const headers = resp.headers();
      if (headers['x-frame-options'] || headers['content-security-policy']) {
        slog(`  [SECURITY HEADER] ${resp.url()}: x-frame-options=${headers['x-frame-options'] || 'none'}, csp=${(headers['content-security-policy'] || '').substring(0, 100)}`);
      }
    });

    // Capture console
    page.on('console', msg => {
      REPORT.consoleLogs.push(`[${msg.type().toUpperCase()}] ${msg.text()}`);
    });

    page.on('pageerror', err => {
      REPORT.pageErrors.push(err.message);
    });

    // Step 1: Open Orbit
    slog('Opening Orbit...');
    await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });

    // Step 2: Wait for port ready
    slog('Waiting for portReady...');
    await page.waitForTimeout(5000);
    let ps = await page.evaluate(() => {
      const s = window.__UV_BOOT_STATUS__;
      return { portReady: s?.portReady, status: s?._log?.filter(l => l.key === 'swPortStatus').pop()?.val || 'none' };
    });
    slog('Port status:', JSON.stringify(ps));

    if (ps.portReady !== true) {
      slog('Waiting for port...');
      const pr = await waitForPortReady(page, 15000);
      slog('Port after wait:', JSON.stringify(pr));
    }

    // Step 3: Navigate to games section
    slog('Navigating to Games section...');
    await page.evaluate(() => {
      const navIcon = document.querySelector('.nav-icon[data-section="games"]');
      if (navIcon) navIcon.click();
    });
    await page.waitForTimeout(2000);

    // Step 4: Get available games
    const gameIds = await page.evaluate(() => {
      const cards = document.querySelectorAll('.game-card');
      return Array.from(cards).map(c => {
        const onclick = c.getAttribute('onclick') || '';
        const match = onclick.match(/openGame\('(.+?)'\)/);
        return match ? match[1] : null;
      }).filter(Boolean);
    });
    slog(`Found ${gameIds.length} game IDs, first 5: ${gameIds.slice(0, 5).join(', ')}`);

    // Step 5: Click the target game
    const targetGame = gameIds.find(id => id === GAME_ID);
    if (!targetGame) {
      slog(`*** GAME ${GAME_ID} NOT FOUND in available games`);
      REPORT.error = `Game ${GAME_ID} not found`;
      await context.close();
      return;
    }
    slog(`Clicking game: "${targetGame}"`);
    await page.evaluate((id) => {
      // Find the card with the matching onclick
      const cards = document.querySelectorAll('.game-card');
      for (const card of cards) {
        const onclick = card.getAttribute('onclick');
        if (onclick && onclick.includes(`openGame('${id}')`)) {
          card.click();
          return;
        }
      }
    }, targetGame);
    await page.waitForTimeout(1000);

    // Step 6: Check game page state
    const gameState = await getGamePageState(page);
    REPORT.gamePageState = gameState;
    slog('Game page state:', JSON.stringify(gameState, null, 2));

    // Step 7: Get the encoded iframe src (the proxied URL)
    const iframeSrc = await getIframeSrc(page);
    REPORT.proxiedUrl = iframeSrc;
    slog('Game iframe src:', iframeSrc);

    // Step 8: Wait for loading to complete or fail
    slog('Waiting for game load (15s)...');
    let loadComplete = false;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(500);
      const st = await getGamePageState(page);
      if (st.overlayHidden || st.errorVisible) {
        loadComplete = true;
        REPORT.gamePageState = st;
        slog(`Game load state at ${(i+1)*0.5}s: overlayHidden=${st.overlayHidden}, error=${st.errorVisible}, errorText=${st.errorText}`);
        break;
      }
    }
    if (!loadComplete) {
      slog('Game did not finish loading within 15s timeout');
    }

    // Step 9: Wait additional time for iframe content
    slog('Waiting additional 5s for iframe content...');
    await page.waitForTimeout(5000);
    const finalState = await getGamePageState(page);
    REPORT.gamePageState = finalState;
    slog('Final game page state:', JSON.stringify(finalState, null, 2));

    // Step 11b: Try to get UV-decoded URLs for failed proxied requests
    try {
      const uvDecode = (url) => {
        // Simple XOR decode for UV URLs
        const prefix = '/service/';
        const idx = url.indexOf(prefix);
        if (idx === -1) return null;
        const encoded = url.substring(idx + prefix.length);
        try {
          return decodeURIComponent(encoded).split('').map((c, i) =>
            i % 2 === 1 ? String.fromCharCode(c.charCodeAt(0) ^ 3) : c
          ).join('');
        } catch(e) { return encoded; }
      };
      REPORT.requests.forEach(r => {
        if (r.status >= 400 && r.url.includes('/service/')) {
          r.decodedUrl = uvDecode(r.url);
        }
      });
    } catch(e) {
      slog('UV decode failed:', e.message);
    }

    // Step 10: Try to get SW diagnostics
    const diag = await page.evaluate(async () => {
      try {
        const reg = await navigator.serviceWorker.ready;
        const ch = new MessageChannel();
        return await Promise.race([
          new Promise(r => { ch.port1.onmessage = e => r(e.data); reg.active.postMessage({ type: 'GET_DIAG' }, [ch.port2]); }),
          new Promise(r => setTimeout(() => r({ error: 'timeout' }), 2000))
        ]);
      } catch(e) { return { error: e.message }; }
    });
    REPORT.swDiagnostics = diag;
    slog('SW diagnostics:', JSON.stringify(diag, null, 2));

    // Step 11: Try to access iframe content (might be cross-origin)
    REPORT.iframeContent = await page.evaluate(() => {
      try {
        const f = document.getElementById('gameFrame');
        if (!f) return { error: 'no iframe' };
        const doc = f.contentDocument || f.contentWindow?.document;
        if (!doc) return { error: 'cross-origin blocked' };
        return {
          title: doc.title,
          url: doc.URL,
          bodyTextLength: doc.body?.innerText?.length || 0,
          scripts: doc.querySelectorAll('script').length,
          links: doc.querySelectorAll('link[rel="stylesheet"]').length,
        };
      } catch(e) {
        return { error: e.message };
      }
    });
    slog('Iframe content access:', JSON.stringify(iframeContent, null, 2));

    await context.close();
  } catch (e) {
    slog('FATAL ERROR:', e.message, e.stack);
    REPORT.error = e.message;
  } finally {
    await browser.close();
    stopServer();
  }

  // ===== REPORT =====
  slog('\n' + '='.repeat(70));
  slog('           GAME LOADING INVESTIGATION REPORT');
  slog('='.repeat(70));
  slog(`Game: ${REPORT.gameId}`);
  slog(`Original URL: ${REPORT.originalUrl}`);
  slog(`Proxied URL: ${REPORT.proxiedUrl}`);
  slog('');

  // Summary of all requests
  slog(`Total requests captured: ${REPORT.requests.length}`);
  slog(`Failed requests: ${REPORT.failedRequests.length}`);
  slog(`Console messages: ${REPORT.consoleLogs.length}`);
  slog(`Page errors: ${REPORT.pageErrors.length}`);
  slog('');

  // First failed request
  if (REPORT.firstFailedRequest) {
    slog('--- FIRST FAILED REQUEST ---');
    slog(`  URL: ${REPORT.firstFailedRequest.url}`);
    slog(`  Error: ${REPORT.firstFailedRequest.failure}`);
    slog(`  Type: ${REPORT.firstFailedRequest.resourceType}`);
    slog('');
  }

  // All failed requests
  if (REPORT.failedRequests.length > 0) {
    slog('--- ALL FAILED REQUESTS ---');
    REPORT.failedRequests.forEach((f, i) => {
      slog(`  ${i+1}. ${f.url}`);
      slog(`     Error: ${f.failure}, Type: ${f.resourceType}`);
    });
    slog('');
  }

  // All requests with non-200 status
  const nonOk = REPORT.requests.filter(r => r.status && r.status >= 400);
  if (nonOk.length > 0) {
    slog('--- REQUESTS WITH HTTP ERRORS ---');
    nonOk.forEach(r => {
      slog(`  ${r.status} ${r.method} ${r.url.substring(0, 100)}`);
      slog(`     Type: ${r.resourceType}`);
      if (r.decodedUrl) slog(`     Decoded: ${r.decodedUrl}`);
    });
    slog('');
  }

  // Security headers found
  const responsesWithSecHeaders = REPORT.requests.filter(r => {
    const h = r.responseHeaders;
    return h && (h['x-frame-options'] || h['content-security-policy']);
  });
  if (responsesWithSecHeaders.length > 0) {
    slog('--- RESPONSES WITH SECURITY HEADERS ---');
    responsesWithSecHeaders.forEach(r => {
      slog(`  ${r.url}:`);
      if (r.responseHeaders['x-frame-options']) slog(`    X-Frame-Options: ${r.responseHeaders['x-frame-options']}`);
      if (r.responseHeaders['content-security-policy']) slog(`    CSP: ${r.responseHeaders['content-security-policy'].substring(0, 150)}`);
    });
    slog('');
  }

  // Console errors
  const errors = REPORT.consoleLogs.filter(l => l.startsWith('[ERROR]') || l.startsWith('[FAIL]'));
  if (errors.length > 0) {
    slog('--- CONSOLE ERRORS ---');
    errors.forEach(e => slog(`  ${e}`));
    slog('');
  }

  // Service worker diagnostics
  slog('--- SW DIAGNOSTICS ---');
  if (REPORT.swDiagnostics) {
    Object.entries(REPORT.swDiagnostics).forEach(([k, v]) => {
      if (typeof v === 'object') {
        slog(`  ${k}: ${JSON.stringify(v)}`);
      } else {
        slog(`  ${k}: ${v}`);
      }
    });
  } else {
    slog('  (not available)');
  }
  slog('');

  // Game page final state
  slog('--- GAME PAGE FINAL STATE ---');
  if (REPORT.gamePageState) {
    Object.entries(REPORT.gamePageState).forEach(([k, v]) => slog(`  ${k}: ${v}`));
  }
  slog('');

  // Iframe content
  slog('--- IFRAME CONTENT ---');
  if (REPORT.iframeContent) {
    slog(`  title: ${REPORT.iframeContent.title}`);
    slog(`  url: ${REPORT.iframeContent.url}`);
    slog(`  bodyTextLength: ${REPORT.iframeContent.bodyTextLength}`);
    slog(`  scripts: ${REPORT.iframeContent.scripts}`);
    slog(`  links: ${REPORT.iframeContent.links}`);
    if (REPORT.iframeContent.error) slog(`  error: ${REPORT.iframeContent.error}`);
  }

  // Identify failure point
  slog('\n--- FAILURE POINT ANALYSIS ---');
  if (REPORT.error) {
    slog(`Fatal error: ${REPORT.error}`);
  } else if (REPORT.failedRequests.length > 0) {
    const first = REPORT.firstFailedRequest;
    slog(`First failure: ${first.url}`);
    slog(`Error type: ${first.failure}`);
    slog(`Resource type: ${first.resourceType}`);
    slog(`Timestamp: ${first.timestamp}`);
    slog('\nCategory: Likely asset loading failure (JS, CSS, or media file not found or blocked)');
  } else if (REPORT.gamePageState?.errorVisible) {
    slog(`Game error displayed: ${REPORT.gamePageState.errorText}`);
    slog('Category: Orbit-side error (port not ready, proxy error, timeout)');
  } else if (REPORT.gamePageState?.overlayVisible && !REPORT.gamePageState?.overlayHidden) {
    slog('Game stuck in loading state (overlay never hidden)');
    slog('Category: Likely proxy timeout or iframe load failure');
  } else {
    slog('No failures detected in test capture');
  }

  slog('\n' + '='.repeat(70));
  slog('           END OF REPORT');
  slog('='.repeat(70));

  // Write report to file
  const reportFile = join(DIR, `game-report-${GAME_ID}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(REPORT, null, 2));
  slog(`\nFull report written to: ${reportFile}`);
}

main().catch(e => { console.error('Harness error:', e); stopServer(); process.exit(1); });
