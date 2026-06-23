// Trace every navigation entry point through the full pipeline.
// Usage: node trace-entrypoints.cjs  (after: node server.js in another terminal)

const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}
function evalValue(r) { if(!r||!r.result||!r.result.result)return undefined; return r.result.result.value; }

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {}, logs = [];
    ws.on('open', () => resolve({
      ws, logs,
      send: (m, p = {}) => new Promise(r => {
        const id = ++mid; pend[id] = r;
        ws.send(JSON.stringify({id, method: m, params: p}));
        setTimeout(() => { if(pend[id]) { delete pend[id]; r({}); }}, 20000);
      })
    }));
    ws.on('error', reject);
    ws.on('close', () => { for(const k of Object.keys(pend)) pend[k]({}); });
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        if(m.method === 'Runtime.consoleAPICalled') {
          logs.push('[PAGE] ' + (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' '));
        }
        if(m.method === 'Runtime.exceptionThrown') {
          logs.push('[PAGE-EXC] ' + (m.params.exceptionDetails?.text || '') + ' ' + (m.params.exceptionDetails?.exception?.description || ''));
        }
        if(m.method === 'Log.entryAdded') {
          logs.push('[PAGE-LOG] ' + (m.params.entry?.text || '') + ' ' + (m.params.entry?.source || ''));
        }
      } catch(e) {}
    });
  });
}

function jstr(v) { try { return JSON.parse(v||'null'); } catch(e) { return v; } }

async function getFrameInfo(cdp, label) {
  const raw = {
    rd: await cdp.send('Runtime.evaluate', { expression: `JSON.stringify(window.__UV_ROUTE_DEBUG__ || {})`, returnByValue: true }),
    boot: await cdp.send('Runtime.evaluate', { expression: `JSON.stringify((function(){var b=window.__UV_BOOT_STATUS__||{};return{portReady:b.portReady,swActivated:b.swActivated,bareMuxReady:b.bareMuxReady,swPortStatus:b.swPortStatus,failedStage:b.failedStage}})())`, returnByValue: true }),
    bf: await cdp.send('Runtime.evaluate', { expression: `JSON.stringify((function(){var f=document.getElementById('browserFrame-main');return f?{id:f.id,src:(f.src||'').substring(0,200),hasSrcdoc:!!f.srcdoc,srcdocLen:(f.srcdoc||'').length}:{err:'no browserFrame-main'}})())`, returnByValue: true }),
    gf: await cdp.send('Runtime.evaluate', { expression: `JSON.stringify((function(){var f=document.getElementById('gameFrame');return f?{id:f.id,src:(f.src||'').substring(0,200),hasSrcdoc:!!f.srcdoc,dataSrc:f.getAttribute('data-src')||''}:{err:'no gameFrame'}})())`, returnByValue: true }),
    loads: await cdp.send('Runtime.evaluate', { expression: `JSON.stringify(window.__NAV_EVENTS__||[])`, returnByValue: true }),
    active: await cdp.send('Runtime.evaluate', { expression: `(function(){var e=document.activeElement;return e?e.tagName+(e.id?'#'+e.id:'')+(e.className?'."'+e.className+'"':''):'none'})()`, returnByValue: true }),
    mounts: await cdp.send('Runtime.evaluate', { expression: `JSON.stringify((function(){var m=document.getElementById('browserMount');return m?{exists:true,childCount:m.children.length,innerHTMLlen:m.innerHTML.length}:{err:'no browserMount'}})())`, returnByValue: true }),
    pg: await cdp.send('Runtime.evaluate', { expression: `JSON.stringify((function(){return document.querySelector('.game-page-fullscreen')?{exists:true,hide:!!document.querySelector('.game-page-fullscreen[style*="display:none"]')}:null})())`, returnByValue: true }),
  };
  console.log(`\n--- ${label} ---`);
  console.log('BOOT:', jstr(evalValue(raw.boot)));
  console.log('ROUTE_DEBUG:', jstr(evalValue(raw.rd)));
  console.log('browserFrame:', jstr(evalValue(raw.bf)));
  console.log('gameFrame:', jstr(evalValue(raw.gf)));
  console.log('browserMount:', jstr(evalValue(raw.mounts)));
  console.log('gamePageFullscreen:', jstr(evalValue(raw.pg)));
  console.log('activeElement:', evalValue(raw.active));
  const l = jstr(evalValue(raw.loads));
  if (l && l.length) console.log('NAV_EVENTS:', l);
}

async function waitForPortReady(cdp, timeoutSec) {
  for(let i=0;i<timeoutSec*2;i++) {
    const r = evalValue(await cdp.send('Runtime.evaluate', {
      expression: `window.__UV_BOOT_STATUS__?.portReady === true`,
      returnByValue: true
    }));
    if(r === true) { return true; }
    await sleep(500);
  }
  return false;
}

async function setupNavCapture(cdp) {
  // Instrument _loadUrlInFrame and openGame to record events
  await cdp.send('Runtime.evaluate', {expression: `
    (function(){
      if(window.__NAV_TRACE_INSTALLED__) return;
      window.__NAV_EVENTS__ = [];
      window.__NAV_TRACE_INSTALLED__ = true;
      var origLoad = window.VoltraBrowser._browserUI._loadUrlInFrame;
      if(origLoad) {
        window.VoltraBrowser._browserUI._loadUrlInFrame = function(url) {
          window.__NAV_EVENTS__.push({ts:Date.now(),type:'_loadUrlInFrame',url:url});
          console.log('[ENTRY_TRACE] _loadUrlInFrame called with:', url);
          return origLoad.call(this, url);
        };
      }
      var origRestore = window.VoltraBrowser._browserUI._restoreTabUrl;
      if(origRestore) {
        window.VoltraBrowser._browserUI._restoreTabUrl = function(url) {
          window.__NAV_EVENTS__.push({ts:Date.now(),type:'_restoreTabUrl',url:url});
          console.log('[ENTRY_TRACE] _restoreTabUrl called with:', url);
          return origRestore.call(this, url);
        };
      }
      var origNav = window.VoltraBrowser.navigate;
      if(origNav) {
        window.VoltraBrowser.navigate = function(url) {
          window.__NAV_EVENTS__.push({ts:Date.now(),type:'navigate',url:url});
          console.log('[ENTRY_TRACE] navigate called with:', url);
          return origNav.call(this, url);
        };
      }
      // Capture iframe load events
      document.addEventListener('DOMContentLoaded', function() {
        var f = document.getElementById('browserFrame-main');
        if(f) {
          f.addEventListener('load', function() {
            window.__NAV_EVENTS__.push({ts:Date.now(),type:'browserFrame-load',src:f.src.substring(0,200)});
            console.log('[ENTRY_TRACE] browserFrame-main loaded, src:', f.src.substring(0,200));
          });
          f.addEventListener('error', function() {
            window.__NAV_EVENTS__.push({ts:Date.now(),type:'browserFrame-error',src:f.src.substring(0,200)});
            console.log('[ENTRY_TRACE] browserFrame-main ERROR');
          });
        }
      });
      console.log('[ENTRY_TRACE] instrumentation installed');
    })()
  `});
}

async function main() {
  const PORT = 9240;
  // Kill any existing Chrome on debug port
  try { await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); await fetchJSON(`http://127.0.0.1:${PORT}/json/close`); await sleep(2000); } catch(e) {}

  console.log('Starting Chrome...');
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--disable-popup-blocking', '--disable-default-apps',
    '--allow-insecure-localhost', '--disable-web-security',
    '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-test-' + Date.now(),
    'http://127.0.0.1:8080/'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let v;
  for(let i=0;i<30;i++) { try { v = await fetchJSON(`http://127.0.0.1:${PORT}/json/version`); break; } catch(e) { await sleep(1000); } }
  if (!v) { console.log('Chrome fail'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', v.Browser);

  let pt;
  for(let i=0;i<20;i++) { await sleep(500); try { const t = await fetchJSON(`http://127.0.0.1:${PORT}/json`); pt = t.find(x => x.type === 'page'); if(pt) break; } catch(e) {} }
  if (!pt) { console.log('No page target'); chrome.kill(); process.exit(1); }

  const cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');

  // Wait for page + SW boot
  console.log('=== Waiting for boot completion ===');
  let bootFound = false, swActivated = false;
  for(let i=0;i<60;i++) {
    if(!bootFound) {
      const r = evalValue(await cdp.send('Runtime.evaluate', { expression: `typeof window.__UV_BOOT_STATUS__ !== 'undefined'`, returnByValue: true }));
      if(r === true) { bootFound = true; console.log('__UV_BOOT_STATUS__ found after', (i+1)*1, 's'); }
    }
    if(bootFound && !swActivated) {
      const r = evalValue(await cdp.send('Runtime.evaluate', { expression: `window.__UV_BOOT_STATUS__.swActivated === true`, returnByValue: true }));
      if(r === true) { swActivated = true; console.log('SW activated after', (i+1)*1, 's'); }
    }
    if(bootFound && swActivated) break;
    await sleep(1000);
  }
  console.log('bootFound:', bootFound, 'swActivated:', swActivated);

  const portReady = await waitForPortReady(cdp, 30);
  console.log('portReady:', portReady);
  await setupNavCapture(cdp);
  await sleep(500);

  // ============ TEST 1: Browser Startup via loadSection('browser') ============
  console.log('\n' + '='.repeat(70));
  console.log('TEST 1: Browser startup (loadSection -> loadBrowserPage -> render -> _restoreTabUrl)');
  console.log('='.repeat(70));
  await cdp.send('Runtime.evaluate', {expression: `loadSection('browser')`});
  await sleep(2000);
  await getFrameInfo(cdp, 'TEST 1 result');

  // ============ TEST 2: Address bar navigate to example.com ============
  console.log('\n' + '='.repeat(70));
  console.log('TEST 2: Address bar navigate to https://example.com');
  console.log('='.repeat(70));
  await cdp.send('Runtime.evaluate', {expression: `VoltraBrowser.navigate('https://example.com')`});
  await sleep(5000);
  await getFrameInfo(cdp, 'TEST 2 result (5s after navigate)');

  // Check iframe content
  const iframeContentAfter = evalValue(await cdp.send('Runtime.evaluate', {
    expression: `(function(){try{var f=document.getElementById('browserFrame-main');if(!f)return'no iframe';var d=f.contentDocument||f.contentWindow?.document;if(!d)return'no doc access';return{title:d.title,bodyLen:(d.body?.innerText||'').length,readyState:d.readyState,url:d.URL?d.URL.substring(0,200):'no URL',isErrorPage:(d.body?.innerHTML||'').includes('Error processing')||(d.body?.innerHTML||'').includes('Failed to load')}}catch(e){return'err:'+e.message}})()`,
    returnByValue: true
  }));
  console.log('iframe content:', jstr(iframeContentAfter));

  // ============ TEST 3: Game launch ============
  console.log('\n' + '='.repeat(70));
  console.log('TEST 3: Game launch (openGame)');
  console.log('='.repeat(70));
  // First, check if there are games available
  const gameIdx = evalValue(await cdp.send('Runtime.evaluate', {
    expression: `(function(){return window.gameIndex?Object.keys(window.gameIndex).slice(0,3).map(function(k){return{id:k,url:window.gameIndex[k].url,title:window.gameIndex[k].title}}):'no gameIndex'})()`,
    returnByValue: true
  }));
  console.log('Available games:', gameIdx);

  // Launch first game if available
  if(gameIdx && Array.isArray(gameIdx) && gameIdx.length > 0) {
    const gameId = gameIdx[0].id;
    await cdp.send('Runtime.evaluate', {expression: `openGame('${gameId}')`});
    await sleep(3000);
    await getFrameInfo(cdp, `TEST 3 result (game: ${gameId})`);
    
    // Check game iframe content
    const gameContent = evalValue(await cdp.send('Runtime.evaluate', {
      expression: `(function(){try{var f=document.getElementById('gameFrame');if(!f)return'no iframe';var d=f.contentDocument||f.contentWindow?.document;if(!d)return'no doc access';return{title:d.title,bodyLen:(d.body?.innerText||'').length,readyState:d.readyState,isErrorPage:(d.body?.innerHTML||'').includes('Error processing')}}catch(e){return'err:'+e.message}})()`,
      returnByValue: true
    }));
    console.log('game iframe content:', jstr(gameContent));
  } else {
    console.log('SKIP: no games available');
  }

  // ============ TEST 4: Quicklink / bookmark navigate ============
  console.log('\n' + '='.repeat(70));
  console.log('TEST 4: Quicklink navigate to https://en.wikipedia.org');
  console.log('='.repeat(70));
  // Go back to browser section first
  await cdp.send('Runtime.evaluate', {expression: `loadSection('browser')`});
  await sleep(2000);
  await cdp.send('Runtime.evaluate', {expression: `VoltraBrowser.navigate('https://en.wikipedia.org')`});
  await sleep(5000);
  await getFrameInfo(cdp, 'TEST 4 result (5s after navigate)');
  
  const wikiContent = evalValue(await cdp.send('Runtime.evaluate', {
    expression: `(function(){try{var f=document.getElementById('browserFrame-main');if(!f)return'no iframe';var d=f.contentDocument||f.contentWindow?.document;if(!d)return'no doc access';return{title:d.title,bodyLen:(d.body?.innerText||'').length,readyState:d.readyState,isErrorPage:(d.body?.innerHTML||'').includes('Error processing')}}catch(e){return'err:'+e.message}})()`,
    returnByValue: true
  }));
  console.log('iframe content:', jstr(wikiContent));

  // ============ TEST 5: Home button ============
  console.log('\n' + '='.repeat(70));
  console.log('TEST 5: Home button (navigate to BRAVE_HOME_INTERNAL)');
  console.log('='.repeat(70));
  await cdp.send('Runtime.evaluate', {expression: `VoltraBrowser.navigate('orbit://home')`});
  await sleep(1000);
  await getFrameInfo(cdp, 'TEST 5 result');

  // ============ TEST 6: Settings page ============
  console.log('\n' + '='.repeat(70));
  console.log('TEST 6: Settings page (navigate to orbit://settings)');
  console.log('='.repeat(70));
  await cdp.send('Runtime.evaluate', {expression: `VoltraBrowser.navigate('orbit://settings')`});
  await sleep(1000);
  await getFrameInfo(cdp, 'TEST 6 result');

  // ============ Print all console logs ============
  console.log('\n' + '='.repeat(70));
  console.log('ALL CONSOLE LOGS (filtered)');
  console.log('='.repeat(70));
  const relevant = cdp.logs.filter(l =>
    l.includes('[UV-ROUTE]') || l.includes('[ENTRY_TRACE]') ||
    l.includes('[RESTORE]') || l.includes('[DEFER]') ||
    l.includes('[BOOT]') || l.includes('[PORT_SYNC]') ||
    l.includes('[EXCEPTION]') || l.includes('[PAGE-EXC]') ||
    l.includes('Error') || l.includes('error') ||
    l.includes('ERR') || l.includes('fail')
  );
  for(const l of relevant) console.log(l);

  // Extra: all logs if few
  if(cdp.logs.length < 50) {
    console.log('\nALL ' + cdp.logs.length + ' logs:');
    for(const l of cdp.logs) console.log(l);
  }

  // ============ Cleanup ============
  cdp.ws.close();
  chrome.kill();
  setTimeout(() => process.exit(0), 500);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
