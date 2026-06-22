const WebSocket = require('ws');
const { spawn } = require('child_process');
const http = require('http');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const DEBUG_PORT = 9225;
const DEBUG_HOST = '127.0.0.1';
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{try{resolve(JSON.parse(d))}catch(e){reject(e)}}); }).on('error', reject);
  });
}
function evalValue(r) { if(!r||!r.result||!r.result.result)return undefined; return r.result.result.value; }
function connectCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let mid=0, pend={}; let logs=[];
    ws.on('open',()=>resolve({ws,logs,sendCDP(m,p={}){return new Promise(r=>{let id=++mid;pend[id]=r;ws.send(JSON.stringify({id,method:m,params:p}));setTimeout(()=>{if(pend[id]){delete pend[id];r(null)}},20000)})}}));
    ws.on('error',reject);
    ws.on('close',()=>{for(const k of Object.keys(pend))pend[k](null)});
    ws.on('message',d=>{try{const m=JSON.parse(d.toString());if(m.id&&pend[m.id]){pend[m.id](m);delete pend[m.id]}if(m.method==='Runtime.consoleAPICalled'){const a=(m.params.args||[]).map(x=>x.value!==undefined?x.value:(x.description||'')).join(' ');logs.push(a)}if(m.method==='Runtime.exceptionThrown'){logs.push('[EXCEPTION] '+m.params.exceptionDetails.text)}}catch(e){}});
  });
}

async function main() {
  try { await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`); await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/close`); await sleep(2000); } catch(e){}
  console.log('Starting Chrome...');
  const chrome = spawn(CHROME,['--headless',`--remote-debugging-port=${DEBUG_PORT}`,'--no-sandbox','--disable-gpu','--no-first-run','--disable-extensions','--disable-popup-blocking','--disable-default-apps','http://localhost:8080'],{stdio:['ignore','pipe','pipe'],windowsHide:true});
  let v; for(let i=0;i<30;i++){try{v=await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json/version`);break}catch(e){await sleep(1000)}} if(!v){console.log('Chrome fail');chrome.kill();process.exit(1)} console.log('Chrome:',v.Browser);
  let pt; for(let i=0;i<20;i++){await sleep(500);try{const tgt=await fetchJSON(`http://${DEBUG_HOST}:${DEBUG_PORT}/json`);pt=tgt.find(t=>t.type==='page');if(pt)break}catch(e){}} if(!pt){console.log('No page');chrome.kill();process.exit(1)}
  const {ws:pg,logs,sendCDP}=await connectCDP(pt.webSocketDebuggerUrl);
  await sendCDP('Page.enable'); await sendCDP('Runtime.enable');

  // Wait for SW activation
  for(let i=0;i<60;i++){
    const r=await sendCDP('Runtime.evaluate',{expression:'typeof window.__UV_BOOT_STATUS__!=="undefined"&&window.__UV_BOOT_STATUS__.swActivated===true',returnByValue:true});
    if(evalValue(r)===true){console.log('SW activated after',i+1,'s');break}
    await sleep(500);
  }

  // Dump all console logs that are [BOOT] or [TRACE]
  const capture = () => sendCDP('Runtime.evaluate',{expression:'(window.__UV_BOOT_STATUS__._log||[]).map(x=>x.key+"="+x.val+"@"+x.at).join(" | ")',returnByValue:true});
  
  // Check port state, port, etc in SW
  async function checkSWState() {
    const r = await sendCDP('Runtime.evaluate',{expression:'(async()=>{try{const reg=await navigator.serviceWorker.ready;if(!reg.active)return"no active";const c=new MessageChannel;return await Promise.race([new Promise(r=>{c.port1.onmessage=e=>{c.port1.close();r(JSON.stringify(e.data))};reg.active.postMessage({type:"SYNC_PORT_STATE",checkHealth:true},[c.port2])}),new Promise((_,rej)=>setTimeout(()=>rej("timeout"),5000))])}catch(e){return"ERR:"+e.message}})()',awaitPromise:true,returnByValue:true});
    return evalValue(r);
  }

  let prevBoot = '';
  for(let i=0;i<6;i++){
    await sleep(5000);
    const boot = (await capture())||'';
    if(boot!==prevBoot){console.log('\n--- tick',i+1,'---\n'+boot); prevBoot=boot;}
    const swResp = await checkSWState();
    console.log('SW state:', swResp);
    const portReady = evalValue(await sendCDP('Runtime.evaluate',{expression:'window.__UV_BOOT_STATUS__.portReady',returnByValue:true}));
    console.log('portReady:', portReady);
  }

  // Now try navigating to example.com and check traces
  console.log('\n=== Creating tab & navigating ===');
  console.log(evalValue(await sendCDP('Runtime.evaluate',{expression:'window.VoltraBrowser._browserUI.tabManager?.["createTab"]?.("https://example.com")||"no createTab"',returnByValue:true})));
  await sleep(1000);

  const tinfo = evalValue(await sendCDP('Runtime.evaluate',{expression:'(()=>{var t=window.VoltraBrowser._browserUI.tabManager.getActiveTab();return t?t.id+":"+t.url:"none"})()',returnByValue:true}));
  console.log('Tab:', tinfo);

  console.log(evalValue(await sendCDP('Runtime.evaluate',{expression:'window.VoltraBrowser._browserUI._loadUrlInActiveTab("https://example.com")',returnByValue:true})));
  await sleep(2000);

  const rd = evalValue(await sendCDP('Runtime.evaluate',{expression:'JSON.stringify(window.__UV_ROUTE_DEBUG__)',returnByValue:true}));
  console.log('UV_ROUTE_DEBUG:', rd);

  // Check for any errors on page
  console.log('\nPage console [TRACE]/[UV]/error lines:');
  for(const l of logs) if(l.includes('[TRACE]')||l.includes('[UV]')||l.includes('error')||l.includes('Error')||l.includes('ERR')) console.log('  '+l);

  chrome.kill();
  setTimeout(()=>process.exit(0),500);
}
main().catch(e=>{console.error('FATAL:',e);process.exit(1)});
