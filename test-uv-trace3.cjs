const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9224;
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
        setTimeout(() => { if (pending[id]) { delete pending[id]; resolve(null); } }, 20000);
      });
    };
    ws.addConsoleCapture = function() {
      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.method === 'Runtime.consoleAPICalled') {
            const args = (msg.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || JSON.stringify(a))).join(' ');
            console.log(`[PAGE] ${args}`);
          }
          if (msg.method === 'Runtime.exceptionThrown') {
            console.log(`[EXCEPTION] ${msg.params.exceptionDetails.text}`);
            if (msg.params.exceptionDetails.exception) {
              console.log(`  ${msg.params.exceptionDetails.exception.description}`);
            }
          }
        } catch(e) {}
      });
    };
  });
}

async function main() {
  try {
    await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`);
    console.log('Killing stale Chrome on 9224');
    try { await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/close`); } catch(e) {}
    await sleep(2000);
  } catch (e) {}

  console.log('Starting Chrome...');
  const chrome = spawn(CHROME, [
    '--headless', `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-extensions',
    '--disable-popup-blocking', '--disable-default-apps',
    'http://localhost:8080'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let versionData;
  for (let i = 0; i < 30; i++) {
    try { versionData = await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`); break; }
    catch (e) { await sleep(1000); }
  }
  if (!versionData) { console.log('Chrome never started'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', versionData.Browser);

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
  pageWS.addConsoleCapture();
  await pageWS.sendCDP('Page.enable');
  await pageWS.sendCDP('Runtime.enable');

  // Wait for UV boot status 
  for (let i = 0; i < 40; i++) {
    const r = await pageWS.sendCDP('Runtime.evaluate', {
      expression: 'typeof window.__UV_BOOT_STATUS__ !== "undefined"', returnByValue: true
    });
    if (evalValue(r)) break;
    await sleep(500);
  }

  // Wait for SW + init to settle
  await sleep(6000);

  // Get boot log
  const bootLogRaw = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__UV_BOOT_STATUS__)', returnByValue: true
  }));
  console.log('\n=== __UV_BOOT_STATUS__ ===\n' + bootLogRaw);

  // Check VoltraBrowser / browserUI
  const vb = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
    expression: 'typeof window.VoltraBrowser !== "undefined"', returnByValue: true
  }));
  console.log('VoltraBrowser exists:', vb);

  if (vb) {
    // Check if _browserUI exists
    const bu = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
      expression: 'typeof window.VoltraBrowser._browserUI !== "undefined"', returnByValue: true
    }));
    console.log('_browserUI exists:', bu);

    if (bu) {
      // Get active tab
      const tabInfo = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: `
          (function() {
            var ui = window.VoltraBrowser._browserUI;
            var tm = ui.tabManager;
            var tab = tm.getActiveTab();
            if (!tab) {
              // Try creating one
              if (typeof tm.createTab === 'function') {
                tm.createTab('https://example.com');
                return 'created tab';
              }
              return 'no tab, no createTab';
            }
            return 'active tab: ' + tab.id + ' url: ' + (tab.url || 'none');
          })()
        `,
        returnByValue: true
      }));
      console.log('Tab status:', tabInfo);

      await sleep(500);

      // Navigate to example.com
      console.log('\n--- Navigating to https://example.com ---');
      console.log( evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: `
          (function() {
            var ui = window.VoltraBrowser._browserUI;
            if (!ui || typeof ui._loadUrlInActiveTab !== 'function') return 'no _loadUrlInActiveTab';
            ui._loadUrlInActiveTab('https://example.com');
            return 'navigated';
          })()
        `,
        returnByValue: true
      })));

      await sleep(1000);

      // Check __UV_ROUTE_DEBUG__
      const rd = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__UV_ROUTE_DEBUG__)', returnByValue: true
      }));
      console.log('\n=== __UV_ROUTE_DEBUG__ ===\n' + rd);

      // Check iframe src
      const iframeSrc = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: `
          (function() {
            var ui = window.VoltraBrowser._browserUI;
            if (!ui || !ui.tabManager) return 'no tabManager';
            var tab = ui.tabManager.getActiveTab();
            if (!tab) return 'no active tab';
            var iframe = document.getElementById('browserFrame-' + tab.id);
            return iframe ? iframe.src : 'no iframe element for ' + tab.id;
          })()
        `,
        returnByValue: true
      }));
      console.log('IFrame src:', iframeSrc);

      // Wait and check port state again
      await sleep(5000);

      const bootRaw2 = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__UV_BOOT_STATUS__)', returnByValue: true
      }));
      console.log('\n=== __UV_BOOT_STATUS__ (after 5s) ===\n' + bootRaw2);

      // Check SW state via syncPortStateFromSW
      const swState = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: `
          (function() {
            // Try to send a manual sync
            if (typeof window.syncPortStateFromSW === 'function') {
              window.syncPortStateFromSW();
              return 'syncRequested';
            }
            return 'no syncPortStateFromSW';
          })()
        `,
        returnByValue: true
      }));
      console.log('SW state:', swState);

      await sleep(3000);

      const bootRaw3 = evalValue(await pageWS.sendCDP('Runtime.evaluate', {
        expression: 'JSON.stringify(window.__UV_BOOT_STATUS__)', returnByValue: true
      }));
      console.log('\n=== __UV_BOOT_STATUS__ (after resync) ===\n' + bootRaw3);
    }
  }

  chrome.kill();
  setTimeout(() => process.exit(0), 500);
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
