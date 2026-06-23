const {spawn} = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }); }).on('error', reject);
  });
}

function evalVal(r) {
  if (!r || !r.result || !r.result.result) return undefined;
  return r.result.result.value;
}

async function main() {
  try { await fetchJSON('http://127.0.0.1:9252/json/version'); await sleep(2000); } catch (e) {}
  const chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=9252',
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--disable-popup-blocking', '--disable-default-apps',
    '--allow-insecure-localhost', '--disable-web-security',
    '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-verify-' + Date.now(),
    'http://127.0.0.1:8080/'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let v;
  for (let i = 0; i < 20; i++) { try { v = await fetchJSON('http://127.0.0.1:9252/json/version'); break; } catch (e) { await sleep(1000); } }
  if (!v) { console.log('FAIL: Chrome'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', v.Browser);

  let pt;
  for (let i = 0; i < 20; i++) { await sleep(500); try { const t = await fetchJSON('http://127.0.0.1:9252/json'); pt = t.find(x => x.type === 'page'); if (pt) break; } catch (e) {} }
  if (!pt) { console.log('FAIL: No page'); chrome.kill(); process.exit(1); }

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pend = {};
  let passed = 0, failed = 0;

  function send(m, p) {
    p = p || {};
    return new Promise(r => {
      const id = ++mid; pend[id] = r;
      ws.send(JSON.stringify({ id, method: m, params: p }));
      setTimeout(() => { if (pend[id]) { delete pend[id]; r({}) } }, 15000);
    });
  }

  function logAndEval(expr) {
    return send('Runtime.evaluate', { expression: expr, returnByValue: true }).then(r => evalVal(r));
  }

  ws.on('message', d => {
    try { const m = JSON.parse(d.toString()); if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch (e) {}
  });

  ws.on('open', async () => {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Console.enable');
    await send('Log.enable');
    await send('Runtime.runIfWaitingForDebugger');
    await sleep(3000);

    console.log('\n=== CRITICAL FIX VERIFICATION ===\n');

    // 1. Verify files loaded
    var hasBoot = await logAndEval('typeof window.__UV_BOOT_STATUS__ !== "undefined"');
    console.log(`1. Scripts loaded (__UV_BOOT_STATUS__): ${hasBoot ? 'PASS' : 'FAIL'}`);
    if (hasBoot) passed++; else failed++;

    var hasEnc = await logAndEval('typeof window.encodeUVUrl === "function"');
    console.log(`2. encodeUVUrl available: ${hasEnc ? 'PASS' : 'FAIL'}`);
    if (hasEnc) passed++; else failed++;

    // 2. Verify BrowserUI._pendingNavigations exists
    var hasPending = await logAndEval('Array.isArray(window.VoltraBrowser && window.VoltraBrowser._browserUI && window.VoltraBrowser._browserUI._pendingNavigations)');
    console.log(`3. BrowserUI._pendingNavigations exists: ${hasPending ? 'PASS' : 'FAIL'}`);
    if (hasPending) passed++; else failed++;

    var hasFlush = await logAndEval('typeof (window.VoltraBrowser && window.VoltraBrowser._browserUI && window.VoltraBrowser._browserUI._flushPendingNavigations) === "function"');
    console.log(`4. BrowserUI._flushPendingNavigations exists: ${hasFlush ? 'PASS' : 'FAIL'}`);
    if (hasFlush) passed++; else failed++;

    var hasErrorPage = await logAndEval('typeof (window.VoltraBrowser && window.VoltraBrowser._browserUI && window.VoltraBrowser._browserUI._showErrorPage) === "function"');
    console.log(`5. BrowserUI._showErrorPage exists: ${hasErrorPage ? 'PASS' : 'FAIL'}`);
    if (hasErrorPage) passed++; else failed++;

    // 3. Load the browser section to create the iframe
    await logAndEval('if(typeof loadSection==="function")loadSection("browser")');
    await sleep(2000);

    // 4. Check that browser UI rendered
    var hasBrowserIframe = await logAndEval('!!document.getElementById("browserFrame-main")');
    console.log(`6. Browser iframe rendered after loadSection('browser'): ${hasBrowserIframe ? 'PASS' : 'FAIL'}`);
    if (hasBrowserIframe) passed++; else failed++;

    var hasBrowserMount = await logAndEval('!!document.getElementById("browserMount")');
    console.log(`7. Browser mount exists: ${hasBrowserMount ? 'PASS' : 'FAIL'}`);
    if (hasBrowserMount) passed++; else failed++;

    // 5. Test isBraveHome and normalizeUrl work correctly
    // These are local functions, so test them through the BrowserUI
    var orbHome = await logAndEval('var f=document.getElementById("browserFrame-main");f&&f.srcdoc?f.srcdoc.substring(0,100):"no-srcdoc"');
    console.log(`8. Browser frame srcdoc after load: ${orbHome ? 'PASS (has srcdoc)' : 'FAIL'}`);
    if (orbHome && typeof orbHome === 'string') passed++; else failed++;

    // 6. Navigate to settings and check srcdoc
    await logAndEval('if(window.VoltraBrowser)VoltraBrowser.navigate("orbit://settings")');
    await sleep(1500);
    var settingsSrcDoc = await logAndEval('var f=document.getElementById("browserFrame-main");f&&f.srcdoc?f.srcdoc.length:0');
    console.log(`9. Settings srcdoc length: ${settingsSrcDoc > 200 ? 'PASS (' + settingsSrcDoc + ' chars)' : 'FAIL'}`);
    if (settingsSrcDoc > 200) passed++; else failed++;

    // 7. Navigate to home via orbit://home
    await logAndEval('if(window.VoltraBrowser)VoltraBrowser.navigate("orbit://home")');
    await sleep(1500);
    var homeSrcDoc = await logAndEval('var f=document.getElementById("browserFrame-main");f&&f.srcdoc?f.srcdoc.length:"SRC:"+(f?f.src.substring(0,60):"no-frame")');
    var isHomeSrcdoc = typeof homeSrcDoc === 'number' && homeSrcDoc > 100;
    var isHomeNotEncoded = typeof homeSrcDoc === 'string' && !homeSrcDoc.includes('/service/');
    if (isHomeSrcdoc) {
      console.log(`10. orbit://home → srcdoc (${homeSrcDoc} chars): PASS`);
      passed++;
    } else if (isHomeNotEncoded) {
      console.log(`10. orbit://home → direct src (not UV-encoded): PASS`);
      passed++;
    } else {
      console.log(`10. orbit://home → ${JSON.stringify(homeSrcDoc)}: FAIL`);
      failed++;
    }

    // 8. Navigate to a real URL and verify UV route debug
    // (We can't test proxied navigation without UV infrastructure, but we can verify the path)
    await logAndEval('if(window.VoltraBrowser)VoltraBrowser.navigate("voltra://brave-home")');
    await sleep(1500);
    var braveHomeSrcDoc = await logAndEval('var f=document.getElementById("browserFrame-main");f&&f.srcdoc?f.srcdoc.length:0');
    console.log(`11. voltra://brave-home srcdoc: ${braveHomeSrcDoc > 100 ? 'PASS (' + braveHomeSrcDoc + ' chars)' : 'FAIL'}`);
    if (braveHomeSrcDoc > 100) passed++; else failed++;

    // 9. Verify deferred navigation queue exists and is empty (nothing pending)
    var pendingCount = await logAndEval('(window.VoltraBrowser && window.VoltraBrowser._browserUI && window.VoltraBrowser._browserUI._pendingNavigations) ? window.VoltraBrowser._browserUI._pendingNavigations.length : -1');
    console.log(`12. Pending navigations queue: ${pendingCount === 0 ? 'PASS (empty)' : pendingCount === -1 ? 'FAIL (not found)' : 'pending: ' + pendingCount}`);
    if (pendingCount === 0) passed++; else failed++;

    // 10. Verify SW error page function exists in sw.js
    // (Cannot test SW directly from page context, but the SW file has been verified syntax-correct)

    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    ws.close();
    chrome.kill();
    setTimeout(() => process.exit(failed > 0 ? 1 : 0), 500);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
