const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function sleep(ms) { return new Promise(function(r){setTimeout(r,ms)}); }
function fetchJSON(url) {
  return new Promise(function(resolve, reject) {
    http.get(url, function(res) { var d=''; res.on('data',function(c){d+=c}); res.on('end',function(){try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}

async function connectCDP(wsUrl) {
  return new Promise(function(resolve, reject) {
    var ws = new WebSocket(wsUrl);
    var mid = 0, pend = {};
    ws.on('open', function() {
      resolve({
        ws: ws,
        send: function(m, p) { p = p || {}; return new Promise(function(r) { var id = ++mid; pend[id] = r; ws.send(JSON.stringify({id:id,method:m,params:p})); setTimeout(function() { if(pend[id]) { delete pend[id]; r(null); } }, 20000); }); }
      });
    });
    ws.on('error', reject);
    ws.on('close', function() { for(var k in pend) if(pend[k]) pend[k](null); });
    ws.on('message', function(d) { try { var m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch(e) {} });
  });
}

function evalValue(r) { if(!r||!r.result||!r.result.result)return undefined; return r.result.result.value; }

async function main() {
  var DPORT = 9234;
  try { await fetchJSON('http://127.0.0.1:'+DPORT+'/json/version'); await fetchJSON('http://127.0.0.1:'+DPORT+'/json/close'); await sleep(1000); } catch(e) {}

  console.log('Starting Chrome...');
  var chrome = spawn(CHROME, ['--headless=new','--remote-debugging-port='+DPORT,'--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions','http://localhost:8080/'], {stdio:['ignore','pipe','pipe'],windowsHide:true});

  var v; for(var i=0;i<30;i++){try{v=await fetchJSON('http://127.0.0.1:'+DPORT+'/json/version');break}catch(e){await sleep(1000)}}
  if(!v){console.log('Chrome fail');chrome.kill();process.exit(1)}
  console.log('Chrome:', v.Browser);

  // --- Phase 1: Wait for page target and boot ---
  var pt; for(var i=0;i<30;i++){await sleep(500);try{var t=await fetchJSON('http://127.0.0.1:'+DPORT+'/json');pt=t.find(function(x){return x.type==='page'});if(pt)break}catch(e){}}
  if(!pt){console.log('No page target');chrome.kill();process.exit(1)}

  var pageCDP = await connectCDP(pt.webSocketDebuggerUrl);
  await pageCDP.send('Page.enable');
  await pageCDP.send('Runtime.enable');

  var pageLogs = [];
  pageCDP.ws.on('message', function(d) {
    try{var m=JSON.parse(d.toString());if(m.method==='Runtime.consoleAPICalled'){var args=(m.params.args||[]).map(function(a){return a.value!==undefined?String(a.value):(a.description||'')}).join(' ');pageLogs.push(args);}}catch(e){}
  });

  // Wait for portReady
  for(var i=0;i<30;i++){var r=await pageCDP.send('Runtime.evaluate',{expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"&&window.__UV_BOOT_STATUS__.portReady===true',returnByValue:true});if(evalValue(r)===true){console.log('portReady after',i+1,'s');break}await sleep(1000)}

  // Render browser UI
  await pageCDP.send('Runtime.evaluate',{expression:'(function(){var c=document.getElementById("braveBrowserContainer")||document.querySelector(".browser-section");if(!c)c=document.querySelector("#browserContainer");if(!c)c=document.getElementById("heroAppGrid");if(!c)c=document.body;if(window.VoltraBrowser&&typeof window.VoltraBrowser.render==="function"){window.VoltraBrowser.render(c);}})()'});
  await sleep(500);

  // --- Phase 2: Connect to SW CDP BEFORE navigation ---
  var targets = await fetchJSON('http://127.0.0.1:'+DPORT+'/json');
  var swTarget = targets.find(function(t){return t.type==='service_worker'});
  if (!swTarget) { console.log('No SW target!'); chrome.kill(); process.exit(1); }

  var swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
  var swLogs = [];
  swCDP.ws.on('message', function(d) {
    try{var m=JSON.parse(d.toString());if(m.method==='Runtime.consoleAPICalled'){var args=(m.params.args||[]).map(function(a){return a.value!==undefined?String(a.value):(a.description||'')}).join(' ');swLogs.push(args);}}catch(e){}
  });
  await swCDP.send('Runtime.enable');
  // Wait a moment for subscription to be active
  await sleep(500);

  // --- Phase 3: Navigate ---
  console.log('\n--- Navigating to https://example.com ---');
  await pageCDP.send('Runtime.evaluate',{expression:'(function(){var ui=window.VoltraBrowser._browserUI;if(!ui)return;var tm=ui.tabManager;if(!tm)return;var tab=tm.getActiveTab();if(tab)ui._loadUrlInActiveTab("https://example.com");})()'});

  // Wait for fetch to complete
  await sleep(8000);

  // --- Phase 4: Collect all evidence ---
  var bs = evalValue(await pageCDP.send('Runtime.evaluate',{expression:'JSON.stringify(window.__UV_BOOT_STATUS__,null,2)',returnByValue:true}));
  var rd = evalValue(await pageCDP.send('Runtime.evaluate',{expression:'JSON.stringify(window.__UV_ROUTE_DEBUG__,null,2)',returnByValue:true}));
  var iframeSrc = evalValue(await pageCDP.send('Runtime.evaluate',{expression:'(function(){var t=window.VoltraBrowser._browserUI.tabManager.getActiveTab();if(!t)return"no-tab";var f=document.getElementById("browserFrame-"+t.id);return f?f.src:"no-iframe";})()',returnByValue:true}));

  // Filter logs
  var psync = pageLogs.filter(function(l){return l.indexOf('[PORT_SYNC]')!==-1});
  var pboot = pageLogs.filter(function(l){return l.indexOf('[BOOT]')!==-1});
  var proute = pageLogs.filter(function(l){return l.indexOf('[UV-ROUTE]')!==-1});
  var swboot = swLogs.filter(function(l){return l.indexOf('[BOOT-SW]')!==-1});
  var swtrace = swLogs.filter(function(l){return l.indexOf('[TRACE]')!==-1});

  // === OUTPUT ===
  console.log('\n'+'='.repeat(70));
  console.log('RUNTIME CHAIN');
  console.log('='.repeat(70));

  // Step 1 — outer fetch handler
  console.log('\nStep 1 — Outer fetch handler:');
  console.log('(all [BOOT-SW] fetch lines during navigation)');
  var navSwBoot = swboot.filter(function(l){return l.indexOf('fetch #')!==-1});
  if (navSwBoot.length === 0) {
    console.log('  NO [BOOT-SW] fetch lines found during navigation');
  }
  navSwBoot.forEach(function(l){console.log('  '+l)});
  console.log('\n([TRACE] UV_PROXY_ACTIVE lines from outer handler):');
  var proxyActive = swtrace.filter(function(l){return l.indexOf('UV_PROXY_ACTIVE')!==-1});
  if (proxyActive.length === 0) {
    console.log('  NONE');
  }
  proxyActive.forEach(function(l){console.log('  '+l)});

  // Step 2 — sw.fetch
  console.log('\nStep 2 — sw.fetch():');
  var swFetchEntry = swtrace.filter(function(l){return l.indexOf('sw.fetch ENTRY')!==-1});
  var swFetchEarly = swtrace.filter(function(l){return l.indexOf('sw.fetch EARLY RETURN')!==-1});
  var swFetchPass = swtrace.filter(function(l){return l.indexOf('sw.fetch PASS')!==-1});
  if (swFetchEntry.length === 0) { console.log('  NO sw.fetch ENTRY logged'); }
  swFetchEntry.forEach(function(l){console.log('  '+l)});
  if (swFetchEarly.length > 0) { console.log('  EARLY RETURN 503 path:'); swFetchEarly.forEach(function(l){console.log('  '+l)}); }
  if (swFetchPass.length > 0) { console.log('  PASS path:'); swFetchPass.forEach(function(l){console.log('  '+l)}); }

  // Step 3 — _origFetch result
  console.log('\nStep 3 — _origFetch(event) result:');
  var swFetchResolved = swtrace.filter(function(l){return l.indexOf('_origFetch RESOLVED')!==-1});
  var swFetchThrew = swtrace.filter(function(l){return l.indexOf('_origFetch THREW')!==-1});
  if (swFetchResolved.length > 0) {
    swFetchResolved.forEach(function(l){console.log('  '+l)});
  } else {
    console.log('  NO _origFetch RESOLVED logged');
  }
  var swHeaders = swtrace.filter(function(l){return l.indexOf('_origFetch HEADERS')!==-1});
  if (swHeaders.length > 0) {
    swHeaders.forEach(function(l){console.log('  '+l)});
  }
  if (swFetchThrew.length > 0) {
    console.log('  _origFetch THREW:');
    swFetchThrew.forEach(function(l){console.log('  '+l)});
  }

  // Step 4 — outer catch
  console.log('\nStep 4 — Outer fetch handler catch:');
  var uvFailCatch = swtrace.filter(function(l){return l.indexOf('UV_FAIL_503 — catch')!==-1});
  var uvFailStatus = swtrace.filter(function(l){return l.indexOf('UV_FAIL_503 — response')!==-1});
  uvFailCatch.forEach(function(l){console.log('  '+l)});
  uvFailStatus.forEach(function(l){console.log('  '+l)});
  if (uvFailCatch.length === 0 && uvFailStatus.length === 0) {
    console.log('  NO UV_FAIL_503 lines');
  }

  // Response status from outer handler
  console.log('\n(response status lines from outer handler):');
  var respStatusLines = swtrace.filter(function(l){return l.indexOf('response status:')!==-1});
  respStatusLines.forEach(function(l){console.log('  '+l)});

  // Step 5 — Collect ALL [TRACE] in order
  console.log('\n=== ALL [TRACE] logs (chronological) ===');
  swtrace.forEach(function(l,i){console.log('  ['+i+'] '+l)});

  // State
  console.log('\n=== window.__UV_BOOT_STATUS__ ===');
  console.log(bs);
  console.log('\n=== window.__UV_ROUTE_DEBUG__ ===');
  console.log(rd);
  console.log('\n=== iframe.src ===');
  console.log(iframeSrc);

  console.log('\n=== PAGE CONSOLE: [PORT_SYNC] ===');
  psync.forEach(function(l){console.log('  '+l)});
  console.log('\n=== PAGE CONSOLE: [BOOT] ===');
  pboot.forEach(function(l){console.log('  '+l)});
  console.log('\n=== PAGE CONSOLE: [UV-ROUTE] ===');
  proute.forEach(function(l){console.log('  '+l)});

  pageCDP.ws.close();
  swCDP.ws.close();
  chrome.kill();
  setTimeout(function(){process.exit(0)},500);
}
main().catch(function(e){console.error('FATAL:',e);process.exit(1)});
