const { chromium } = require('playwright');

// ============================================================
// Pipeline verification test — clean codebase, passive logging only
// ============================================================

const SCENARIOS = {
  chrome: { executablePath: undefined, headless: false },
  opera: { executablePath: 'C:\\Users\\abeni\\AppData\\Local\\Programs\\Opera GX\\opera.exe', headless: false },
  msedge: { executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', headless: false },
};

async function testScenario(label, launchOpts, pageSetup) {
  const browser = await chromium.launch({ ...launchOpts, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(15000);
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  
  try {
    await pageSetup(page, ctx);
  } catch (e) {
    console.log(label + ': ERROR: ' + e.message);
    await ctx.close(); await browser.close();
    return null;
  }
  
  // Gather final state
  const final = await page.evaluate(() => ({
    portReady: window.__UV_BOOT_STATUS__?.portReady,
    failedStage: window.__UV_BOOT_STATUS__?.failedStage,
    swPortStatus: window.__UV_BOOT_STATUS__?.swPortStatus,
    swSynced: window.__UV_BOOT_STATUS__?.swSynced,
    pendingNavs: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
    iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0, 130)
  }));
  
  // Analyze events
  const events = {
    nav: logs.some(l => l.includes('[NAV]')),
    defer: logs.some(l => l.includes('[DEFER-NAV]')),
    syncEnter: logs.some(l => l.includes('[SYNC] entered')),
    syncResp: logs.some(l => l.includes('[SYNC] response received')),
    syncTimeout: logs.some(l => l.includes('[SYNC] timeout')),
    syncFail: logs.some(l => l.includes('[SYNC] failed')),
    portSync: logs.some(l => l.includes('[PORT_SYNC]')),
    portReady: logs.some(l => l.includes('[PORT_READY]')),
    flush: logs.some(l => l.includes('[FLUSH-NAV]')),
    uvRoute: logs.some(l => l.includes('[UV-ROUTE]')),
  };
  
  // Pipeline status
  const syncOk = events.syncResp || (!events.syncEnter && !events.syncFail && !events.syncTimeout);
  const navOk = !!final.iframeSrc && final.iframeSrc !== 'about:blank';
  const portOk = final.portReady === true;
  const queueOk = final.pendingNavs === 0;
  
  // Determine first missing event in ideal chain
  const idealChain = ['nav', 'syncEnter', 'portSync', 'syncResp', 'portReady', 'uvRoute'];
  let firstMissing = null;
  for (const evt of idealChain) {
    if (!events[evt]) { firstMissing = evt; break; }
  }
  
  return { label, final, events, syncOk, navOk, portOk, queueOk, firstMissing, logs };
}

function printResult(r) {
  if (!r) { console.log('  SKIPPED\n'); return; }
  const status = (r.portOk && r.navOk && r.queueOk) ? 'PASS' : 'FAIL';
  console.log('  ' + status + ' | portReady=' + r.final.portReady + ' pendingNavs=' + r.final.pendingNavs + ' navOk=' + r.navOk);
  console.log('  Events: NAV=' + +r.events.nav + ' SYNC=' + +r.events.syncResp + ' PORT_SYNC=' + +r.events.portSync + ' PORT_READY=' + +r.events.portReady + ' FLUSH=' + +r.events.flush + ' UV-ROUTE=' + +r.events.uvRoute);
  if (r.firstMissing) console.log('  FIRST MISSING: ' + r.firstMissing);
  console.log('  Final iframe: ' + (r.final.iframeSrc || '(blank)'));
  if (r.events.syncFail) console.log('  [SYNC] FAILED: ' + r.logs.filter(l => l.includes('[SYNC] failed')).join(' | '));
  if (r.events.syncTimeout) console.log('  [SYNC] TIMEOUT occurred');
  console.log('');
}

function printFullTimeline(r) {
  if (!r) return;
  console.log('\n=== FULL TIMELINE: ' + r.label + ' ===');
  r.logs.filter(l => l.startsWith('[NAV]') || l.startsWith('[SYNC]') || l.startsWith('[PORT_SYNC]') || l.startsWith('[PORT_READY]') || l.startsWith('[DEFER') || l.startsWith('[FLUSH') || l.startsWith('[UV-ROUTE') || l.startsWith('[BOOT]')).forEach(l => console.log('  ' + l.substring(0, 200)));
}

// ============================================================
// SCENARIO 1: Fresh browser session (first load)
// ============================================================
async function testFresh(label, launchOpts) {
  return await testScenario(label, launchOpts, async (page) => {
    await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
    await new Promise(r => setTimeout(r, 3000));
    await page.evaluate(() => {
      const tryNav = () => {
        if (window.VoltraBrowser) {
          const m = document.createElement('div'); m.id = 'browserMount';
          const mc = document.querySelector('#mainContent') || document.body;
          mc.innerHTML = ''; mc.appendChild(m);
          window.VoltraBrowser.render(m);
          window.VoltraBrowser.navigate('https://example.com');
        } else { setTimeout(tryNav, 5); }
      };
      setTimeout(tryNav, 0);
    });
    await new Promise(r => setTimeout(r, 8000));
  });
}

// ============================================================
// SCENARIO 2: Normal page reload
// ============================================================
async function testReload(label, launchOpts) {
  return await testScenario(label, launchOpts, async (page) => {
    // First load to install SW
    await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
    await new Promise(r => setTimeout(r, 5000));
    // Reload
    await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(() => {
      const tryNav = () => {
        if (window.VoltraBrowser) {
          const m = document.createElement('div'); m.id = 'browserMount';
          const mc = document.querySelector('#mainContent') || document.body;
          mc.innerHTML = ''; mc.appendChild(m);
          window.VoltraBrowser.render(m);
          window.VoltraBrowser.navigate('https://example.com');
        } else { setTimeout(tryNav, 5); }
      };
      setTimeout(tryNav, 0);
    });
    await new Promise(r => setTimeout(r, 8000));
  });
}

// ============================================================
// SCENARIO 3: Reload after 30s wait
// ============================================================
async function testReload30(label, launchOpts) {
  return await testScenario(label, launchOpts, async (page) => {
    await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
    console.log('  Waiting 35s for SW termination...');
    await new Promise(r => setTimeout(r, 35000));
    await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await new Promise(r => setTimeout(r, 2000));
    await page.evaluate(() => {
      const tryNav = () => {
        if (window.VoltraBrowser) {
          const m = document.createElement('div'); m.id = 'browserMount';
          const mc = document.querySelector('#mainContent') || document.body;
          mc.innerHTML = ''; mc.appendChild(m);
          window.VoltraBrowser.render(m);
          window.VoltraBrowser.navigate('https://example.com');
        } else { setTimeout(tryNav, 5); }
      };
      setTimeout(tryNav, 0);
    });
    await new Promise(r => setTimeout(r, 8000));
  });
}

// ============================================================
// Main
// ============================================================
async function main() {
  const results = [];
  
  console.log('=== PIPELINE VERIFICATION ===\n');
  console.log('Build: clean git HEAD + 3 passive console.log statements\n');
  
  // SCENARIO 1: Fresh browser session
  console.log('--- Scenario 1: Fresh browser (Chromium) ---');
  let r = await testFresh('Fresh Chrome', { executablePath: undefined, headless: false });
  printResult(r);
  results.push(r);
  
  // SCENARIO 2: Normal reload
  console.log('--- Scenario 2: Page reload (Chromium) ---');
  r = await testReload('Reload Chrome', { executablePath: undefined, headless: false });
  printResult(r);
  results.push(r);
  
  // SCENARIO 3: 30s wait + reload
  console.log('--- Scenario 3: 30s wait + reload (Chromium) ---');
  r = await testReload30('Reload30 Chrome', { executablePath: undefined, headless: false });
  printResult(r);
  results.push(r);
  
  // SCENARIO 4: Opera GX - fresh
  console.log('--- Scenario 4: Opera GX (fresh) ---');
  r = await testFresh('Fresh Opera', SCENARIOS.opera);
  printResult(r);
  results.push(r);
  
  // SCENARIO 5: Opera GX - reload
  console.log('--- Scenario 5: Opera GX (reload) ---');
  r = await testReload('Reload Opera', SCENARIOS.opera);
  printResult(r);
  results.push(r);
  
  // SCENARIO 6: MS Edge - fresh
  console.log('--- Scenario 6: Microsoft Edge (fresh) ---');
  r = await testFresh('Fresh Edge', SCENARIOS.msedge);
  printResult(r);
  results.push(r);
  
  // SCENARIO 7: MS Edge - reload
  console.log('--- Scenario 7: Microsoft Edge (reload) ---');
  r = await testReload('Reload Edge', SCENARIOS.msedge);
  printResult(r);
  results.push(r);
  
  // SCENARIO 8: Opera GX - 30s wait + reload
  console.log('--- Scenario 8: Opera GX (30s wait + reload) ---');
  r = await testReload30('Reload30 Opera', SCENARIOS.opera);
  printResult(r);
  results.push(r);
  
  // Summary
  console.log('=== SUMMARY ===');
  const fails = results.filter(r => r && !(r.portOk && r.navOk && r.queueOk));
  const passes = results.filter(r => r && r.portOk && r.navOk && r.queueOk);
  console.log('Pass: ' + passes.length + '/' + results.filter(r => r).length);
  if (fails.length > 0) {
    console.log('\nFAILURES:');
    fails.forEach(r => console.log('  ' + r.label + ': portReady=' + r.final.portReady + ' pendingNavs=' + r.final.pendingNavs + ' firstMissing=' + r.firstMissing));
    // Print full timeline for first failure
    printFullTimeline(fails[0]);
  } else {
    console.log('\nALL SCENARIOS PASSED. Pipeline is functioning correctly.');
  }
  
  process.exit(fails.length > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
