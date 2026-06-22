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
  var DPORT = 9236;
  try { await fetchJSON('http://127.0.0.1:'+DPORT+'/json/version'); await fetchJSON('http://127.0.0.1:'+DPORT+'/json/close'); await sleep(1000); } catch(e) {}

  console.log('Starting Chrome...');
  var chrome = spawn(CHROME, ['--headless=new','--remote-debugging-port='+DPORT,'--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions','http://localhost:8080/'], {stdio:['ignore','pipe','pipe'],windowsHide:true});

  var v; for(var i=0;i<30;i++){try{v=await fetchJSON('http://127.0.0.1:'+DPORT+'/json/version');break}catch(e){await sleep(1000)}}
  if(!v){console.log('Chrome fail');chrome.kill();process.exit(1)}
  console.log('Chrome:', v.Browser);

  var pt; for(var i=0;i<30;i++){await sleep(500);try{var t=await fetchJSON('http://127.0.0.1:'+DPORT+'/json');pt=t.find(function(x){return x.type==='page'});if(pt)break}catch(e){}}
  if(!pt){console.log('No page target');chrome.kill();process.exit(1)}

  var pageCDP = await connectCDP(pt.webSocketDebuggerUrl);
  await pageCDP.send('Page.enable');
  await pageCDP.send('Runtime.enable');

  // Wait for portReady
  for(var i=0;i<30;i++){var r=await pageCDP.send('Runtime.evaluate',{expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"&&window.__UV_BOOT_STATUS__.portReady===true',returnByValue:true});if(evalValue(r)===true){console.log('portReady after',i+1,'s');break}await sleep(1000)}

  // Connect to SW CDP BEFORE test
  var targets = await fetchJSON('http://127.0.0.1:'+DPORT+'/json');
  var swTarget = targets.find(function(t){return t.type==='service_worker'});
  if (!swTarget) { console.log('No SW target!'); chrome.kill(); process.exit(1); }

  var swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
  var swLogs = [];
  swCDP.ws.on('message', function(d) {
    try{var m=JSON.parse(d.toString());if(m.method==='Runtime.consoleAPICalled'){var args=(m.params.args||[]).map(function(a){return a.value!==undefined?String(a.value):(a.description||'')}).join(' ');swLogs.push(args);}}catch(e){}
  });
  await swCDP.send('Runtime.enable');
  await sleep(500);

  // Test: direct fetch() to /service/ URL
  console.log('\n--- TEST: fetch() /service/hvtrs8%2F-ezaopne%2Ccmm ---');
  var fetchResult = evalValue(await pageCDP.send('Runtime.evaluate',{expression:`
    (async function() {
      try {
        var resp = await fetch('/service/hvtrs8%2F-ezaopne%2Ccmm');
        var text = await resp.text();
        return 'status: ' + resp.status + ' bodyLen: ' + text.length + ' bodyStart: ' + text.substring(0,200);
      } catch(e) {
        return 'FETCH ERROR: ' + e.message;
      }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log('fetch() result:', fetchResult);
  await sleep(5000);

  // Filter and output
  var swfetchLines = swLogs.filter(function(l){return l.indexOf('fetch #')!==-1});
  var swtrace = swLogs.filter(function(l){return l.indexOf('[TRACE]')!==-1});
  var swUvInternal = swLogs.filter(function(l){return l.indexOf('[UV-INTERNAL]')!==-1});
  var swBoot = swLogs.filter(function(l){return l.indexOf('[BOOT-SW]')!==-1});
  var allOther = swLogs.filter(function(l){return l.indexOf('[BOOT-SW]')===-1&&l.indexOf('[TRACE]')===-1&&l.indexOf('[UV-INTERNAL]')===-1&&l.indexOf('fetch #')===-1});

  console.log('\n================== UV INTERNAL CHAIN ==================');
  console.log('\nStep 1 — Outer fetch handler:');
  swfetchLines.forEach(function(l){console.log('  '+l)});

  console.log('\nStep 2 — sw.fetch:');
  swtrace.forEach(function(l){console.log('  '+l)});

  console.log('\nStep 3 — UV internal logs:');
  swUvInternal.forEach(function(l,i){console.log('  ['+i+'] '+l)});

  console.log('\nStep 4 — All other SW logs:');
  allOther.forEach(function(l,i){console.log('  ['+i+'] '+l)});

  console.log('\nStep 5 — Response body preview:');
  console.log('  '+fetchResult);

  pageCDP.ws.close();
  swCDP.ws.close();
  chrome.kill();
  setTimeout(function(){process.exit(0)},500);
}
main().catch(function(e){console.error('FATAL:',e);process.exit(1)});
