// Minimal page check: what does Chrome actually load at localhost:8080?
const {spawn} = require('child_process');
const http = require('http');
const WebSocket = require('ws');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function sleep(ms) {return new Promise(r=>setTimeout(r,ms));}
function fetchJSON(url) {return new Promise((resolve,reject)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});}).on('error',reject);});}
function evalValue(r){if(!r||!r.result||!r.result.result)return undefined;return r.result.result.value;}

async function main() {
  try {await fetchJSON('http://127.0.0.1:9241/json/version');await fetchJSON('http://127.0.0.1:9241/json/close');await sleep(2000);}catch(e){}
  var chrome = spawn(CHROME,['--headless=new','--remote-debugging-port=9241','--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions','--disable-default-apps','--allow-insecure-localhost','--disable-web-security','--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-test-'+Date.now(),'http://127.0.0.1:8080/'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  var v; for(var i=0;i<20;i++){try{v=await fetchJSON('http://127.0.0.1:9241/json/version');break;}catch(e){await sleep(1000);}}
  if(!v){console.log('Chrome fail');chrome.kill();process.exit(1);}
  console.log('Chrome:', v.Browser);
  var pt; for(var i=0;i<20;i++){await sleep(500);try{var t=await fetchJSON('http://127.0.0.1:9241/json');pt=t.find(x=>x.type==='page');if(pt)break;}catch(e){}}
  if(!pt){console.log('No page');chrome.kill();process.exit(1);}
  var ws = new WebSocket(pt.webSocketDebuggerUrl);
  var mid=0,pend={};
  function send(m,p){p=p||{};return new Promise(r=>{var id=++mid;pend[id]=r;ws.send(JSON.stringify({id,method:m,params:p}));setTimeout(()=>{if(pend[id]){delete pend[id];r({})}},10000);});}
  ws.on('message',d=>{try{var m=JSON.parse(d.toString());if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id];}}catch(e){}});
  ws.on('open',async()=>{
    await send('Page.enable');
    await send('Runtime.enable');
    await sleep(5000);
    var checks=[
      ['URL','document.URL'],
      ['contentType','document.contentType'],
      ['bodyHTMLlen','document.body?.innerHTML?.length||0'],
      ['scriptSrcCount','document.querySelectorAll("script[src]").length'],
      ['bodyScriptCount','document.querySelectorAll("body script").length'],
      ['headScriptCount','document.querySelectorAll("head script").length'],
      ['hasBootStatus','typeof window.__UV_BOOT_STATUS__!=="undefined"'],
      ['hasVoltraBrowser','typeof window.VoltraBrowser!=="undefined"'],
      ['hasOpenGame','typeof window.openGame==="function"'],
      ['hasShouldUseUV','typeof window.shouldUseUV==="function"'],
      ['headHTML','document.head.innerHTML.substring(0,800)'],
      ['bodyHTML','(document.body?.innerHTML||"").substring(0,800)'],
    ];
    for(var c of checks){
      var r = evalValue(await send('Runtime.evaluate',{expression:c[1],returnByValue:true}));
      console.log(c[0]+':',JSON.stringify(r));
    }
    ws.close();
    chrome.kill();
    setTimeout(()=>process.exit(0),500);
  });
}
main().catch(e=>{console.error(e);process.exit(1);});
