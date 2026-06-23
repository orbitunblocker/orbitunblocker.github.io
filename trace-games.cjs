// Test game launch path: trace openGame() end-to-end
const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
function sleep(ms) {return new Promise(r=>setTimeout(r,ms));}
function fetchJSON(url) {return new Promise((resolve,reject)=>{http.get(url,r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}});}).on('error',reject);});}
function evalValue(r){if(!r||!r.result||!r.result.result)return undefined;return r.result.result.value;}

async function connectCDP(wsUrl) {
  return new Promise((resolve,reject)=>{
    const ws=new WebSocket(wsUrl); let mid=0,pend={},logs=[];
    ws.on('open',()=>resolve({ws,logs,send:(m,p={})=>new Promise(r=>{let id=++mid;pend[id]=r;ws.send(JSON.stringify({id,method:m,params:p}));setTimeout(()=>{if(pend[id]){delete pend[id];r({})}},20000);})}));
    ws.on('error',reject);
    ws.on('close',()=>{for(const k of Object.keys(pend))pend[k]({})});
    ws.on('message',d=>{try{var m=JSON.parse(d.toString());if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id]}if(m.method==='Runtime.consoleAPICalled'){logs.push('[PAGE] '+(m.params.args||[]).map(a=>a.value!==undefined?a.value:(a.description||'')).join(' '))}if(m.method==='Runtime.exceptionThrown'){logs.push('[PAGE-EXC] '+m.params.exceptionDetails?.text)}}catch(e){}});
  });
}

async function main() {
  try{await fetchJSON('http://127.0.0.1:9242/json/version');await fetchJSON('http://127.0.0.1:9242/json/close');await sleep(2000)}catch(e){}
  var chrome=spawn(CHROME,['--headless=new','--remote-debugging-port=9242','--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions','--disable-popup-blocking','--disable-default-apps','--allow-insecure-localhost','--disable-web-security','--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\chrome-game-' + Date.now(),'http://127.0.0.1:8080/'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  var v;for(var i=0;i<20;i++){try{v=await fetchJSON('http://127.0.0.1:9242/json/version');break}catch(e){await sleep(1000)}}if(!v){console.log('Chrome fail');chrome.kill();process.exit(1)}console.log('Chrome:',v.Browser);
  var pt;for(var i=0;i<20;i++){await sleep(500);try{var t=await fetchJSON('http://127.0.0.1:9242/json');pt=t.find(x=>x.type==='page');if(pt)break}catch(e){}}if(!pt){console.log('No page');chrome.kill();process.exit(1)}
  var cdp=await connectCDP(pt.webSocketDebuggerUrl);
  await cdp.send('Page.enable');await cdp.send('Runtime.enable');

  // Wait for boot
  for(var i=0;i<30;i++){var r=evalValue(await cdp.send('Runtime.evaluate',{expression:'window.__UV_BOOT_STATUS__?.portReady===true',returnByValue:true}));if(r===true){console.log('portReady after',i+1,'s');break}await sleep(1000)}
  
  // Get game info (gameIndex is const, not on window)
  var games=evalValue(await cdp.send('Runtime.evaluate',{expression:`(function(){try{var ids=Object.keys(gameIndex);return ids.length>0?ids.slice(0,5).map(function(id){var g=gameIndex[id];return{id:id,url:g.url,title:g.title}}):'empty'}catch(e){return'ERR:'+e.message}})()`,returnByValue:true}));
  console.log('Games:',games);

  if(!games||typeof games==='string'){console.log('No games to test');chrome.kill();setTimeout(()=>process.exit(0),500);return;}

  // Test launching first game
  var g=games[0];
  console.log('\n=== Launching game:', g.title, '('+g.id+') ===');

  // Instrument game iframe loading
  await cdp.send('Runtime.evaluate',{expression:`
    (function(){
      window.__GAME_EVENTS__=[];
      var orig=window.openGame;
      if(orig){
        window.openGame=function(id){
          window.__GAME_EVENTS__.push({ts:Date.now(),type:'openGame',id:id});
          console.log('[GAME_TRACE] openGame('+id+') called');
          return orig.call(this,id);
        };
      }
      // Watch for gameFrame creation and src changes
      var obs=new MutationObserver(function(muts){
        muts.forEach(function(m){
          if(m.type==='childList'){
            m.addedNodes.forEach(function(n){
              if(n.id==='gameFrame'){
                window.__GAME_EVENTS__.push({ts:Date.now(),type:'gameFrame-created'});
                console.log('[GAME_TRACE] gameFrame created');
                n.addEventListener('load',function(){
                  window.__GAME_EVENTS__.push({ts:Date.now(),type:'gameFrame-load',src:n.src.substring(0,200)});
                  console.log('[GAME_TRACE] gameFrame loaded, src:', n.src.substring(0,200));
                });
                n.addEventListener('error',function(){
                  window.__GAME_EVENTS__.push({ts:Date.now(),type:'gameFrame-error',src:n.src.substring(0,200)});
                  console.log('[GAME_TRACE] gameFrame ERROR, src:', n.src.substring(0,200));
                });
              }
            });
          }
          if(m.type==='attributes'&&m.attributeName==='src'&&m.target.id==='gameFrame'){
            window.__GAME_EVENTS__.push({ts:Date.now(),type:'gameFrame-src-changed',src:m.target.src.substring(0,200)});
            console.log('[GAME_TRACE] gameFrame src ->', m.target.src.substring(0,200));
          }
        });
      });
      obs.observe(document.body||document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src']});
      console.log('[GAME_TRACE] observers installed');
    })()
  `});
  await sleep(500);

  // Launch game
  console.log('Calling openGame("'+g.id+'")...');
  await cdp.send('Runtime.evaluate',{expression:'openGame("'+g.id+'")'});
  
  // Wait for game page to render and iframe to load
  for(var i=0;i<20;i++){
    var events=evalValue(await cdp.send('Runtime.evaluate',{expression:'JSON.stringify(window.__GAME_EVENTS__||[])',returnByValue:true}));
    await sleep(500);
    // Check if iframe loaded
    var hasLoad=events&&events.includes('gameFrame-load');
    var hasError=events&&events.includes('gameFrame-error');
    console.log('tick',i+1,'hasLoad:',hasLoad,'hasError:',hasError);
    if(hasLoad||hasError)break;
  }
  await sleep(3000);

  // Capture final state
  var state=evalValue(await cdp.send('Runtime.evaluate',{expression:`
    (function(){
      try{
        var f=document.getElementById('gameFrame');
        if(!f)return JSON.stringify({err:'no gameFrame'});
        var info={
          id:f.id,
          src:(f.src||'').substring(0,200),
          dataSrc:f.getAttribute('data-src')||'',
          srcdoc:!!f.srcdoc,
          sandbox:f.getAttribute('sandbox')||''
        };
        var d;
        try{d=f.contentDocument||f.contentWindow?.document}catch(e){info.docAccessError=e.message}
        if(d){
          info.docTitle=d.title;
          info.docBodyLen=(d.body?.innerText||'').length;
          info.docReadyState=d.readyState;
          info.isErrorPage=(d.body?.innerHTML||'').includes('Error processing');
          info.docUrl=d.URL||'';
        }
        return JSON.stringify(info);
      }catch(e){return JSON.stringify({err:e.message})}
    })()
  `,returnByValue:true}));
  console.log('\nGame iframe state:', state);

  var events=evalValue(await cdp.send('Runtime.evaluate',{expression:'JSON.stringify(window.__GAME_EVENTS__||[])',returnByValue:true}));
  console.log('\nGame events:', events);

  var page=evalValue(await cdp.send('Runtime.evaluate',{expression:`
    JSON.stringify((function(){
      try{
        return{
          hasGameFrame:!!document.getElementById('gameFrame'),
          hasGamePage:!!document.querySelector('.game-page-fullscreen'),
          gameFrameSrc:(document.getElementById('gameFrame')?.src||'').substring(0,200)
        }
      }catch(e){return{err:e.message}}
    })())
  `,returnByValue:true}));
  console.log('\nPage state:', page);

  // Console logs
  console.log('\n=== Game console logs ===');
  cdp.logs.filter(l=>l.includes('[GAME_TRACE]')||l.includes('error')||l.includes('ERR')||l.includes('Error')||l.includes('[PAGE-EXC]')).forEach(l=>console.log(l));

  chrome.kill();
  setTimeout(()=>process.exit(0),500);
}
main().catch(e=>{console.error('FATAL:',e);process.exit(1)});
