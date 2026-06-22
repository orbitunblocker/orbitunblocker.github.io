const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8080';
const DEBUG_PORT = 9222;
const DEBUG_HOST = '127.0.0.1';
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { reject(e); } });
    }).on('error', reject);
  });
}
function evalValue(resp) {
  if (!resp || !resp.result || !resp.result.result) return undefined;
  return resp.result.result.value;
}
function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let msgId = 0;
    const pending = {};
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
    ws.on('close', () => { for (const id of Object.keys(pending)) pending[id](null); });
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
      } catch(e) {}
    });
    ws.sendCDP = function(method, params = {}) {
      return new Promise((resolve) => {
        const id = ++msgId;
        pending[id] = resolve;
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => { if (pending[id]) { delete pending[id]; resolve(null); } }, 15000);
      });
    };
  });
}

async function main() {
  // Kill stale Chrome
  try {
    await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`);
    console.log('Killing stale Chrome');
    try { await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/close`); } catch(e) {}
    await sleep(2000);
  } catch (e) {}

  console.log('Starting Chrome headless...');
  const chrome = spawn(CHROME, [
    '--headless', `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-extensions',
    '--disable-popup-blocking', '--disable-default-apps',
    URL
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  // Wait for Chrome
  let versionData;
  for (let i = 0; i < 30; i++) {
    try { versionData = await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`); break; }
    catch (e) { await sleep(1000); }
  }
  if (!versionData) { console.log('Chrome never started'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', versionData.Browser);

  // Get page target
  let pageTarget;
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    try {
      const targets = await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json`);
      pageTarget = targets.find(t => t.type === 'page');
      if (pageTarget) break;
    } catch (e) {}
  }
  if (!pageTarget) { console.log('No page target'); chrome.kill(); process.exit(1); }
  console.log('Page:', pageTarget.url);

  // Connect to page
  const pageWS = await connectCDP(pageTarget.webSocketDebuggerUrl);
  const allConsole = { page: [], sw: [] };
  pageWS.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
        allConsole.page.push({ text: args, ts: msg.params.timestamp });
      }
    } catch(e) {}
  });
  await pageWS.sendCDP('Page.enable');
  await pageWS.sendCDP('Runtime.enable');

  // Wait for page load
  for (let i = 0; i < 30; i++) {
    const r = await pageWS.sendCDP('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
    if (evalValue(r) === 'complete') break;
    await sleep(500);
  }
  console.log('Page loaded');

  // Wait for SW registration (up to 30s)
  let swReady = false;
  for (let i = 0; i < 60; i++) {
    const r = await pageWS.sendCDP('Runtime.evaluate', {
      expression: 'typeof window.__UV_BOOT_STATUS__ !== "undefined" && window.__UV_BOOT_STATUS__.swReady === true',
      returnByValue: true
    });
    if (evalValue(r) === true) { swReady = true; console.log('SW ready after', i+1, 's'); break; }
    await sleep(500);
  }

  if (!swReady) {
    console.log('SW NOT ready after 30s. Checking boot status...');
    const bs = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__UV_BOOT_STATUS__)', returnByValue: true
    }));
    console.log('__UV_BOOT_STATUS__:', bs);
  } else {
    // Wait a bit for SW to settle
    await sleep(3000);

    // Try to find SW target
    let swTarget;
    for (let i = 0; i < 10; i++) {
      await sleep(1000);
      const targets = await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json`);
      swTarget = targets.find(t => t.type === 'service_worker' || t.title === 'sw.js');
      if (swTarget) { console.log('SW target found'); break; }
    }

    if (swTarget) {
      console.log('Connecting to SW target...');
      const swWS = await connectCDP(swTarget.webSocketDebuggerUrl);
      await swWS.sendCDP('Runtime.enable');
      await swWS.sendCDP('Console.enable');
      swWS.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.method === 'Runtime.consoleAPICalled') {
            const args = (msg.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
            allConsole.sw.push({ text: args, ts: msg.params.timestamp });
          } else if (msg.method === 'Console.messageAdded') {
            allConsole.sw.push({ text: msg.params.message.text, ts: msg.params.message.timestamp });
          }
        } catch(e) {}
      });

      // Wait for SW init traces
      await sleep(3000);

      // Now navigate to example.com via the browser engine
      console.log('\n--- Navigating to https://example.com ---');
      // Use the page's browser engine
      await pageWS.sendCDP('Runtime.evaluate', {
        expression: `
          (function() {
            const url = 'https://example.com';
            if (window.browserUI && typeof window.browserUI._loadUrlInActiveTab === 'function') {
              window.browserUI._loadUrlInActiveTab(url);
              return 'navigated via _loadUrlInActiveTab';
            }
            // Fallback: try searchBraveTab
            if (window.browserUI && window.browserUI.tabManager) {
              const tab = window.browserUI.tabManager.getActiveTab();
              if (tab && typeof window.browserUI.searchBraveTab === 'function') {
                window.browserUI.searchBraveTab(tab.id);
                return 'navigated via searchBraveTab';
              }
            }
            return 'no browser UI found';
          })()
        `,
        returnByValue: true
      });
      console.log('Navigation result:', evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__UV_ROUTE_DEBUG__)', returnByValue: true
      })));

      // Wait for SW to process the request
      await sleep(5000);

      // Collect all SW trace logs
      console.log('\n=== SW CONSOLE LOGS (last 50) ===');
      const swLogs = allConsole.sw;
      for (const e of swLogs.slice(-50)) console.log(`[SW ${e.ts}] ${e.text}`);

      // Check UV boot status
      const bs = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__UV_BOOT_STATUS__)', returnByValue: true
      }));
      console.log('\n=== __UV_BOOT_STATUS__ ===');
      console.log(bs);

      // Check route debug
      const rd = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__UV_ROUTE_DEBUG__)', returnByValue: true
      }));
      console.log('\n=== __UV_ROUTE_DEBUG__ ===');
      console.log(rd);

      // Check SW response by evaluating if the proxy worked
      const iframeSrc = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: `
          (function() {
            const tab = window.browserUI && window.browserUI.tabManager && window.browserUI.tabManager.getActiveTab();
            if (!tab) return 'no active tab';
            const iframe = document.getElementById('browserFrame-' + tab.id);
            return iframe ? iframe.src : 'no iframe';
          })()
        `,
        returnByValue: true
      }));
      console.log('\n=== IFRAME SRC ===');
      console.log(iframeSrc);

      swWS.close();
    } else {
      console.log('SW target not found via CDP. Checking page console for logs...');
      // Wait a bit more and check
      await sleep(5000);
    }
  }

  // Page console logs containing [BOOT] or [TRACE]
  console.log('\n=== PAGE CONSOLE [BOOT*] / [TRACE] logs ===');
  for (const e of allConsole.page) {
    if (e.text.includes('[BOOT') || e.text.includes('[TRACE]') || e.text.includes('[UV-ROUTE]')) {
      console.log(`[PAGE ${e.ts}] ${e.text}`);
    }
  }

  chrome.kill();
  setTimeout(() => process.exit(0), 500);
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
