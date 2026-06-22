const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
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
        send: function(m, p) { p = p || {}; return new Promise(function(r) { var id = ++mid; pend[id] = r; ws.send(JSON.stringify({id:id,method:m,params:p})); setTimeout(function() { if(pend[id]) { delete pend[id]; r(null); } }, 15000); }); }
      });
    });
    ws.on('error', reject);
    ws.on('close', function() { for(var k in pend) if(pend[k]) pend[k](null); });
    ws.on('message', function(d) { try { var m = JSON.parse(d.toString()); if(m.id && pend[m.id]) { pend[m.id](m); delete pend[m.id]; } } catch(e) {} });
  });
}

function evalValue(r) {
  if(!r || !r.result || !r.result.result) return undefined;
  return r.result.result.value;
}

async function main() {
  var PORT = 9233;
  try { await fetchJSON('http://127.0.0.1:' + PORT + '/json/version'); await fetchJSON('http://127.0.0.1:' + PORT + '/json/close'); await sleep(1000); } catch(e) {}

  console.log('Starting Chrome...');
  var chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=' + PORT, '--no-sandbox', '--disable-gpu', '--no-first-run', '--disable-extensions', 'http://localhost:8080/'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  var v; for(var i=0;i<30;i++) { try { v = await fetchJSON('http://127.0.0.1:' + PORT + '/json/version'); break; } catch(e) { await sleep(1000); } }
  if (!v) { console.log('Chrome fail'); chrome.kill(); process.exit(1); }
  console.log('Chrome:', v.Browser);

  // Wait for page target
  var pt; for(var i=0;i<30;i++) { await sleep(500); try { var t = await fetchJSON('http://127.0.0.1:' + PORT + '/json'); pt = t.find(function(x){return x.type==='page'}); if(pt) break; } catch(e) {} }
  if (!pt) { console.log('No page target'); chrome.kill(); process.exit(1); }

  // Connect to page CDP
  var pageCDP = await connectCDP(pt.webSocketDebuggerUrl);
  await pageCDP.send('Page.enable');
  await pageCDP.send('Runtime.enable');

  // Collect page console logs
  var pageLogLines = [];
  pageCDP.ws.on('message', function(d) {
    try {
      var m = JSON.parse(d.toString());
      if(m.method === 'Runtime.consoleAPICalled') {
        var args = (m.params.args||[]).map(function(a){return a.value!==undefined?String(a.value):(a.description||'')}).join(' ');
        pageLogLines.push(args);
      }
    } catch(e) {}
  });

  // Wait for boot completion + port ready
  for(var i=0;i<30;i++) {
    var r = await pageCDP.send('Runtime.evaluate', {expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"&&window.__UV_BOOT_STATUS__.portReady===true', returnByValue: true});
    if(evalValue(r) === true) { console.log('portReady after', i+1, 's'); break; }
    await sleep(1000);
  }

  // Render browser UI
  await pageCDP.send('Runtime.evaluate', {expression:'(function(){var c=document.getElementById("braveBrowserContainer")||document.querySelector(".browser-section");if(!c)c=document.querySelector("#browserContainer");if(!c)c=document.getElementById("heroAppGrid");if(!c)c=document.body;if(window.VoltraBrowser&&typeof window.VoltraBrowser.render==="function"){window.VoltraBrowser.render(c);}})()'});
  await sleep(500);

  // Navigate to example.com
  console.log('\n--- Navigating to https://example.com ---');
  await pageCDP.send('Runtime.evaluate', {expression:'(function(){var ui=window.VoltraBrowser._browserUI;if(!ui)return;var tm=ui.tabManager;if(!tm)return;var tab=tm.getActiveTab();if(tab)ui._loadUrlInActiveTab("https://example.com");})()'});
  await sleep(5000);

  // Collect page state
  var bs = evalValue(await pageCDP.send('Runtime.evaluate', {expression:'JSON.stringify(window.__UV_BOOT_STATUS__,null,2)', returnByValue: true}));
  var rd = evalValue(await pageCDP.send('Runtime.evaluate', {expression:'JSON.stringify(window.__UV_ROUTE_DEBUG__,null,2)', returnByValue: true}));
  var iframeSrc = evalValue(await pageCDP.send('Runtime.evaluate', {expression:'(function(){var t=window.VoltraBrowser._browserUI.tabManager.getActiveTab();if(!t)return"no-tab";var f=document.getElementById("browserFrame-"+t.id);return f?f.src:"no-iframe";})()', returnByValue: true}));

  // GET_DIAG via page -> SW messaging
  var swDiag = evalValue(await pageCDP.send('Runtime.evaluate', {expression:'(function(){return new Promise(function(res){if(!navigator.serviceWorker.controller){res("no-controller");return;}var mc=new MessageChannel();mc.port1.onmessage=function(e){res(JSON.stringify(e.data));};navigator.serviceWorker.controller.postMessage({type:"GET_DIAG"},[mc.port2]);setTimeout(function(){res("timeout")},5000);})})()', awaitPromise: true, returnByValue: true}));

  // Collect SW CDP target logs
  var targets = await fetchJSON('http://127.0.0.1:' + PORT + '/json');
  var swTarget = targets.find(function(t){return t.type==='service_worker'});
  var swLogLines = [];
  if (swTarget) {
    var swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
    swCDP.ws.on('message', function(d) {
      try {
        var m = JSON.parse(d.toString());
        if(m.method === 'Runtime.consoleAPICalled') {
          var args = (m.params.args||[]).map(function(a){return a.value!==undefined?String(a.value):(a.description||'')}).join(' ');
          swLogLines.push(args);
        }
      } catch(e) {}
    });
    await swCDP.send('Runtime.enable');
    await sleep(2000);
    swCDP.ws.close();
  }

  // ---------- OUTPUT ----------
  console.log('\n' + '='.repeat(70));
  console.log('RUNTIME EVIDENCE');
  console.log('='.repeat(70));

  console.log('\n--- PAGE CONSOLE ---');
  console.log('\n[PORT_SYNC] logs:');
  pageLogLines.filter(function(l){return l.indexOf('[PORT_SYNC]')!==-1}).forEach(function(l){console.log('  ' + l)});

  console.log('\n[BOOT] logs:');
  pageLogLines.filter(function(l){return l.indexOf('[BOOT]')!==-1}).forEach(function(l){console.log('  ' + l)});

  console.log('\n[UV-ROUTE] logs:');
  pageLogLines.filter(function(l){return l.indexOf('[UV-ROUTE]')!==-1}).forEach(function(l){console.log('  ' + l)});

  console.log('\n--- SERVICE WORKER CONSOLE ---');
  console.log('\n[BOOT-SW] logs:');
  swLogLines.filter(function(l){return l.indexOf('[BOOT-SW]')!==-1}).forEach(function(l){console.log('  ' + l)});

  console.log('\n[TRACE] logs:');
  swLogLines.filter(function(l){return l.indexOf('[TRACE]')!==-1}).forEach(function(l){console.log('  ' + l)});

  console.log('\n--- STATE ---');
  console.log('\nwindow.__UV_BOOT_STATUS__:');
  console.log(bs);
  console.log('\nwindow.__UV_ROUTE_DEBUG__:');
  console.log(rd);
  console.log('\niframe.src:');
  console.log(iframeSrc);
  console.log('\nSW GET_DIAG response:');
  console.log(swDiag);

  pageCDP.ws.close();
  chrome.kill();
  setTimeout(function(){process.exit(0)},500);
}
main().catch(function(e){console.error('FATAL:',e);process.exit(1)});
