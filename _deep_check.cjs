// Deep-dive on Reddit, YouTube, Twitch to classify actual user-visible failures
const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');

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

async function deepCheck(page, siteUrl, label) {
  console.log(`\n=== ${label} ===`);
  await page.send('Runtime.evaluate', {
    expression: `(function(){ try { window.VoltraBrowser.navigate('${siteUrl.replace(/'/g, "\\'")}'); } catch(e) {} })()`,
    returnByValue: true,
  });
  await sleep(20000);

  const r = await page.send('Runtime.evaluate', {
    expression: `(function(){
      var ifr = document.querySelector('iframe');
      if (!ifr) return JSON.stringify({hasIframe: false, issue: 'No iframe'});
      try {
        var id = ifr.contentDocument || ifr.contentWindow.document;
        var result = {
          hasIframe: true,
          src: ifr.src.substring(0, 120),
          readyState: id.readyState,
          title: (id.title || '').substring(0, 120),
          url: (id.location && id.location.href || '').substring(0, 120),
          bodyLen: (id.body && id.body.textContent || '').length,
          bodyHTML: (id.body && id.body.innerHTML || '').substring(0, 500),
          imgs: id.querySelectorAll('img').length,
          visibleImgs: 0,
          scripts: id.querySelectorAll('script').length,
          links: id.querySelectorAll('link').length,
          stylesheets: id.querySelectorAll('link[rel=stylesheet]').length,
          metaTags: id.querySelectorAll('meta').length,
          // Check for known error patterns
          errorEls: [],
          errorText: ''
        };
        // Count visible images
        for (var i = 0; i < result.imgs; i++) {
          var img = id.querySelectorAll('img')[i];
          if (img && img.complete && img.naturalWidth > 0) result.visibleImgs++;
        }
        // Check body text for errors
        var bt = (id.body && id.body.textContent || '').toLowerCase();
        if (bt.includes('internal server error')) result.errorText += 'internal-server-error;';
        if (bt.includes('failed to load')) result.errorText += 'failed-to-load;';
        if (bt.includes('not found')) result.errorText += 'not-found;';
        if (bt.includes('access denied')) result.errorText += 'access-denied;';
        if (bt.includes('error 5')) result.errorText += 'error-5xx;';
        if (bt.includes('this page isn')) result.errorText += 'page-not-working;';
        if (bt.includes('sorry')) result.errorText += 'sorry-message;';
        // Collect elements with error-related classes/ids
        var all = id.querySelectorAll('*');
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          var cls = (el.className || '') + ' ' + (el.id || '');
          var lc = cls.toLowerCase();
          if (lc.includes('error') || lc.includes('fail') || lc.includes('warning') || lc.includes('alert')) {
            result.errorEls.push((el.tagName || '') + '#' + (el.id || '') + '.' + (el.className || '').substring(0, 40));
            if (result.errorEls.length > 10) break;
          }
        }
        // Check for empty/whitescreen
        if (result.bodyLen < 10 && result.imgs === 0 && result.scripts === 0) result.issue = 'WHITE_SCREEN';
        else if (result.bodyLen < 50) result.issue = 'NEARLY_EMPTY';
        else result.issue = 'CONTENT_LOADED';
        return JSON.stringify(result);
      } catch(e) {
        return JSON.stringify({hasIframe: true, src: ifr.src.substring(0, 120), accessError: e.message});
      }
    })()`,
    returnByValue: true,
  });

  const state = JSON.parse(evalValue(r) || '{}');
  console.log(`  iframe src: ${state.src || 'N/A'}`);
  console.log(`  title: ${state.title || '(empty)'}`);
  console.log(`  url: ${state.url || 'N/A'}`);
  console.log(`  readyState: ${state.readyState}`);
  console.log(`  body length: ${state.bodyLen} chars`);
  console.log(`  images: ${state.imgs} total, ${state.visibleImgs} visible`);
  console.log(`  scripts: ${state.scripts}, stylesheets: ${state.stylesheets}, links: ${state.links}`);
  console.log(`  error elements found: ${state.errorEls ? state.errorEls.join(', ') : 'none'}`);
  console.log(`  error text matches: ${state.errorText || 'none'}`);
  console.log(`  verdict: ${state.issue}`);
  if (state.bodyHTML) console.log(`  first 400ch HTML: ${state.bodyHTML.replace(/\s+/g, ' ').trim().substring(0, 400)}`);

  return state;
}

async function main() {
  const CDP_PORT = 9246;
  const svr = spawn('node', ['server.js'], { cwd: __dirname, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  svr.stdout.on('data', d => {}); svr.stderr.on('data', d => {});
  for (let i = 0; i < 15; i++) {
    try { const s = await new Promise((r, j) => { http.get('http://127.0.0.1:8080/', (res) => { res.resume(); r(res.statusCode); }).on('error', j); }); if (s < 500) break; } catch(e) {}
    await sleep(1000);
  }
  const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--window-size=1920,1080', 'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  await sleep(3000);

  let pt;
  for (let i = 0; i < 20; i++) { try { const t = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page'); if (pt) break; } catch(e) {} await sleep(500); }
  const tmp = await connectCDP(pt.webSocketDebuggerUrl);
  await tmp.send('Runtime.enable'); await tmp.send('Page.enable');
  await tmp.send('Page.navigate', { url: 'http://127.0.0.1:8080/' }); tmp.close();
  await sleep(5000);

  for (let i = 0; i < 20; i++) { try { const t = await fetchJSON(`http://127.0.0.1:${CDP_PORT}/json`); pt = t.find(x => x.type === 'page' && (x.url.includes('127.0.0.1'))); if (pt) break; } catch(e) {} await sleep(500); }
  const page = await connectCDP(pt.webSocketDebuggerUrl);
  await page.send('Runtime.enable'); await page.send('Page.enable');

  for (let i = 0; i < 40; i++) {
    const r = await page.send('Runtime.evaluate', { expression: `(function(){ var s = window.__UV_BOOT_STATUS__; return s ? JSON.stringify({portReady: s.portReady}) : '{}'; })()`, returnByValue: true });
    if (evalValue(r) && evalValue(r).includes('true')) break;
    await sleep(500);
  }

  await page.send('Runtime.evaluate', { expression: `(function(){ if(typeof loadSection === 'function') loadSection('browser'); return 'ok'; })()`, returnByValue: true });
  await sleep(2000);

  await deepCheck(page, 'https://www.reddit.com', 'Reddit');
  await deepCheck(page, 'https://www.youtube.com', 'YouTube');
  await deepCheck(page, 'https://www.twitch.tv', 'Twitch');

  page.close(); chrome.kill(); svr.kill();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
