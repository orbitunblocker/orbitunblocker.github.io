const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = 'http://localhost:8080';
const DEBUG_PORT = 9223;
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
    ws.addConsoleCapture = function(target) {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.method === 'Runtime.consoleAPICalled') {
            const args = (msg.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
            console.log(`[${target} console] ${args}`);
          }
          if (msg.method === 'Runtime.exceptionThrown') {
            console.log(`[${target} exception]`, msg.params.exceptionDetails.text);
          }
        } catch(e) {}
      });
    };
  });
}

async function main() {
  // Kill stale Chrome on debug port
  try {
    await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`);
    console.log('Killing stale Chrome on 9223');
    try { await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/close`); } catch(e) {}
    await sleep(2000);
  } catch (e) {}

  console.log('Starting Chrome...');
  const chrome = spawn(CHROME, [
    '--headless', `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-extensions',
    '--disable-popup-blocking', '--disable-default-apps',
    URL
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let versionData;
  for (let i = 0; i < 30; i++) {
    try { versionData = await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`); break; }
    catch (e) { await sleep(1000); }
  }
  if (!versionData) { console.log('Chrome never started'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', versionData.Browser);

  // Find page target
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

  const pageWS = await connectCDP(pageTarget.webSocketDebuggerUrl);
  pageWS.addConsoleCapture('PAGE');
  await pageWS.sendCDP('Page.enable');
  await pageWS.sendCDP('Runtime.enable');

  // Wait for DOMContentLoaded + SW + UV init
  for (let i = 0; i < 40; i++) {
    const r = await pageWS.sendCDP('Runtime.evaluate', {
      expression: 'typeof window.__UV_BOOT_STATUS__ !== "undefined"',
      returnByValue: true
    });
    if (evalValue(r)) {
      console.log('__UV_BOOT_STATUS__ exists after', i+1, 's');
      break;
    }
    await sleep(500);
  }

  // Wait for SW
  await sleep(2000);

  // Check boot status
  const bs = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__UV_BOOT_STATUS__)', returnByValue: true
  }));
  console.log('\n=== __UV_BOOT_STATUS__ ===\n' + bs);

  // Check if browserUI exists
  const hasUI = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
    expression: 'typeof window.browserUI !== "undefined"', returnByValue: true
  }));
  console.log('browserUI exists:', hasUI);

  // Inject a tab and navigate to example.com
  if (hasUI) {
    // First ensure a tab exists
    const tabRes = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
      expression: `
        (function() {
          var ui = window.browserUI;
          if (!ui) return 'no ui';
          var tm = ui.tabManager;
          if (!tm) return 'no tabManager';
          var tabs = tm.tabs || {};
          var ids = Object.keys(tabs);
          if (ids.length === 0) {
            // Create a tab
            if (typeof tm.createTab === 'function') {
              tm.createTab('https://example.com');
              return 'tab created';
            }
            return 'no createTab method';
          }
          return 'active tab exists: ' + ids[0];
        })()
      `,
      returnByValue: true
    }));
    console.log('Tab init:', tabRes);

    await sleep(1000);

    // Navigate
    const navRes = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
      expression: `
        (function() {
          var ui = window.browserUI;
          if (!ui || typeof ui._loadUrlInActiveTab !== 'function') return 'no _loadUrlInActiveTab';
          ui._loadUrlInActiveTab('https://example.com');
          return 'navigated';
        })()
      `,
      returnByValue: true
    }));
    console.log('Navigation:', navRes);
    
    await sleep(1000);

    // Check route debug
    const rd = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__UV_ROUTE_DEBUG__)', returnByValue: true
    }));
    console.log('\n=== __UV_ROUTE_DEBUG__ ===\n' + (rd || 'empty'));

    // Check iframe
    const iframeSrc = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
      expression: `
        (function() {
          var ui = window.browserUI;
          if (!ui || !ui.tabManager) return 'no tabManager';
          var tab = ui.tabManager.getActiveTab();
          if (!tab) return 'no tab';
          var iframe = document.getElementById('browserFrame-' + tab.id);
          return iframe ? iframe.src : 'no iframe';
        })()
      `,
      returnByValue: true
    }));
    console.log('\n=== IFrame src ===\n' + iframeSrc);

    // Wait for SW processing
    console.log('\nWaiting 8s for SW to process...');
    await sleep(8000);

    // Check if SW was hit
    const bootLog = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
      expression: 'JSON.stringify(window.__UV_BOOT_STATUS__._log)', returnByValue: true
    }));
    console.log('\n=== Boot log after navigation ===\n' + (bootLog || 'empty'));
  }

  chrome.kill();
  setTimeout(() => process.exit(0), 500);
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
