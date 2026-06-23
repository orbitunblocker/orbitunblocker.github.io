// Single-pass navigation trace: early vs late navigation, all entry points.
// No source modifications — all instrumentation injected via CDP.

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
function evalValue(r) { if(!r||!r.result||!r.result.result) return undefined; return r.result.result.value; }

function now() { return Date.now(); }

async function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid = 0, pend = {};
    const logs = [];
    ws.on('open', () => resolve({
      ws, logs,
      send: (m, p = {}) => new Promise(r => {
        const id = ++mid; pend[id] = r;
        ws.send(JSON.stringify({id, method: m, params: p}));
        setTimeout(() => { if(pend[id]) { delete pend[id]; r({}); }}, 30000);
      })
    }));
    ws.on('error', reject);
    ws.on('close', () => { for(const k of Object.keys(pend)) pend[k]({}); });
    ws.on('message', d => {
      try {
        const m = JSON.parse(d.toString());
        if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
        if(m.method === 'Runtime.consoleAPICalled') {
          logs.push({ts: now(), msg: '[PAGE] ' + (m.params.args||[]).map(a => a.value !== undefined ? a.value : (a.description||'')).join(' ') });
        }
        if(m.method === 'Runtime.exceptionThrown') {
          logs.push({ts: now(), msg: '[EXC] ' + (m.params.exceptionDetails?.text||'') });
        }
        if(m.method === 'Network.requestWillBeSent') {
          logs.push({ts: now(), msg: '[REQ] ' + (m.params.type||'') + ' ' + m.params.request.url.substring(0,300) });
        }
        if(m.method === 'Network.responseReceived') {
          const r = m.params.response;
          logs.push({ts: now(), msg: '[RES] ' + (m.params.type||'') + ' ' + r.url.substring(0,200) + ' status=' + r.status + ' fromSW=' + r.fromServiceWorker });
        }
        if(m.method === 'Network.loadingFailed') {
          logs.push({ts: now(), msg: '[FAIL] ' + (m.params.type||'') + ' error=' + m.params.errorText + ' blocked=' + m.params.blockedReason + ' url=' + (m.params.documentURL||'') });
        }
      } catch(e) {}
    });
  });
}

async function injectInstrumentation(cdp) {
  await cdp.send('Runtime.evaluate', {expression: `
    (function(){
      if(window.__TRACE_INSTALLED__) return;
      window.__TRACE_INSTALLED__ = true;
      window.__NAV_TRACES__ = [];
      var t = function(type, data) {
        var entry = {ts: Date.now(), type: type, data: JSON.parse(JSON.stringify(data || {}))};
        window.__NAV_TRACES__.push(entry);
      };

      // Hook navigate
      var nav = window.VoltraBrowser && window.VoltraBrowser._browserUI && window.VoltraBrowser._browserUI.navigate;
      if(nav) {
        VoltraBrowser._browserUI.navigate = function(url) {
          t('navigate-call', { url: url });
          return nav.call(this, url);
        };
      }

      // Hook _loadUrlInFrame with full variable capture
      var lf = window.VoltraBrowser && window.VoltraBrowser._browserUI && window.VoltraBrowser._browserUI._loadUrlInFrame;
      if(lf) {
        VoltraBrowser._browserUI._loadUrlInFrame = function(url) {
          var bf = document.getElementById('browserFrame-main');
          var bfBefore = bf ? { id: bf.id, src: bf.src.substring(0,300), hasSrcdoc: !!bf.srcdoc, srcdocLen: (bf.srcdoc||'').length } : null;
          var normalized = (typeof normalizeUrl === 'function') ? normalizeUrl(url) : 'UNKNOWN';
          var useUv = (typeof shouldUseUV === 'function') ? shouldUseUV(normalized) : 'UNKNOWN';
          var encoded = (useUv === true && typeof window.encodeUVUrl === 'function') ? encodeUVUrl(normalized) : '(not encoded)';
          t('_loadUrlInFrame-call', {
            rawUrl: url,
            isBraveHome: (typeof isBraveHome === 'function') ? isBraveHome(url) : 'UNKNOWN',
            normalized: normalized,
            shouldUseUV: useUv,
            encodedUrl: encoded,
            finalSrc: (useUv === true && encoded !== '(not encoded)') ? encoded : normalized,
            browserFrameBefore: bfBefore,
            portReady: window.__UV_BOOT_STATUS__ ? __UV_BOOT_STATUS__.portReady : 'UNKNOWN',
            swPortStatus: window.__UV_BOOT_STATUS__ ? __UV_BOOT_STATUS__.swPortStatus : 'UNKNOWN'
          });
          return lf.call(this, url);
        };
      }

      // Hook _restoreTabUrl
      var rt = window.VoltraBrowser && window.VoltraBrowser._browserUI && window.VoltraBrowser._browserUI._restoreTabUrl;
      if(rt) {
        VoltraBrowser._browserUI._restoreTabUrl = function(url) {
          t('_restoreTabUrl-call', { url: url, portReady: window.__UV_BOOT_STATUS__ ? __UV_BOOT_STATUS__.portReady : 'UNKNOWN' });
          return rt.call(this, url);
        };
      }

      // MutationObserver for iframe src/srcdoc changes
      var obs = new MutationObserver(function(muts) {
        muts.forEach(function(m) {
          if(m.type === 'attributes' && m.attributeName === 'src' && m.target && m.target.id) {
            t('iframe-src-changed', { id: m.target.id, oldSrc: m.oldValue ? m.oldValue.substring(0,300) : null, newSrc: m.target.src.substring(0,300) });
          }
          if(m.type === 'attributes' && m.attributeName === 'srcdoc' && m.target && m.target.id) {
            t('iframe-srcdoc-changed', { id: m.target.id, hadSrcdoc: !!m.target.srcdoc, srcdocLen: (m.target.srcdoc||'').length });
          }
        });
      });
      obs.observe(document.documentElement, { attributes: true, attributeFilter: ['src', 'srcdoc'], subtree: true });

      // Hook openGame
      var og = window.openGame;
      if(typeof og === 'function') {
        window.openGame = function(id) {
          t('openGame-call', { id: id, gameEntry: gameIndex && gameIndex[id] ? {url: gameIndex[id].url, title: gameIndex[id].title} : null });
          var result = og.call(this, id);
          setTimeout(function() {
            var gf = document.getElementById('gameFrame');
            t('openGame-after', {
              gameFrameExists: !!gf,
              src: gf ? gf.src.substring(0,300) : null,
              dataSrc: gf ? (gf.getAttribute('data-src') || '') : null,
              hasSrcdoc: gf ? !!gf.srcdoc : null
            });
            if(gf) {
              gf.addEventListener('load', function() {
                t('gameFrame-load', { src: gf.src.substring(0,300) });
                try {
                  var d = gf.contentDocument || gf.contentWindow && gf.contentWindow.document;
                  if(d) t('gameFrame-content', { title: d.title, url: d.URL, readyState: d.readyState, bodyLen: (d.body && d.body.innerText || '').length, isError: (d.body && d.body.innerHTML || '').indexOf('Error processing') !== -1 });
                } catch(e) { t('gameFrame-content-err', { msg: e.message }); }
              });
              gf.addEventListener('error', function() {
                t('gameFrame-error', { src: gf.src.substring(0,300) });
              });
            }
          }, 3000);
          return result;
        };
      }

      // Hook browserFrame load/error
      var capBF = function() {
        var bf = document.getElementById('browserFrame-main');
        if(bf) {
          bf.addEventListener('load', function() {
            t('browserFrame-load', { src: bf.src.substring(0,300) });
            try {
              var d = bf.contentDocument || bf.contentWindow && bf.contentWindow.document;
              if(d) t('browserFrame-content', { title: d.title, url: d.URL, readyState: d.readyState, bodyLen: (d.body && d.body.innerText || '').length, isError: (d.body && d.body.innerHTML || '').indexOf('Error processing') !== -1 });
            } catch(e) { t('browserFrame-content-err', { msg: e.message }); }
          });
          bf.addEventListener('error', function() {
            t('browserFrame-error', { src: bf.src.substring(0,300) });
          });
        }
      };
      capBF();
      var bfObs = new MutationObserver(function(muts) {
        muts.forEach(function(m) {
          if(m.type === 'childList') {
            m.addedNodes.forEach(function(n) {
              if(n.nodeType === 1 && n.id === 'browserFrame-main') { capBF(); t('browserFrame-created', {}); }
            });
          }
        });
      });
      bfObs.observe(document.body || document.documentElement, { childList: true, subtree: true });

      t('initial-state', {
        boot: window.__UV_BOOT_STATUS__ ? { portReady: __UV_BOOT_STATUS__.portReady, swActivated: __UV_BOOT_STATUS__.swActivated, swPortStatus: __UV_BOOT_STATUS__.swPortStatus } : null,
        routeDebug: window.__UV_ROUTE_DEBUG__ || null
      });
      console.log('[TRACE-INIT] installed at ' + Date.now());
    })();
  `});
  await sleep(300);
}

async function getTraces(cdp) {
  var raw = evalValue(await cdp.send('Runtime.evaluate', { expression: `JSON.stringify(window.__NAV_TRACES__ || [])`, returnByValue: true }));
  try { return JSON.parse(raw); } catch(e) { return []; }
}

async function getBoot(cdp) {
  var raw = evalValue(await cdp.send('Runtime.evaluate', { expression: `JSON.stringify(window.__UV_BOOT_STATUS__ || {})`, returnByValue: true }));
  try { return JSON.parse(raw); } catch(e) { return {}; }
}

async function getRouteDebug(cdp) {
  var raw = evalValue(await cdp.send('Runtime.evaluate', { expression: `JSON.stringify(window.__UV_ROUTE_DEBUG__ || {})`, returnByValue: true }));
  try { return JSON.parse(raw); } catch(e) { return {}; }
}

async function getIframeStates(cdp) {
  var raw = evalValue(await cdp.send('Runtime.evaluate', { expression: `JSON.stringify((function(){return{browserFrame:(function(){var f=document.getElementById('browserFrame-main');return f?{src:f.src.substring(0,300),hasSrcdoc:!!f.srcdoc,srcdocLen:(f.srcdoc||'').length}:null})(),gameFrame:(function(){var f=document.getElementById('gameFrame');return f?{src:f.src.substring(0,300),hasSrcdoc:!!f.srcdoc,dataSrc:f.getAttribute('data-src')||''}:null})()}})())`, returnByValue: true }));
  try { return JSON.parse(raw); } catch(e) { return {}; }
}

async function getIframeContent(id, cdp) {
  var raw = evalValue(await cdp.send('Runtime.evaluate', { expression: `(function(){try{var f=document.getElementById('${id}');if(!f)return'NO_IFRAME';var d=f.contentDocument||f.contentWindow&&f.contentWindow.document;if(!d)return'NO_DOC';return{title:d.title,url:d.URL,readyState:d.readyState,bodyLen:(d.body&&d.body.innerText||'').length,isError:(d.body&&d.body.innerHTML||'').indexOf('Error processing')!==-1}}catch(e){return'ERR:'+e.message}})()`, returnByValue: true }));
  return raw;
}

async function getBootTiming(cdp) {
  var raw = evalValue(await cdp.send('Runtime.evaluate', { expression: `JSON.stringify((function(){if(!window.__UV_BOOT_STATUS__)return null;var b=__UV_BOOT_STATUS__;return{portReady:b.portReady,swActivated:b.swActivated,bareMuxReady:b.bareMuxReady,swPortStatus:b.swPortStatus,failedStage:b.failedStage,lastPingOK:b.lastPingOK,lastPingFail:b.lastPingFail,_log:(b._log||[]).slice(-10)}})())`, returnByValue: true }));
  try { return JSON.parse(raw); } catch(e) { return {}; }
}

function printSection(title) {
  console.log('\n' + '='.repeat(70));
  console.log(title);
  console.log('='.repeat(70));
}

async function getSWDiag(cdp) {
  var raw = evalValue(await cdp.send('Runtime.evaluate', { expression: `(async function(){try{var reg=await navigator.serviceWorker.ready;if(!reg.active)return'NO_ACTIVE_SW';var c=new MessageChannel;return await Promise.race([new Promise(function(r){c.port1.onmessage=function(e){c.port1.close();r(JSON.stringify(e.data))};reg.active.postMessage({type:'GET_DIAG'},[c.port2])}),new Promise(function(_,rj){setTimeout(function(){rj('TIMEOUT')},5000)})])}catch(e){return'ERR:'+e.message}})()`, awaitPromise: true, returnByValue: true }));
  return raw;
}

async function main() {
  var PORT = 9260;
  try { await fetchJSON('http://127.0.0.1:' + PORT + '/json/version'); await fetchJSON('http://127.0.0.1:' + PORT + '/json/close'); await sleep(2000); } catch(e) {}

  printSection('Starting Chrome');
  var chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions',
    '--disable-popup-blocking', '--disable-default-apps',
    '--allow-insecure-localhost', '--disable-web-security',
    '--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-failure-' + Date.now(),
    'http://127.0.0.1:8080/'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  var v; for(var i=0;i<20;i++){try{v=await fetchJSON('http://127.0.0.1:'+PORT+'/json/version');break}catch(e){await sleep(1000)}}
  if(!v){ console.log('Chrome fail'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', v.Browser);

  var pt; for(var i=0;i<20;i++){await sleep(500);try{var t=await fetchJSON('http://127.0.0.1:'+PORT+'/json');pt=t.find(function(x){return x.type==='page'});if(pt)break}catch(e){}}
  if(!pt){ console.log('No page'); chrome.kill(); process.exit(1); }

  var cdp = await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');

  // Wait for page load + initial boot
  printSection('PHASE 0: Wait for boot');
  for(var i=0;i<20;i++){
    var r = evalValue(await cdp.send('Runtime.evaluate', { expression: 'window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__.portReady === true', returnByValue: true }));
    if(r === true) { console.log('portReady at t=' + ((i+1)*500) + 'ms'); break; }
    await sleep(500);
  }
  await sleep(2000); // extra settle time

  var boot = await getBoot(cdp);
  console.log('Boot status:', JSON.stringify(boot, null, 2));
  var swDiag = await getSWDiag(cdp);
  console.log('SW GET_DIAG:', swDiag);
  var traces = await getTraces(cdp);
  console.log('Initial traces:', traces.length, 'entries');
  traces.forEach(function(t){ if(t.type === 'initial-state') console.log('  init:', JSON.stringify(t.data)); });

  // ===================================================================
  // PHASE 1: Navigate BEFORE port ready simulation
  // To get a real failure, we need to navigate during the boot window.
  // Since port is already ready, we'll also test game and browser flows.
  // ===================================================================
  printSection('PHASE 1: Verify early navigation path');

  // First, let's load the browser section (simulates startup)
  await cdp.send('Runtime.evaluate', { expression: `loadSection('browser'); console.log('[CMD] loadSection(browser) at ' + Date.now());` });
  await sleep(2000);

  traces = await getTraces(cdp);
  console.log('\nTraces after loadBrowserPage:');
  traces.forEach(function(t){ console.log('  [' + t.type + '] ts=' + (t.ts||'') + ' ' + JSON.stringify(t.data || {})); });
  var iframes = await getIframeStates(cdp);
  console.log('\nIframe states:', JSON.stringify(iframes, null, 2));
  var rd = await getRouteDebug(cdp);
  console.log('Route debug:', JSON.stringify(rd, null, 2));
  var bfContent = await getIframeContent('browserFrame-main', cdp);
  console.log('BrowserFrame content:', bfContent);
  boot = await getBoot(cdp);
  console.log('Boot:', JSON.stringify(boot, null, 2));

  // ===================================================================
  // PHASE 2: Navigate to external URL (address bar entry)
  // ===================================================================
  printSection('PHASE 2: Address bar navigate to https://example.com');
  await cdp.send('Runtime.evaluate', { expression: `VoltraBrowser.navigate('https://example.com'); console.log('[CMD] navigate(example.com) at ' + Date.now());` });
  await sleep(6000);

  traces = await getTraces(cdp);
  console.log('\nTraces after navigate:');
  traces.forEach(function(t){ if(t.ts > Date.now() - 10000) console.log('  [' + t.type + '] ts=' + (t.ts||'') + ' ' + JSON.stringify(t.data || {})); });
  iframes = await getIframeStates(cdp);
  console.log('\nIframe states:', JSON.stringify(iframes, null, 2));
  rd = await getRouteDebug(cdp);
  console.log('Route debug:', JSON.stringify(rd, null, 2));
  bfContent = await getIframeContent('browserFrame-main', cdp);
  console.log('BrowserFrame content:', bfContent);

  // ===================================================================
  // PHASE 3: Game launch
  // ===================================================================
  printSection('PHASE 3: Game launch');
  var gameId = evalValue(await cdp.send('Runtime.evaluate', { expression: `(function(){try{var ids=Object.keys(gameIndex);return ids.length>0?ids[0]:null}catch(e){return null}})()`, returnByValue: true }));
  console.log('First game ID:', gameId);
  if(gameId) {
    await cdp.send('Runtime.evaluate', { expression: `openGame('${gameId}'); console.log('[CMD] openGame(' + '${gameId}' + ') at ' + Date.now());` });
    await sleep(8000);

    traces = await getTraces(cdp);
    console.log('\nTraces after openGame:');
    traces.forEach(function(t){ if(t.ts > Date.now() - 15000) console.log('  [' + t.type + '] ts=' + (t.ts||'') + ' ' + JSON.stringify(t.data || {})); });
    iframes = await getIframeStates(cdp);
    console.log('\nIframe states:', JSON.stringify(iframes, null, 2));
    var gfContent = await getIframeContent('gameFrame', cdp);
    console.log('GameFrame content:', gfContent);
  }

  // ===================================================================
  // PHASE 4: Verify SW fetch handling
  // ===================================================================
  printSection('PHASE 4: SW fetch log for /service/ requests');
  var swLogs = cdp.logs.filter(function(l){ return l.msg.indexOf('[REQ]') !== -1 || l.msg.indexOf('[RES]') !== -1 || l.msg.indexOf('[FAIL]') !== -1; });
  var serviceLogs = swLogs.filter(function(l){ return l.msg.indexOf('/service/') !== -1; });
  if(serviceLogs.length) {
    console.log('Service-related network events:');
    serviceLogs.forEach(function(l){ console.log('  ts=' + l.ts + ' ' + l.msg); });
  } else {
    console.log('No /service/ network events found');
  }

  // All network errors
  var failures = swLogs.filter(function(l){ return l.msg.indexOf('[FAIL]') !== -1; });
  if(failures.length) {
    console.log('\nAll network failures:');
    failures.forEach(function(l){ console.log('  ts=' + l.ts + ' ' + l.msg); });
  }

  // ===================================================================
  // FINAL SUMMARY: collect everything
  // ===================================================================
  printSection('FINAL SUMMARY');
  traces = await getTraces(cdp);
  boot = await getBoot(cdp);
  rd = await getRouteDebug(cdp);
  swDiag = await getSWDiag(cdp);
  iframes = await getIframeStates(cdp);

  console.log('\nFinal boot:', JSON.stringify(boot, null, 2));
  console.log('\nFinal route debug:', JSON.stringify(rd, null, 2));
  console.log('\nFinal iframe states:', JSON.stringify(iframes, null, 2));
  console.log('\nSW GET_DIAG:', swDiag);
  console.log('\nAll navigation traces (' + traces.length + ' entries):');
  traces.forEach(function(t){ console.log('  [' + t.type + '] ts=' + (t.ts||'') + ' ' + JSON.stringify(t.data || {})); });

  // All Page console entries about UV-ROUTE and TRACE
  console.log('\nUV-ROUTE console logs:');
  cdp.logs.filter(function(l){ return l.msg.indexOf('[UV-ROUTE]') !== -1; }).forEach(function(l){ console.log('  ts=' + l.ts + ' ' + l.msg.substring(0,300)); });

  // Finally, get browserFrame content one more time
  bfContent = await getIframeContent('browserFrame-main', cdp);
  console.log('\nFinal browserFrame content:', bfContent);

  cdp.ws.close();
  chrome.kill();
  setTimeout(function(){ process.exit(0); }, 500);
}

main().catch(function(e){ console.error('FATAL:', e.message); process.exit(1); });
