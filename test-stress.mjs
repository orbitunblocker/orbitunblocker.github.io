import { spawn } from 'child_process';
import http from 'http';
import https from 'https';
import fs from 'fs';
import { WebSocket } from 'ws';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const TARGET = 'https://orbitproxy.up.railway.app';
const CDP_PORT = 9270;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function req(host, path) {
  const mod = host.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(host + path, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => resolve({ status: r.statusCode, body: d, headers: r.headers })); }).on('error', reject);
  });
}

function reqJSON(url) {
  const mod = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    mod.get(url, r => { let d = ''; r.on('data', c => d += c); r.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }); }).on('error', reject);
  });
}

async function main() {
  // Verify Railway
  console.log('=== CHECKING RAILWAY DEPLOYMENT ===');
  try {
    const resp = await req(TARGET, '/');
    console.log('Railway:', resp.status, resp.body.length + 'b');
    const sw = await req(TARGET, '/sw.js');
    console.log('sw.js:', sw.status, sw.body.length + 'b');
    const app = await req(TARGET, '/js/app.js');
    console.log('app.js:', app.status, app.body.length + 'b');
    const eng = await req(TARGET, '/js/browser-engine.js');
    console.log('browser-engine.js:', eng.status, eng.body.length + 'b');
  } catch (e) {
    console.log('FAIL: Cannot reach Railway:', e.message);
    process.exit(1);
  }

  // Kill stale Chrome
  try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); spawn('taskkill', ['/f', '/im', 'chrome.exe'], { stdio: 'ignore' }); await sleep(4000); } catch (e) {}

  const chrome = spawn(CHROME, [
    `--remote-debugging-port=${CDP_PORT}`, '--no-sandbox', '--disable-gpu',
    '--no-first-run', '--disable-extensions', '--disable-popup-blocking',
    '--disable-default-apps', '--allow-insecure-localhost',
    `--user-data-dir=C:\\Users\\abeni\\AppData\\Local\\Temp\\stress-${Date.now()}`,
    TARGET + '/'
  ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });

  let chromeErr = '';
  chrome.stderr.on('data', d => { chromeErr += d.toString(); });

  for (let i = 0; i < 30; i++) { await sleep(1000); try { await reqJSON(`http://127.0.0.1:${CDP_PORT}/json/version`); break; } catch (e) {} }
  console.log('Chrome ready');

  let pt;
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const t = await reqJSON(`http://127.0.0.1:${CDP_PORT}/json`);
    pt = t.find(x => x.type === 'page' && x.url.includes('orbitproxy'));
    if (pt) break;
  }
  if (!pt) { console.log('FAIL: No Railway page'); chrome.kill(); process.exit(1); }

  // ==================== CDP SETUP ====================
  const ws = new WebSocket(pt.webSocketDebuggerUrl);
  let mid = 0, pending = {};
  const logs = [];
  const exceptions = [];

  function send(m, p, t) {
    return new Promise(r => {
      const id = ++mid;
      pending[id] = r;
      ws.send(JSON.stringify({ id, method: m, params: p }));
      setTimeout(() => { if (pending[id]) { delete pending[id]; r({error: 'timeout'}) } }, t || 60000);
    });
  }

  // Simple eval helper — returns result value or error string
  async function evalInPage(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
    if (r.error) return r.error;
    return r.result?.result?.value;
  }

  ws.on('message', d => {
    try {
      const m = JSON.parse(d.toString());
      if (m.method === 'Runtime.consoleAPICalled') {
        const args = (m.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || '')).join(' ');
        logs.push({ ts: Date.now(), level: m.params.type, msg: args });
      }
      if (m.method === 'Runtime.exceptionThrown') {
        exceptions.push(m.params.exceptionDetails.text);
      }
      if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
    } catch (e) {}
  });
  ws.on('error', () => {});
  await new Promise(r => ws.on('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Console.enable');
  await send('Runtime.runIfWaitingForDebugger');

  // Wait for boot
  console.log('Waiting for boot...');
  for (let i = 0; i < 40; i++) {
    await sleep(1000);
    const v = await evalInPage('typeof __UV_BOOT_STATUS__!==\'undefined\'');
    if (v === true) { console.log('Booted'); break; }
  }

  // ==================== INIT BROWSER ====================
  console.log('Initializing browser...');
  await send('Runtime.evaluate', { expression: "if(typeof loadSection==='function')loadSection('browser')" });
  await sleep(300);
  await send('Runtime.evaluate', { expression: 'var m=document.getElementById("browserMount");if(m&&VoltraBrowser.render)VoltraBrowser.render(m);' });
  await sleep(1000);

  const ifrCheck = await evalInPage('document.getElementById("browserFrame-main")?"YES":"NO"');
  console.log('Iframe:', ifrCheck);

  // ==================== STATE HELPERS ====================
  async function getState() {
    const r = await send('Runtime.evaluate', {
      expression: `(function(){var b=__UV_BOOT_STATUS__||{};var f=document.getElementById('browserFrame-main');try{var d=f&&f.contentDocument;var t=d&&d.body?d.body.innerText||'':'NOCONTENT';var b2=d&&d.body?d.body.innerHTML.trim()==='':true;return JSON.stringify({portReady:b.portReady,sw:b.swPortStatus,src:f?f.src:'NOFRAME',blank:b2,text:t.substring(0,80)})}catch(e){return JSON.stringify({portReady:b.portReady,sw:b.swPortStatus,src:f?f.src:'NOFRAME',blank:'CORS',text:e.message})}})()`,
      returnByValue: true
    });
    if (r.result?.result?.value) return JSON.parse(r.result.result.value);
    return {};
  }

  const URLS = ['google.com','wikipedia.org','github.com','duckduckgo.com','stackoverflow.com',
                'reddit.com','youtube.com','twitter.com','facebook.com','instagram.com',
                'linkedin.com','amazon.com','netflix.com','twitch.tv','spotify.com',
                'apple.com','microsoft.com','nytimes.com','bbc.com','cnn.com'];
  const MIXED = ['google.com','wikipedia.org','github.com','reddit.com','stackoverflow.com',
                 '__reload__','duckduckgo.com','bbc.com','nytimes.com','__reload__'];

  const allResults = { p1: [], p2: [], p3: [], p4: [], p5: [] };
  const whiteScreens = [];
  let totalWhite = 0;

  function isWhite(s) {
    if (!s) return false;
    // CORS = cross-origin iframe = page loaded (not blank)
    if (s.blank === 'CORS') return false;
    // about:blank = initial state = not a white screen
    if (s.src === 'about:blank') return false;
    // NOCONTENT = body not yet rendered = timing issue, not white
    if (s.text === 'NOCONTENT') return false;
    // Empty body after navigation = white screen (e.g., 503 null body)
    if (s.blank === true) return true;
    return false;
  }

  // ==================== PHASE 1: 50 Rapid Navs ====================
  console.log('\n===== PHASE 1: 50 Rapid Navigations =====');
  const start1 = Date.now();
  for (let i = 0; i < 50; i++) {
    const url = URLS[i % URLS.length];
    await send('Runtime.evaluate', { expression: `VoltraBrowser.navigate("${url}")` });
    await sleep(1500);
    const s = await getState();
    const white = isWhite(s);
    if (white) { whiteScreens.push({ phase:1, num:i+1, url, ...s }); totalWhite++; }
    allResults.p1.push({ url, white, hadLoad: s.text && !s.text.startsWith('NOCONTENT') });
    if ((i+1) % 10 === 0) console.log(`  [${i+1}/50] white=${totalWhite}`);
  }
  const t1 = Math.round((Date.now() - start1) / 1000);
  const w1 = allResults.p1.filter(x => x.white).length;
  console.log(`Phase 1: 50 navs in ${t1}s, ${w1} white`);

  // ==================== PHASE 2: 20 Reloads ====================
  console.log('\n===== PHASE 2: 20 Repeated Reloads =====');
  await send('Runtime.evaluate', { expression: 'VoltraBrowser.navigate("google.com")' });
  await sleep(5000);
  const start2 = Date.now();
  for (let i = 0; i < 20; i++) {
    await send('Runtime.evaluate', { expression: 'VoltraBrowser.refresh()' });
    await sleep(3000);
    const s = await getState();
    const white = isWhite(s);
    if (white) { whiteScreens.push({ phase:2, num:i+1, url:'google.com(rel)', ...s }); totalWhite++; }
    allResults.p2.push({ url:'google.com(rel)', white });
    if ((i+1) % 5 === 0) console.log(`  [${i+1}/20] white=${totalWhite - w1}`);
  }
  const t2 = Math.round((Date.now() - start2) / 1000);
  const w2 = allResults.p2.filter(x => x.white).length;
  console.log(`Phase 2: 20 reloads in ${t2}s, ${w2} white`);

  // ==================== PHASE 3: Game Cycles ====================
  console.log('\n===== PHASE 3: Browser→Game→Browser Cycles =====');
  const gameCount = await evalInPage(`(function(){if(typeof gameIndex==='undefined')return 0;return Math.min(3,Object.keys(gameIndex).length)})()`);
  console.log(`  Games available: ${gameCount}`);
  if (gameCount > 0) {
    const gameIds = await evalInPage(`(function(){return JSON.stringify(Object.keys(gameIndex).slice(0,3))})()`);
    const ids = JSON.parse(gameIds || '[]');
    const start3 = Date.now();
    for (let i = 0; i < 5; i++) {
      const gid = ids[i % ids.length];
      // Launch game
      await send('Runtime.evaluate', { expression: `openGame("${gid}")` });
      await sleep(3000);
      // Return to browser
      await send('Runtime.evaluate', { expression: `if(typeof backFromPlayer==='function')backFromPlayer();else if(typeof render==='function')render('home');else if(typeof loadSection==='function')loadSection('browser')` });
      await sleep(500);
      await send('Runtime.evaluate', { expression: 'var m=document.getElementById("browserMount");if(m&&VoltraBrowser.render)VoltraBrowser.render(m);' });
      await sleep(2000);
      // Test browser navigation
      await send('Runtime.evaluate', { expression: 'VoltraBrowser.navigate("example.com")' });
      await sleep(4000);
      const s = await getState();
      const white = isWhite(s);
      if (white) { whiteScreens.push({ phase:3, num:i+1, url:'example.com', ...s }); totalWhite++; }
      allResults.p3.push({ url:'example.com', white });
      console.log(`  Cycle ${i+1}/5: game=${gid} white=${white}`);
    }
    console.log(`Phase 3: ${allResults.p3.length} cycles`);
  } else {
    console.log('  SKIP (no games)');
  }

  // ==================== PHASE 4: Long Session ====================
  console.log('\n===== PHASE 4: Long Session (40 mixed actions) =====');
  const start4 = Date.now();
  for (let i = 0; i < 40; i++) {
    const action = MIXED[i % MIXED.length];
    if (action === '__reload__') {
      await send('Runtime.evaluate', { expression: 'VoltraBrowser.refresh()' });
    } else {
      await send('Runtime.evaluate', { expression: `VoltraBrowser.navigate("${action}")` });
    }
    await sleep(3000);
    const s = await getState();
    const white = isWhite(s);
    if (white) { whiteScreens.push({ phase:4, num:i+1, url:action, ...s }); totalWhite++; }
    allResults.p4.push({ url:action, white });
    if ((i+1) % 10 === 0) console.log(`  [${i+1}/40] white=${totalWhite}`);
  }
  console.log(`Phase 4: ${allResults.p4.length} actions`);

  // ==================== PHASE 5: Recovery Cycles ====================
  console.log('\n===== PHASE 5: 5 Recovery Cycles =====');
  const start5 = Date.now();
  for (let i = 0; i < 5; i++) {
    // Dispatch fake port failure
    await send('Runtime.evaluate', {
      expression: `document.dispatchEvent(new CustomEvent('PORT_STATE_SYNC',{detail:{portReady:false,status:'failed',reinitCount:${i+1}}}))`
    });
    await sleep(3000);
    await send('Runtime.evaluate', { expression: 'VoltraBrowser.navigate("google.com")' });
    await sleep(5000);
    const s = await getState();
    const white = isWhite(s);
    if (white) { whiteScreens.push({ phase:5, num:i+1, url:'google.com', ...s }); totalWhite++; }
    allResults.p5.push({ url:'google.com', white, recovered: s.portReady === true && s.sw === 'ready' });
    console.log(`  Cycle ${i+1}/5: white=${white} port=${s.portReady} sw=${s.sw}`);
  }
  console.log(`Phase 5: ${allResults.p5.length} cycles`);

  // ==================== RESULTS ====================
  const phases = [
    { name: '1 Rapid Navs', data: allResults.p1 },
    { name: '2 Reloads', data: allResults.p2 },
    { name: '3 Game Cycles', data: allResults.p3 },
    { name: '4 Long Session', data: allResults.p4 },
    { name: '5 Recovery', data: allResults.p5 }
  ];

  console.log('\n\n===== FINAL RESULTS =====');
  console.log('Phase           Actions  White  Loads  Result');
  console.log('---------------------------------------------');
  let gTotal = 0, gWhite = 0, gLoads = 0;
  for (const p of phases) {
    const t = p.data.length, w = p.data.filter(x => x.white).length, l = p.data.filter(x => x.hadLoad !== false).length;
    gTotal += t; gWhite += w; gLoads += l;
    const res = w === 0 ? 'PASS' : 'FAIL';
    console.log(`${p.name.padEnd(14)} ${String(t).padStart(7)} ${String(w).padStart(6)} ${String(l).padStart(6)}  ${res}`);
  }
  console.log('---------------------------------------------');
  console.log(`TOTAL          ${String(gTotal).padStart(7)} ${String(gWhite).padStart(6)} ${String(gLoads).padStart(6)}  ${gWhite === 0 ? 'PASS' : 'FAIL'}`);
  console.log(`\nTotal actions: ${gTotal}`);
  console.log(`White screens: ${gWhite}`);
  console.log(`White rate: ${gTotal > 0 ? (gWhite/gTotal*100).toFixed(1) : 0}%`);

  // White screen details
  if (whiteScreens.length > 0) {
    console.log('\n----- WHITE SCREEN DETAILS -----');
    whiteScreens.forEach((w, i) => {
      console.log(`#${i+1} phase=${w.phase} url=${w.url} src=${(w.src||'').substring(0,60)} blank=${w.blank} port=${w.portReady} sw=${w.sw}`);
    });
  }

  // Relevant console logs
  console.log('\n===== RELEVANT CONSOLE LOGS =====');
  const rel = logs.filter(l => l.msg.match(/PORT|defer|flush|ERROR|error|RECOVERY|game|worker|timeout|\/service\/|503|blank|recovery|REINIT|Pending|pending|sw|SW|navigate|load|refresh/i));
  (rel.length > 0 ? rel : logs).slice(-40).forEach(l => console.log(`  [${new Date(l.ts).toISOString()}] ${l.level}: ${l.msg}`));

  if (exceptions.length > 0) {
    console.log('\n===== EXCEPTIONS =====');
    exceptions.slice(-10).forEach(e => console.log('  ', e));
  }

  ws.close();
  chrome.kill();
  setTimeout(() => process.exit(gWhite > 0 ? 1 : 0), 500);
}
main().catch(e => { console.error(e); process.exit(1); });
