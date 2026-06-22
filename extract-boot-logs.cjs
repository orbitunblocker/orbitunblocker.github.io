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

// CDP Runtime.evaluate response format:
// {id, result: {result: {type, value, description}}}
function evalValue(resp) {
  if (!resp || !resp.result || !resp.result.result) return undefined;
  return resp.result.result.value;
}

async function main() {
  // Kill stale Chrome
  try {
    await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`);
    console.log('Killing stale Chrome');
    try { await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/close`); } catch(e) {}
    await sleep(2000);
  } catch (e) {}

  console.log('Starting Chrome (old headless)...');
  const stderrChunks = [];
  const chrome = spawn(CHROME, [
    '--headless', `--remote-debugging-port=${DEBUG_PORT}`,
    '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-extensions',
    '--disable-popup-blocking', '--disable-default-apps',
    URL
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  chrome.stderr.on('data', (d) => stderrChunks.push(d.toString()));

  // Wait for Chrome
  let versionData;
  for (let i = 0; i < 30; i++) {
    try { versionData = await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`); break; }
    catch (e) { await sleep(1000); }
  }
  if (!versionData) { console.log('Chrome never started'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', versionData.Browser);

  // Get page target from /json
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

  // Connect to page WS
  const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.on('open', resolve); ws.on('error', reject);
    ws.on('close', () => reject(new Error('WS closed')));
    setTimeout(() => reject(new Error('WS timeout')), 15000);
  });

  let msgId = 0;
  const pending = {};
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.id && pending[msg.id]) { pending[msg.id](msg); delete pending[msg.id]; }
    } catch(e) {}
  });
  ws.on('close', () => { for (const id of Object.keys(pending)) pending[id](null); });

  function send(method, params = {}) {
    return new Promise((resolve) => {
      const id = ++msgId;
      pending[id] = resolve;
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (pending[id]) { delete pending[id]; resolve(null); } }, 15000);
    });
  }

  // Collect console
  const allConsole = [];
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.method === 'Runtime.consoleAPICalled') {
        const args = (msg.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
        allConsole.push({ text: args, ts: msg.params.timestamp });
      }
    } catch(e) {}
  });

  await send('Page.enable');
  await send('Runtime.enable');

  // Wait for the page to have a real document
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const r = await send('Runtime.evaluate', {
      expression: 'document.readyState',
      returnByValue: true
    });
    const state = evalValue(r);
    if (state === 'complete' || state === 'interactive') { ready = true; break; }
    await sleep(500);
  }
  console.log('Page ready state: ' + (ready ? 'loaded' : 'timeout'));

  // Check what URL we're on
  const urlVal = evalValue(await send('Runtime.evaluate', {
    expression: 'window.location.href', returnByValue: true
  }));
  console.log('URL:', urlVal);

  // If not on the right URL or if we need a fresh load, reload
  if (urlVal && urlVal.indexOf('localhost:8080') !== -1) {
    console.log('Already on Orbit page, reloading for clean state');
    await send('Page.reload');
  } else {
    console.log('Navigating to', URL);
    await send('Page.navigate', { url: URL });
  }

  // Wait for __UV_BOOT_STATUS__
  for (let i = 0; i < 60; i++) {
    const r = await send('Runtime.evaluate', {
      expression: 'typeof window.__UV_BOOT_STATUS__ !== "undefined" && window.__UV_BOOT_STATUS__ !== null',
      returnByValue: true
    });
    if (evalValue(r) === true) {
      console.log('__UV_BOOT_STATUS__ found after', i+1, 's');
      break;
    }
    if (i % 5 === 0) {
      // Check page state
      const state = evalValue(await send('Runtime.evaluate', {
        expression: 'document.readyState', returnByValue: true
      }));
      console.log('  waiting... readyState=' + state + ' at ' + (i+1) + 's');
    }
    await sleep(1000);
  }

  // Wait for SW init
  console.log('Waiting 20s for SW...');
  await sleep(20000);

  // Get boot log
  console.log('\n=== __UV_BOOT_STATUS__._log ===');
  const logR = await send('Runtime.evaluate', {
    expression: 'JSON.stringify(window.__UV_BOOT_STATUS__._log)',
    returnByValue: true
  });
  const logVal = evalValue(logR);
  if (logVal) {
    try {
      const d = JSON.parse(logVal);
      for (const e of d) console.log(`[${e.at}] ${e.key} = ${e.val}`);
    } catch(e) { console.log('Parse error:', logVal); }
  } else {
    console.log('No log result:', JSON.stringify(logR));
  }

  // Final state
  const sR = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({swReady:window.__UV_BOOT_STATUS__.swReady,portReady:window.__UV_BOOT_STATUS__.portReady,bareMuxReady:window.__UV_BOOT_STATUS__.bareMuxReady,failedStage:window.__UV_BOOT_STATUS__.failedStage})',
    returnByValue: true
  });
  const sVal = evalValue(sR);
  console.log('\n=== Final state ===\n' + (sVal || 'N/A'));

  // Console boot logs
  console.log('\n=== Console [BOOT*] logs ===');
  for (const e of allConsole) {
    if (e.text.includes('[BOOT')) console.log(`[${e.ts || '?'}] ${e.text}`);
  }

  chrome.kill(); ws.close();
  setTimeout(() => process.exit(0), 500);
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
