const {spawn} = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function sleep(ms) {return new Promise(r=>setTimeout(r,ms));}
function fetchJSON(url) {return new Promise((resolve,reject)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});}).on('error',reject);});}
async function main(){
  try{await fetchJSON('http://127.0.0.1:9244/json/version');await sleep(2000);}catch(e){}
  var chrome=spawn(CHROME,['--headless=new','--remote-debugging-port=9244','--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions','--disable-default-apps','--allow-insecure-localhost','--disable-web-security','--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-debug-'+Date.now(),'http://127.0.0.1:8080/'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  var v;for(var i=0;i<20;i++){try{v=await fetchJSON('http://127.0.0.1:9244/json/version');break;}catch(e){await sleep(1000);}}
  if(!v){console.log('Chrome fail');process.exit(1);}
  console.log('Chrome:',v.Browser);
  var pt;for(var i=0;i<30;i++){await sleep(500);try{var t=await fetchJSON('http://127.0.0.1:9244/json');pt=t.find(x=>x.type==='page');if(pt)break;}catch(e){}}
  if(!pt){console.log('No page');chrome.kill();process.exit(1);}
  console.log('Page URL:',JSON.stringify(pt.url));
  var ws=new WebSocket(pt.webSocketDebuggerUrl);
  var mid=0,pend={};
  var errors=[],logs=[];
  function send(m,p){p=p||{};return new Promise(r=>{var id=++mid;pend[id]=r;ws.send(JSON.stringify({id,method:m,params:p}));setTimeout(()=>{if(pend[id]){delete pend[id];r({})}},15000);});}
  ws.on('message',d=>{try{
    var m=JSON.parse(d.toString());
    if(m.method==='Runtime.consoleAPICalled'){logs.push(m.params.args.map(a=>a.value||a.description||JSON.stringify(a)).join(' '));}
    if(m.method==='Runtime.exceptionThrown'){errors.push(m.params.exceptionDetails.text);}
    if(m.method==='Log.entryAdded'){errors.push('LOG:'+m.params.entry.text);}
    if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}
  }catch(e){}});
  ws.on('open',async()=>{
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Console.enable');
    await send('Log.enable');
    await send('Runtime.runIfWaitingForDebugger');
    // Wait short time
    await sleep(10000);
    // Check boot status
    var r=await send('Runtime.evaluate',{expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"',returnByValue:true});
    var hasBoot=r&&r.result&&r.result.result&&r.result.result.value;
    console.log('Has __UV_BOOT_STATUS__:',hasBoot);
    if(hasBoot){
      var r2=await send('Runtime.evaluate',{expression:'JSON.stringify({portReady:window.__UV_BOOT_STATUS__.portReady,failedStage:window.__UV_BOOT_STATUS__.failedStage,swReady:window.__UV_BOOT_STATUS__.swReady,_logLen:window.__UV_BOOT_STATUS__._log.length})',returnByValue:true});
      if(r2&&r2.result&&r2.result.result) console.log('BootState:',r2.result.result.value);
    }
    // Check for errors
    if(errors.length) console.log('ERRORS:',JSON.stringify(errors));
    // Check scripts
    var r3=await send('Runtime.evaluate',{expression:'document.querySelectorAll("script").length',returnByValue:true});
    var sc=r3&&r3.result&&r3.result.result&&r3.result.result.value;
    console.log('Script elements:',sc);
    // Check window globals
    var glbs=['__UV_BOOT_STATUS__','VoltraBrowser','openGame','Ultraviolet','encodeUVUrl','shouldUseUV','BrowserUI'];
    for(var g of glbs){
      var r4=await send('Runtime.evaluate',{expression:'typeof window.'+g,returnByValue:true});
      var val=r4&&r4.result&&r4.result.result&&r4.result.result.value;
      if(val&&val!=='undefined') console.log('  window.'+g+':',val);
    }
    // Check body length
    var r5=await send('Runtime.evaluate',{expression:'document.body.innerHTML.length',returnByValue:true});
    if(r5&&r5.result&&r5.result.result) console.log('Body HTML length:',r5.result.result.value);
    // Logs
    if(logs.length>0) console.log('\n=== CONSOLE LOGS (first 20) ===');
    for(var i=0;i<Math.min(20,logs.length);i++) console.log('  ['+i+']',logs[i].substring(0,500));
    ws.close();
    chrome.kill();
    setTimeout(()=>process.exit(0),500);
  });
}
main().catch(e=>{console.error(e);process.exit(1);});
