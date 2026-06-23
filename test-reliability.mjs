// Reliability diagnostic — validates all navigation paths
import { spawn } from 'child_process';
import http from 'http';
import WebSocket from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9250;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fetchJSON = url => new Promise((resolve, reject) => {
  http.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }); }).on('error', reject);
});

function evalVal(r) {
  if (!r || !r.result || !r.result.result) return undefined;
  return r.result.result.value;
}

async function main() {
  // Kill previous
  try { await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); await sleep(2000); } catch (e) {}

  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--disable-popup-blocking', '--disable-default-apps',
    '--allow-insecure-localhost', '--disable-web-security',
    '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-reliability-' + Date.now(),
    'http://127.0.0.1:8080/'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let v;
  for (let i = 0; i < 20; i++) { try { v = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch (e) { await sleep(1000); } }
  if (!v) { console.log('FAIL: Chrome did not start'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', v.Browser);

  let pt;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try { const t = await fetchJSON(`http://127.0.0.1:${PORT}/json`); pt = t.find(x => x.type === 'page'); if (pt) break; } catch (e) {}
  }
  if (!pt) { console.log('FAIL: No page target'); chrome.kill(); process.exit(1); }
  console.log('Page:', pt.url);

  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pend = {}, logs = [], errors = [];
  let testsPassed = 0, testsFailed = 0;

  function send(m, p) {
    p = p || {};
    return new Promise(r => {
      const id = ++mid;
      pend[id] = r;
      ws.send(JSON.stringify({ id, method: m, params: p }));
      setTimeout(() => { if (pend[id]) { delete pend[id]; r({}) } }, 15000);
    });
  }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        logs.push(m.params.args.map(a => a.value || a.description || JSON.stringify(a)).join(' '));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        errors.push(m.params.exceptionDetails.text);
      }
      if (m.method === 'Log.entryAdded') {
        if (m.params.entry.level === 'error') errors.push(m.params.entry.text);
      }
      if (m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
    } catch (e) {}
  });

  function test(name, fn) {
    return async () => {
      try {
        const result = await fn();
        if (result === true) {
          console.log(`  PASS: ${name}`);
          testsPassed++;
        } else {
          console.log(`  FAIL: ${name} — ${result}`);
          testsFailed++;
        }
      } catch (e) {
        console.log(`  FAIL: ${name} — ${e.message}`);
        testsFailed++;
      }
    };
  }

  ws.on('open', async () => {
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Console.enable');
    await send('Log.enable');
    await send('Runtime.runIfWaitingForDebugger');

    console.log('\n=== Reliability Diagnostic Tests ===\n');

    // Wait for boot
    await sleep(5000);

    const tests = [
      test('1. window.__UV_BOOT_STATUS__ exists', async () => {
        const r = await send('Runtime.evaluate', { expression: 'typeof window.__UV_BOOT_STATUS__ !== "undefined"', returnByValue: true });
        return evalVal(r) === true ? true : '__UV_BOOT_STATUS__ not defined';
      }),

      test('2. window.encodeUVUrl is a function', async () => {
        const r = await send('Runtime.evaluate', { expression: 'typeof window.encodeUVUrl === "function"', returnByValue: true });
        return evalVal(r) === true ? true : 'encodeUVUrl not a function';
      }),

      test('3. Service worker registered (portReady reached within 15s)', async () => {
        for (let i = 0; i < 30; i++) {
          const r = await send('Runtime.evaluate', { expression: 'window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__.portReady === true', returnByValue: true });
          if (evalVal(r) === true) return true;
          await sleep(500);
        }
        return 'portReady never became true';
      }),

      test('4. BrowserUI._pendingNavigations array exists', async () => {
        const r = await send('Runtime.evaluate', { expression: 'Array.isArray(window.VoltraBrowser && window.VoltraBrowser._browserUI && window.VoltraBrowser._browserUI._pendingNavigations)', returnByValue: true });
        return evalVal(r) === true ? true : '_pendingNavigations not found';
      }),

      test('5. BrowserUI._flushPendingNavigations is a function', async () => {
        const r = await send('Runtime.evaluate', { expression: 'typeof (window.VoltraBrowser && window.VoltraBrowser._browserUI && window.VoltraBrowser._browserUI._flushPendingNavigations) === "function"', returnByValue: true });
        return evalVal(r) === true ? true : '_flushPendingNavigations not a function';
      }),

      test('6. isBraveHome recognizes orbit://home', async () => {
        const r = await send('Runtime.evaluate', { expression: 'typeof isBraveHome === "function" ? isBraveHome("orbit://home") : "isBraveHome not found"', returnByValue: true });
        return evalVal(r) === true ? true : `isBraveHome("orbit://home") returned ${evalVal(r)}`;
      }),

      test('7. normalizeUrl preserves orbit://home', async () => {
        const r = await send('Runtime.evaluate', { expression: 'typeof normalizeUrl === "function" ? normalizeUrl("orbit://home") : "normalizeUrl not found"', returnByValue: true });
        return evalVal(r) === 'orbit://home' ? true : `normalizeUrl("orbit://home") = ${evalVal(r)}`;
      }),

      test('8. Browser iframe has onerror handler', async () => {
        const r = await send('Runtime.evaluate', { expression: 'var f = document.getElementById("browserFrame-main"); f && f.getAttribute("onerror") ? true : false', returnByValue: true });
        return evalVal(r) === true ? true : 'browser iframe missing onerror';
      }),

      test('9. Navigate to home (voltra://brave-home) works', async () => {
        await send('Runtime.evaluate', { expression: 'if(window.VoltraBrowser) VoltraBrowser.navigate("voltra://brave-home")' });
        await sleep(1000);
        const r = await send('Runtime.evaluate', { expression: 'var f = document.getElementById("browserFrame-main"); f ? (f.srcdoc ? f.srcdoc.length : "(no srcdoc)") : "no iframe"', returnByValue: true });
        const len = evalVal(r);
        return (typeof len === 'number' && len > 100) ? true : `Home page srcdoc too short: ${len}`;
      }),

      test('10. Navigate to orbit://home works (bug fix)', async () => {
        await send('Runtime.evaluate', { expression: 'if(window.VoltraBrowser) VoltraBrowser.navigate("orbit://home")' });
        await sleep(1000);
        const r = await send('Runtime.evaluate', { expression: 'var f = document.getElementById("browserFrame-main"); f ? (f.srcdoc ? f.srcdoc.length : JSON.stringify(f.src).substring(0,80)) : "no iframe"', returnByValue: true });
        const val = evalVal(r);
        if (typeof val === 'number' && val > 100) return true;
        if (typeof val === 'string' && val.includes('/service/')) return `orbit://home was UV-encoded instead of srcdoc: ${val}`;
        return `Unexpected result: ${val}`;
      }),

      test('11. Navigate to orbit://settings works', async () => {
        await send('Runtime.evaluate', { expression: 'if(window.VoltraBrowser) VoltraBrowser.navigate("orbit://settings")' });
        await sleep(1000);
        const r = await send('Runtime.evaluate', { expression: 'var f = document.getElementById("browserFrame-main"); f ? (f.srcdoc ? f.srcdoc.length : "(no srcdoc)") : "no iframe"', returnByValue: true });
        const len = evalVal(r);
        return (typeof len === 'number' && len > 100) ? true : `Settings page srcdoc too short: ${len}`;
      }),
    ];

    for (const t of tests) {
      await t();
    }

    console.log(`\n=== Results: ${testsPassed} passed, ${testsFailed} failed ===`);
    if (errors.length) {
      console.log('\nErrors detected:');
      errors.forEach(e => console.log('  ', e));
    }
    console.log('\nConsole logs (reliability-related):');
    const relLogs = logs.filter(l => l.includes('[DEFER') || l.includes('[GAME') || l.includes('[RECOVERY') || l.includes('[PORT') || l.includes('[FLUSH') || l.includes('[UV-ROUTE') || l.includes('[RESTORE'));
    relLogs.forEach(l => console.log('  ', l));

    ws.close();
    chrome.kill();
    setTimeout(() => process.exit(testsFailed > 0 ? 1 : 0), 500);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
