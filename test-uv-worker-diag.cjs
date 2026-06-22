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

async function main() {
  var DPORT = 9238;
  try { await fetchJSON('http://127.0.0.1:'+DPORT+'/json/version'); await fetchJSON('http://127.0.0.1:'+DPORT+'/json/close'); await sleep(1000); } catch(e) {}

  console.log('Starting Chrome...');
  var chrome = spawn(CHROME, ['--headless=new','--remote-debugging-port='+DPORT,'--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions','http://localhost:8080/'], {stdio:['ignore','pipe','pipe'],windowsHide:true});

  var v; for(var i=0;i<30;i++){try{v=await fetchJSON('http://127.0.0.1:'+DPORT+'/json/version');break}catch(e){await sleep(1000)}}
  if(!v){console.log('Chrome fail');chrome.kill();process.exit(1)}
  console.log('Chrome:', v.Browser);

  // Wait for page + worker targets
  var pt, wkrTarget;
  for(var i=0;i<40;i++){await sleep(1000);try{var t=await fetchJSON('http://127.0.0.1:'+DPORT+'/json');pt=t.find(function(x){return x.type==='page'});wkrTarget=t.find(function(x){return x.type==='shared_worker'});if(pt&&wkrTarget)break}catch(e){}}
  console.log('Page target:', pt ? 'yes' : 'no');
  console.log('SharedWorker target:', wkrTarget ? 'yes' : 'no');

  // Connect to SharedWorker CDP target
  var wkrLogs = [];
  if (wkrTarget) {
    var wkrCDP = await connectCDP(wkrTarget.webSocketDebuggerUrl);
    wkrCDP.ws.on('message', function(d) {
      try{var m=JSON.parse(d.toString());if(m.method==='Runtime.consoleAPICalled'){var args=(m.params.args||[]).map(function(a){return a.value!==undefined?String(a.value):(a.description||'')}).join(' ');wkrLogs.push(args);}}catch(e){}
    });
    await wkrCDP.send('Runtime.enable');
    // Wait for diagnostics to complete
    await sleep(10000);
    wkrCDP.ws.close();
  }

  // Output
  console.log('\n================== WORKER ENVIRONMENT ==================');
  wkrLogs.filter(function(l){return l.indexOf('ENVIRONMENT')!==-1}).forEach(function(l){console.log(l)});

  console.log('\n================== NETWORK TESTS ==================');
  wkrLogs.filter(function(l){return l.indexOf('TEST URL:')!==-1}).forEach(function(l){console.log(l)});

  console.log('\n================== ALL WORKER LOGS ==================');
  wkrLogs.forEach(function(l,i){console.log('  ['+i+'] '+l)});

  if (pt) {
    var pageCDP = await connectCDP(pt.webSocketDebuggerUrl);
    await pageCDP.send('Runtime.enable');
    var pageFetch = await pageCDP.send('Runtime.evaluate',{expression:'(async function(){try{var r=await fetch("https://example.com/",{mode:"no-cors"});return "page fetch status: "+r.status+" ok: "+r.ok}catch(e){return "page fetch ERROR: "+e.message}})()',awaitPromise:true,returnByValue:true});
    var r = pageFetch && pageFetch.result && pageFetch.result.result ? pageFetch.result.result.value : 'N/A';
    console.log('\n================== PAGE CONTEXT ==================');
    console.log('  page fetch("https://example.com/"):', r);
    pageCDP.ws.close();
  }

  chrome.kill();
  setTimeout(function(){process.exit(0)},500);
}
main().catch(function(e){console.error('FATAL:',e);process.exit(1)});
