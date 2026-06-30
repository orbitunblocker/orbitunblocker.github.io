const { chromium } = require('playwright');
const EXE = 'C:\\Users\\abeni\\AppData\\Local\\Programs\\Opera GX\\opera.exe';

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: false, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(15000);
  
  // Wrapping page code to capture syncPortStateFromSW errors
  await ctx.addInitScript(() => {
    // Wrap navigator.serviceWorker.ready and postMessage to see what's happening
    const _realReady = navigator.serviceWorker.ready;
    let _readyResolve = null;
    
    // Track all postMessage calls from page to SW
    const _origPostMessage = MessagePort.prototype.postMessage;
    // Can't override easily, let's use a different approach
    
    // Poll and log SW registration state
    setInterval(() => {
      if (!('serviceWorker' in navigator)) return;
      const reg = navigator.serviceWorker.controller;
      const activeSW = reg?.scriptURL || 'no controller';
      if (reg) {
        console.log('[SW-STATUS] controller: ' + reg.scriptURL + ' state: ' + reg.state + ' at ' + Date.now());
      } else {
        console.log('[SW-STATUS] no controller at ' + Date.now());
      }
    }, 100).unref?.();
    
    // Track the SW registration
    const _origRegister = navigator.serviceWorker.register;
    navigator.serviceWorker.register = function() {
      console.log('[SW-REG] register() called at ' + Date.now() + ' args: ' + JSON.stringify([...arguments].map(a => typeof a)));
      return _origRegister.apply(this, arguments).then(reg => {
        console.log('[SW-REG] register() resolved at ' + Date.now() + ' active: ' + (reg.active ? reg.active.scriptURL : 'null') + ' installing: ' + (reg.installing ? 'yes' : 'null') + ' waiting: ' + (reg.waiting ? 'yes' : 'null'));
        // Monitor activation
        reg.addEventListener('updatefound', () => {
          console.log('[SW-REG] updatefound at ' + Date.now() + ' installing: ' + (reg.installing ? reg.installing.state : 'null'));
          if (reg.installing) {
            reg.installing.addEventListener('statechange', () => {
              console.log('[SW-REG] statechange: ' + reg.installing.state + ' at ' + Date.now());
            });
          }
        });
        return reg;
      }).catch(err => {
        console.log('[SW-REG] register() FAILED at ' + Date.now() + ' err: ' + err.message);
        throw err;
      });
    };
  });
  
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  console.log('First load done, waiting 5s...');
  await new Promise(r => setTimeout(r, 5000));
  
  // Cache-bust
  await page.route('**/js/*.js', async route => {
    const url = new URL(route.request().url());
    url.searchParams.set('_cb', '' + Date.now());
    await route.continue({ url: url.toString() });
  });
  
  await page.goto('http://localhost:8080/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  console.log('Reload done, waiting 2s...\n');
  await new Promise(r => setTimeout(r, 2000));
  
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
  
  console.log('=== SW-STATUS (timeline) ===');
  const swLogs = logs.filter(l => l.includes('[SW-STATUS]') || l.includes('[SW-REG]'));
  // Group by reload
  swLogs.forEach(l => console.log('  ' + l.substring(0, 200)));
  
  console.log('\n=== KEY EVENTS ===');
  logs.filter(l => l.includes('[PORT_SYNC]') || l.includes('[PORT_READY]') || l.includes('[DEFER') || l.includes('[FLUSH') || l.includes('[UV-ROUTE') || l.includes('failedStage') || l.includes('failedStage')).forEach(l => console.log('  ' + l));
  
  const final = await page.evaluate(() => ({
    portReady: window.__UV_BOOT_STATUS__?.portReady,
    failedStage: window.__UV_BOOT_STATUS__?.failedStage,
    pendingNavs: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
    iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0,130)
  }));
  console.log('\n=== FINAL ===');
  console.log(JSON.stringify(final, null, 2));
  
  await ctx.close();
  await browser.close();
}

main().catch(e => console.error('FATAL:', e));
