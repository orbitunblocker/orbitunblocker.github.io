const { chromium } = require('playwright');
const EXE = 'C:\\Users\\abeni\\AppData\\Local\\Programs\\Opera GX\\opera.exe';

async function testCase(label, fn) {
  const browser = await chromium.launch({ executablePath: EXE, headless: false, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  try {
    await fn(page);
  } catch(e) {
    console.log(label + ': ERROR: ' + e.message);
    await browser.close();
    return;
  }
  
  // Analyze chain
  const chain = {
    navigate: logs.some(l => l.includes('navigate(') || l.includes('[DEFER-NAV]')),
    defer: logs.some(l => l.includes('[DEFER-NAV]')),
    syncCall: logs.some(l => l.includes('syncPortStateFromSW() called') || l.includes('syncing port state')),
    syncResp: logs.some(l => l.includes('portReady:') && l.includes('status:')),
    portSync: logs.some(l => l.includes('[PORT_SYNC]')),
    flush: logs.some(l => l.includes('[FLUSH-NAV]') || l.includes('flushing pending navigations')),
    iframeSrc: logs.some(l => l.includes('[UV-ROUTE]') || l.includes('ASSIGNING iframe.src')),
    bootFail: logs.some(l => l.includes('FAILED')),
    portReady: logs.some(l => l.includes('portReady: true') || l.includes('[PORT_READY]')),
  };
  
  const finalState = await page.evaluate(() => ({
    portReady: window.__UV_BOOT_STATUS__?.portReady,
    pendingNavs: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
    iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0,130)
  }));
  
  // Order the chain events by first appearance
  const eventOrder = ['navigate', 'defer', 'syncCall', 'syncResp', 'portSync', 'flush', 'iframeSrc'];
  let firstMissing = null;
  let found = false;
  for (const evt of eventOrder) {
    if (!chain[evt] && !found) { firstMissing = evt; found = true; }
  }
  
  console.log(label + ':');
  console.log('  bootFail=' + chain.bootFail + ' portReady=' + chain.portReady);
  eventOrder.forEach(e => console.log('  ' + (chain[e] ? '+' : '-') + ' ' + e));
  if (firstMissing) console.log('  *** FIRST MISSING: ' + firstMissing + ' ***');
  else console.log('  *** ALL EVENTS PRESENT ***');
  console.log('  Final: ' + JSON.stringify(finalState));
  
  await browser.close();
}

async function main() {
  // PATH A: Navigate BEFORE portReady (deferred)
  await testCase('A: Deferred', async (page) => {
    await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => {
      const tryIt = () => {
        if (window.VoltraBrowser) {
          const m = document.createElement('div'); m.id = 'browserMount';
          const mc = document.querySelector('#mainContent') || document.body;
          mc.innerHTML = ''; mc.appendChild(m);
          window.VoltraBrowser.render(m);
          window.VoltraBrowser.navigate('https://example.com');
        } else { setTimeout(tryIt, 5); }
      };
      setTimeout(tryIt, 0);
    });
    await new Promise(r => setTimeout(r, 6000));
  });

  // PATH B: Navigate AFTER portReady (immediate)
  await testCase('B: Immediate', async (page) => {
    await page.goto('http://localhost:8080/', { waitUntil: 'networkidle', timeout: 15000 });
    await new Promise(r => setTimeout(r, 3000));
    await page.evaluate(() => {
      const m = document.createElement('div'); m.id = 'browserMount';
      const mc = document.querySelector('#mainContent') || document.body;
      mc.innerHTML = ''; mc.appendChild(m);
      window.VoltraBrowser.render(m);
      window.VoltraBrowser.navigate('https://example.com');
    });
    await new Promise(r => setTimeout(r, 3000));
  });

  // PATH C: Reload + navigate immediately (SW already active)
  await testCase('C: Reload + navigate', async (page) => {
    await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
    await new Promise(r => setTimeout(r, 5000));
    await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.evaluate(() => {
      const tryIt = () => {
        if (window.VoltraBrowser) {
          const m = document.createElement('div'); m.id = 'browserMount';
          const mc = document.querySelector('#mainContent') || document.body;
          mc.innerHTML = ''; mc.appendChild(m);
          window.VoltraBrowser.render(m);
          window.VoltraBrowser.navigate('https://example.com');
        } else { setTimeout(tryIt, 5); }
      };
      setTimeout(tryIt, 0);
    });
    await new Promise(r => setTimeout(r, 6000));
  });
}

main().catch(e => console.error('FATAL:', e));
