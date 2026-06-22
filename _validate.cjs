// Browser functionality validation — user-visible failures only
const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on('error', reject);
  });
}

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {};
    ws.on('open', () => resolve({
      ws,
      send: (m, p) => new Promise(r => { const id = ++mid; pend[id] = r; ws.send(JSON.stringify({ id, method: m, params: p || {} })); setTimeout(() => { if (pend[id]) { delete pend[id]; r({ timedout: true }); } }, 30000); }),
      close: () => { try { ws.close(); } catch (e) {} }
    }));
    ws.on('error', reject);
    ws.on('message', d => {
      try { const m = JSON.parse(d.toString()); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch (e) {}
    });
  });
}

function evalValue(r) { return r && r.result && r.result.result ? r.result.result.value : null; }

async function navigateAndCheck(page, url, label) {
  console.log(`\n=== ${label} ===`);

  // Navigate
  const navResult = await page.send('Runtime.evaluate', {
    expression: `(function(){ try { window.VoltraBrowser.navigate('${url.replace(/'/g, "\\'")}'); return 'ok'; } catch(e) { return 'err: ' + e.message; } })()`,
    returnByValue: true,
  });
  if (evalValue(navResult) !== 'ok') {
    return { ok: false, issues: [`Navigation failed: ${evalValue(navResult)}`] };
  }

  // Wait for initial load
  await sleep(12000);

  // Check iframe state
  const checkResult = await page.send('Runtime.evaluate', {
    expression: `(function(){
      var ifr = document.querySelector('iframe');
      if (!ifr) return JSON.stringify({loaded: false, issue: 'No iframe found'});
      try {
        var id = ifr.contentDocument || ifr.contentWindow.document;
        var issues = [];
        var title = (id.title || '').trim();
        if (!title) issues.push('Empty page title');
        var bodyText = (id.body && id.body.textContent || '').trim();
        if (!bodyText) issues.push('Empty body');
        if (bodyText.length < 50) issues.push('Very short body content (' + bodyText.length + ' chars)');
        var imgs = id.querySelectorAll('img').length;
        var links = id.querySelectorAll('link[rel=stylesheet]').length + id.querySelectorAll('style').length;
        var scripts = id.querySelectorAll('script').length;
        var errorText = (id.body && id.body.textContent || '').toLowerCase();
        if (errorText.includes('internal server error') || errorText.includes('error processing')) issues.push('Error page displayed');
        if (errorText.includes('failed to load')) issues.push('Failed to load message');
        var ready = id.readyState;
        return JSON.stringify({
          loaded: true,
          title: title.substring(0, 100),
          readyState: ready,
          imgs: imgs,
          stylesheets: links,
          scripts: scripts,
          bodyLen: bodyText.length,
          bodyPreview: bodyText.substring(0, 100),
          issues: issues,
          hasIframe: true
        });
      } catch(e) {
        return JSON.stringify({loaded: false, issue: 'Iframe access error: ' + e.message});
      }
    })()`,
    returnByValue: true,
  });

  const state = JSON.parse(evalValue(checkResult) || '{}');
  let issues = state.issues || [];
  if (!state.loaded) issues.push(state.issue || 'Unknown load failure');

  // Wait more for JS to execute
  await sleep(8000);

  // Re-check after more time
  const checkResult2 = await page.send('Runtime.evaluate', {
    expression: `(function(){
      var ifr = document.querySelector('iframe');
      if (!ifr) return '{}';
      try {
        var id = ifr.contentDocument || ifr.contentWindow.document;
        var issues = [];
        var imgs = id.querySelectorAll('img').length;
        var visibleImgs = 0;
        for (var i = 0; i < imgs; i++) {
          var img = id.querySelectorAll('img')[i];
          if (img && img.naturalWidth > 0 && img.naturalHeight > 0) visibleImgs++;
        }
        if (imgs > 5 && visibleImgs === 0) issues.push('No visible images (all broken)');
        var errorEl = id.querySelector('#errorTitle, .error, [class*=error], [id*=error]');
        if (errorEl) issues.push('Error element on page: ' + (errorEl.textContent || '').substring(0, 100));
        var ready = id.readyState;
        return JSON.stringify({
          readyState: ready,
          imgs: imgs,
          visibleImgs: visibleImgs,
          bodyLen: (id.body && id.body.textContent || '').length,
          links: id.querySelectorAll('link').length,
          issues: issues
        });
      } catch(e) {
        return JSON.stringify({issue: e.message});
      }
    })()`,
    returnByValue: true,
  });

  const state2 = JSON.parse(evalValue(checkResult2) || '{}');
  if (state2.issues) issues = issues.concat(state2.issues);
  // Deduplicate
  issues = [...new Set(issues)];

  // Check for white screen (body too short, no images, no links)
  if (state.loaded && state.bodyLen < 30 && state.imgs === 0 && state.stylesheets === 0) {
    if (!issues.includes('White screen / blank page')) issues.push('White screen / blank page');
  }

  const isOk = issues.length === 0;
  if (isOk) {
    console.log(`  PASS: title="${state.title || '(empty)'}" images=${state.imgs} stylesheets=${state.stylesheets} scripts=${state.scripts} body=${state.bodyLen}ch`);
  } else {
    console.log(`  FAIL: ${issues.join('; ')} (images=${state.imgs} stylesheets=${state.stylesheets} body=${state.bodyLen}ch)`);
  }
  return { ok: isOk, issues, state, state2 };
}

async function main() {
  const CDP_PORT = 9245;

  // Start server
  const svr = spawn('node', ['server.js'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  svr.stdout.on('data', d => {}); svr.stderr.on('data', d => {});
  for (let i = 0; i < 15; i++) {
    try { const s = await new Promise((r, j) => { http.get('http://127.0.0.1:8080/', (res) => { res.resume(); r(res.statusCode); }).on('error', j); }); if (s < 500) break; } catch(e) {}
    await sleep(1000);
  }

  // Start Chrome
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--window-size=1920,1080', 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  await sleep(3000);

  // Find page and navigate to app
  let pt;
  for (let i = 0; i < 20; i++) { try { const t = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page'); if (pt) break; } catch(e) {} await sleep(500); }
  if (!pt) { console.error('FATAL: no page'); process.exit(1); }

  const tmp = await connectCDP(pt.webSocketDebuggerUrl);
  await tmp.send('Runtime.enable'); await tmp.send('Page.enable');
  await tmp.send('Page.navigate', { url: 'http://127.0.0.1:8080/' }); tmp.close();
  await sleep(5000);

  for (let i = 0; i < 20; i++) {
    try { const t = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && (x.url.includes('127.0.0.1'))); if (pt) break; } catch(e) {}
    await sleep(500);
  }

  const page = await connectCDP(pt.webSocketDebuggerUrl);
  await page.send('Runtime.enable');
  await page.send('Page.enable');

  // Wait for UV boot + port ready
  for (let i = 0; i < 40; i++) {
    const r = await page.send('Runtime.evaluate', {
      expression: `(function(){ var s = window.__UV_BOOT_STATUS__; return s ? JSON.stringify({portReady: s.portReady}) : '{}'; })()`,
      returnByValue: true,
    });
    const val = evalValue(r);
    if (val && val.includes('true')) break;
    await sleep(500);
  }

  // Load browser section
  await page.send('Runtime.evaluate', {
    expression: `(function(){ if(typeof loadSection === 'function') loadSection('browser'); return 'ok'; })()`,
    returnByValue: true,
  });
  await sleep(2000);

  // Take screenshot of app page
  const ss1 = await page.send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(path.join(__dirname, '_ss_app.png'), Buffer.from(ss1.result.data, 'base64'));
  console.log('App page screenshot saved.');

  // Test each site
  const results = [];

  // Google Search
  results.push({ label: 'Google Search', ...(await navigateAndCheck(page, 'https://www.google.com/search?q=test+query', 'Google Search')) });

  // Reddit
  results.push({ label: 'Reddit', ...(await navigateAndCheck(page, 'https://www.reddit.com', 'Reddit')) });

  // Wikipedia
  results.push({ label: 'Wikipedia', ...(await navigateAndCheck(page, 'https://en.wikipedia.org/wiki/Main_Page', 'Wikipedia')) });

  // YouTube
  results.push({ label: 'YouTube', ...(await navigateAndCheck(page, 'https://www.youtube.com', 'YouTube')) });

  // Twitch
  results.push({ label: 'Twitch', ...(await navigateAndCheck(page, 'https://www.twitch.tv', 'Twitch')) });

  // FINAL TABLE
  console.log('\n\n' + '='.repeat(90));
  console.log('FUNCTIONALITY VALIDATION RESULTS');
  console.log('='.repeat(90));
  console.log('Site            | Working | User-visible issues');
  console.log('-' .repeat(90));
  for (const r of results) {
    const status = r.ok ? 'PASS ✅' : 'FAIL ❌';
    const issues = r.issues && r.issues.length > 0 ? r.issues.join('; ') : '(none)';
    console.log(`${r.label.padEnd(15)} | ${status.padEnd(7)} | ${issues}`);
  }
  console.log('='.repeat(90));

  // Save screenshots for visual inspection
  for (const r of results) {
    if (r.label) {
      const ss = await page.send('Page.captureScreenshot', { format: 'png' });
      require('fs').writeFileSync(path.join(__dirname, `_ss_${r.label.replace(/ /g, '_').toLowerCase()}.png`), Buffer.from(ss.result.data, 'base64'));
    }
  }
  console.log('Screenshots saved for all sites.');

  page.close(); chrome.kill(); svr.kill();
  console.log('Done');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
