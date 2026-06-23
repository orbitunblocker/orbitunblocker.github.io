const {spawn} = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function sleep(ms) {return new Promise(r=>setTimeout(r,ms));}
function fetchJSON(url) {return new Promise((resolve,reject)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});}).on('error',reject);});}
async function main(){
  try{await fetchJSON('http://127.0.0.1:9243/json/version');await sleep(2000);}catch(e){}
  var chrome=spawn(CHROME,['--headless=new','--remote-debugging-port=9243','--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions','--disable-default-apps','--allow-insecure-localhost','--disable-web-security','--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-simple-'+Date.now(),'http://127.0.0.1:8080/'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  var v;for(var i=0;i<20;i++){try{v=await fetchJSON('http://127.0.0.1:9243/json/version');break;}catch(e){await sleep(1000);}}
  if(!v){console.log('Chrome fail');process.exit(1);}
  console.log('Chrome:',v.Browser);
  var pt;for(var i=0;i<30;i++){await sleep(500);try{var t=await fetchJSON('http://127.0.0.1:9243/json');pt=t.find(x=>x.type==='page');if(pt)break;}catch(e){}}
  if(!pt){console.log('No page');chrome.kill();process.exit(1);}
  console.log('Page URL:',JSON.stringify(pt.url));
  var ws=new WebSocket(pt.webSocketDebuggerUrl);
  var mid=0,pend={};
  function send(m,p){p=p||{};return new Promise(r=>{var id=++mid;pend[id]=r;ws.send(JSON.stringify({id,method:m,params:p}));setTimeout(()=>{if(pend[id]){delete pend[id];r({})}},10000);});}
  ws.on('message',d=>{try{var m=JSON.parse(d.toString());if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}}catch(e){}});
  ws.on('open',async()=>{
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Console.enable');
    // Poll for __UV_BOOT_STATUS__ up to 15s
    for(var i=0;i<30;i++){
      var r=await send('Runtime.evaluate',{expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"&&typeof window.__UV_BOOT_STATUS__.portReady!=="undefined"',returnByValue:true});
      var val=r&&r.result&&r.result.result&&r.result.result.value;
      if(val===true){console.log('__UV_BOOT_STATUS__ ready after',(i+1)*0.5,'s');break;}
      await sleep(500);
    }
    // Full state dump
    var r=await send('Runtime.evaluate',{expression:'JSON.stringify({bootStatus:(window.__UV_BOOT_STATUS__||"NOT_FOUND"),routeDebug:(window.__UV_ROUTE_DEBUG__||"NOT_FOUND"),hasBrowser:!!document.getElementById("browserFrame-main"),hasGame:!!document.getElementById("gameFrame"),bodyLen:document.body.innerHTML.length})',returnByValue:true});
    if(r&&r.result&&r.result.result){
      var state=eval('('+r.result.result.value+')');
      console.log('Boot:',JSON.stringify(state.bootStatus));
      console.log('Route:',JSON.stringify(state.routeDebug));
      console.log('Has browser iframe:',state.hasBrowser);
      console.log('Has game iframe:',state.hasGame);
      console.log('Body length:',state.bodyLen);
    }
    // Console.log entries (use Page.getResourceTree to check if scripts loaded?)
    var r2=await send('Runtime.evaluate',{expression:'document.querySelectorAll("script").length',returnByValue:true});
    var sc=r2&&r2.result&&r2.result.result&&r2.result.result.value;
    console.log('Script elements:',sc);
    ws.close();
    chrome.kill();
    setTimeout(()=>process.exit(0),500);
  });
}
main().catch(e=>{console.error(e);process.exit(1);});
