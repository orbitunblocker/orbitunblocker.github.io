const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
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
  var DPORT = 9239;
  try { await fetchJSON('http://127.0.0.1:'+DPORT+'/json/version'); await fetchJSON('http://127.0.0.1:'+DPORT+'/json/close'); await sleep(1000); } catch(e) {}

  console.log('Starting Chrome...');
  var chrome = spawn(CHROME, ['--headless=new','--remote-debugging-port='+DPORT,'--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions','http://localhost:8080/'], {stdio:['ignore','pipe','pipe'],windowsHide:true});

  var v; for(var i=0;i<30;i++){try{v=await fetchJSON('http://127.0.0.1:'+DPORT+'/json/version');break}catch(e){await sleep(1000)}}
  if(!v){console.log('Chrome fail');chrome.kill();process.exit(1)}
  console.log('Chrome:', v.Browser);

  // Wait for all targets
  var pt, swTarget, wkrTarget;
  for(var i=0;i<30;i++){await sleep(1000);try{var t=await fetchJSON('http://127.0.0.1:'+DPORT+'/json');pt=t.find(function(x){return x.type==='page'});swTarget=t.find(function(x){return x.type==='service_worker'});wkrTarget=t.find(function(x){return x.type==='shared_worker'});if(pt&&swTarget&&wkrTarget)break}catch(e){}}
  console.log('Page:', pt?'yes':'no', 'SW:', swTarget?'yes':'no', 'Worker:', wkrTarget?'yes':'no');

  // Connect page CDP
  var pageCDP = await connectCDP(pt.webSocketDebuggerUrl);
  await pageCDP.send('Page.enable');
  await pageCDP.send('Runtime.enable');

  // Wait for portReady
  for(var i=0;i<30;i++){var r=await pageCDP.send('Runtime.evaluate',{expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"&&window.__UV_BOOT_STATUS__.portReady===true',returnByValue:true});if(evalValue(r)===true){console.log('portReady after',i+1,'s');break}await sleep(1000)}

  // Connect SW CDP
  var swCDP = await connectCDP(swTarget.webSocketDebuggerUrl);
  var swLogs = [];
  swCDP.ws.on('message', function(d) {
    try{var m=JSON.parse(d.toString());if(m.method==='Runtime.consoleAPICalled'){var args=(m.params.args||[]).map(function(a){return a.value!==undefined?String(a.value):(a.description||'')}).join(' ');swLogs.push(args);}}catch(e){}
  });
  await swCDP.send('Runtime.enable');

  // Connect Worker CDP
  var wkrCDP = await connectCDP(wkrTarget.webSocketDebuggerUrl);
  var wkrLogs = [];
  wkrCDP.ws.on('message', function(d) {
    try{var m=JSON.parse(d.toString());if(m.method==='Runtime.consoleAPICalled'){var args=(m.params.args||[]).map(function(a){return a.value!==undefined?String(a.value):(a.description||'')}).join(' ');wkrLogs.push(args);}}catch(e){}
  });
  await wkrCDP.send('Runtime.enable');

  await sleep(1000);

  // Clear server trace log
  try { fs.writeFileSync(path.join(__dirname, 'server-trace.log'), ''); } catch(e) {}

  // Make UV request
  console.log('\n--- SENDING UV REQUEST ---');
  var r = evalValue(await pageCDP.send('Runtime.evaluate',{expression:`
    (async function() {
      try {
        var resp = await fetch('/service/hvtrs8%2F-ezaopne%2Ccmm');
        var text = await resp.text();
        return 'status: ' + resp.status;
      } catch(e) { return 'ERROR: ' + e.message; }
    })()
  `, awaitPromise: true, returnByValue: true}));
  console.log('UV request result:', r);

  await sleep(5000);

  // Collect all evidence
  // Read server trace
  var serverTrace = '';
  try { serverTrace = fs.readFileSync(path.join(__dirname, 'server-trace.log'), 'utf8'); } catch(e) { serverTrace = 'ERROR reading: ' + e.message; }

  // Check Bare server directly
  var bareV1 = 'N/A';
  try {
    var d = '';
    await new Promise(function(resolve, reject) {
      http.get('http://localhost:8080/bare/v1/', function(res) { res.on('data',function(c){d+=c}); res.on('end',resolve); }).on('error', reject);
    });
    bareV1 = d.substring(0, 200);
  } catch(e) { bareV1 = 'ERROR: ' + e.message; }

  var bareRoot = 'N/A';
  try {
    var d = '';
    await new Promise(function(resolve, reject) {
      http.get('http://localhost:8080/bare/', function(res) { res.on('data',function(c){d+=c}); res.on('end',resolve); }).on('error', reject);
    });
    bareRoot = 'status: ' + (/* can't get status easily */ 'see server log');
  } catch(e) { bareRoot = 'ERROR: ' + e.message; }

  // Output everything
  console.log('\n' + '='.repeat(70));
  console.log('REQUEST PATH ANALYSIS');
  console.log('='.repeat(70));

  console.log('\n--- PAGE ---');
  console.log('  initiated fetch to: /service/hvtrs8%2F-ezaopne%2Ccmm');
  console.log('  result:', r);

  console.log('\n--- SERVICE WORKER (all fetch events) ---');
  swLogs.filter(function(l){return l.indexOf('fetch #')!==-1}).forEach(function(l){console.log('  '+l)});

  console.log('\n--- SERVICE WORKER (UV internal) ---');
  swLogs.filter(function(l){return l.indexOf('[UV-INTERNAL]')!==-1}).forEach(function(l){console.log('  '+l)});

  console.log('\n--- SERVICE WORKER (all [TRACE]) ---');
  swLogs.filter(function(l){return l.indexOf('[TRACE]')!==-1}).forEach(function(l){console.log('  '+l)});

  console.log('\n--- SHAREDWORKER (all logs) ---');
  wkrLogs.forEach(function(l){console.log('  '+l)});

  console.log('\n--- SERVER (server-trace.log) ---');
  var lines = serverTrace.split('\n').filter(function(l){return l.trim()});
  if (lines.length === 0) {
    console.log('  (empty)');
  } else {
    lines.forEach(function(l){console.log('  '+l)});
  }

  console.log('\n--- BARE SERVER DIRECT CHECK ---');
  console.log('  GET /bare/v1/:', bareV1);
  console.log('  GET /bare/:', 'see server log above');

  pageCDP.ws.close();
  swCDP.ws.close();
  wkrCDP.ws.close();
  chrome.kill();
  setTimeout(function(){process.exit(0)},500);
}
main().catch(function(e){console.error('FATAL:',e);process.exit(1)});
