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
  var DPORT = 9237;
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

  // Wait for boot
  for(var i=0;i<30;i++){var r=await pageCDP.send('Runtime.evaluate',{expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"&&window.__UV_BOOT_STATUS__.portReady===true',returnByValue:true});if(evalValue(r)===true){console.log('portReady after',i+1,'s');break}await sleep(1000)}

  // Connect to worker CDP target
  var targets = await fetchJSON('http://127.0.0.1:'+DPORT+'/json');
  var swTarget = targets.find(function(t){return t.type==='service_worker'});
  var wkrTarget = targets.find(function(t){return t.type==='shared_worker'});

  console.log('SW target:', swTarget ? 'yes' : 'no');
  console.log('SharedWorker target:', wkrTarget ? 'yes' : 'no');

  // Capture SW logs
  var swLogs = [];
  if (swTarget) {
    var swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
    swCDP.ws.on('message', function(d) {
      try{var m=JSON.parse(d.toString());if(m.method==='Runtime.consoleAPICalled'){var args=(m.params.args||[]).map(function(a){return a.value!==undefined?String(a.value):(a.description||'')}).join(' ');swLogs.push(args);}}catch(e){}
    });
    await swCDP.send('Runtime.enable');
  }

  // Capture worker logs
  var wkrLogs = [];
  if (wkrTarget) {
    var wkrCDP = await connectCDP(wkrTarget.webSocketDebuggerUrl);
    wkrCDP.ws.on('message', function(d) {
      try{var m=JSON.parse(d.toString());if(m.method==='Runtime.consoleAPICalled'){var args=(m.params.args||[]).map(function(a){return a.value!==undefined?String(a.value):(a.description||'')}).join(' ');wkrLogs.push(args);}}catch(e){}
    });
    await wkrCDP.send('Runtime.enable');
  }

  await sleep(500);

  // Test 1: Direct fetch from PAGE to https://example.com
  console.log('\n--- Test 1: page fetch() to https://example.com ---');
  var r1 = evalValue(await pageCDP.send('Runtime.evaluate',{expression:`
    (async function() {
      try {
        var r = await fetch('https://example.com', {mode: 'no-cors'});
        return 'status: ' + r.status + ' ok: ' + r.ok;
      } catch(e) { return 'ERROR: ' + e.message; }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log('result:', r1);

  // Test 2: Direct fetch from PAGE to http://localhost:8080/bare/
  console.log('\n--- Test 2: page fetch() to /bare/ ---');
  var r2 = evalValue(await pageCDP.send('Runtime.evaluate',{expression:`
    (async function() {
      try {
        var r = await fetch('/bare/');
        return 'status: ' + r.status;
      } catch(e) { return 'ERROR: ' + e.message; }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log('result:', r2);

  // Test 3: Direct fetch from PAGE to /bare/v1/
  console.log('\n--- Test 3: page fetch() to /bare/v1/ ---');
  var r3 = evalValue(await pageCDP.send('Runtime.evaluate',{expression:`
    (async function() {
      try {
        var r = await fetch('/bare/v1/');
        return 'status: ' + r.status;
      } catch(e) { return 'ERROR: ' + e.message; }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log('result:', r3);

  // Test 4: Through UV to https://example.com
  console.log('\n--- Test 4: fetch() /service/hvtrs8%2F-ezaopne%2Ccmm ---');
  var r4 = evalValue(await pageCDP.send('Runtime.evaluate',{expression:`
    (async function() {
      try {
        var r = await fetch('/service/hvtrs8%2F-ezaopne%2Ccmm');
        var t = await r.text();
        return 'status: ' + r.status + ' bodyLen: ' + t.length;
      } catch(e) { return 'ERROR: ' + e.message; }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log('result:', r4);

  await sleep(3000);

  // Output
  console.log('\n=== SW FETCH LOGS ===');
  swLogs.filter(function(l){return l.indexOf('fetch #')!==-1}).forEach(function(l){console.log('  '+l)});

  console.log('\n=== SW [UV-INTERNAL] LOGS ===');
  swLogs.filter(function(l){return l.indexOf('[UV-INTERNAL]')!==-1}).forEach(function(l){console.log('  '+l)});

  console.log('\n=== WORKER LOGS ===');
  wkrLogs.forEach(function(l,i){console.log('  ['+i+'] '+l)});

  pageCDP.ws.close();
  if (swTarget && swCDP) swCDP.ws.close();
  if (wkrTarget && wkrCDP) wkrCDP.ws.close();
  chrome.kill();
  setTimeout(function(){process.exit(0)},500);
}
main().catch(function(e){console.error('FATAL:',e);process.exit(1)});
