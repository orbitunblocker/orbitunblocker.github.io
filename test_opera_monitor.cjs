const { chromium } = require('playwright');
const EXE = 'C:\\Users\\abeni\\AppData\\Local\\Programs\\Opera GX\\opera.exe';

async function main() {
  const browser = await chromium.launch({ executablePath: EXE, headless: false, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(15000);
  
  await ctx.addInitScript(() => {
    let _portReadyVal = undefined;
    let _bsObj = undefined;
    let _lastStack = '';
    
    // Poll portReady every 10ms and log any change
    function startPoller() {
      let last = window.__UV_BOOT_STATUS__?.portReady;
      setInterval(() => {
        const current = window.__UV_BOOT_STATUS__?.portReady;
        if (current !== last) {
          const err = new Error();
          const stackLines = err.stack?.split('\n');
          console.log('[POLL] portReady changed: ' + last + ' -> ' + current + ' at ' + Date.now() + ' stack: ' + (stackLines ? stackLines.slice(0,4).join(' | ') : 'no stack'));
          last = current;
        }
        // Also detect if __UV_BOOT_STATUS__ object was replaced
        if (window.__UV_BOOT_STATUS__ !== _bsObj && _bsObj !== undefined) {
          console.log('[POLL] __UV_BOOT_STATUS__ object REPLACED at ' + Date.now() + ' old_bs_keys=' + Object.keys(_bsObj).join(',') + ' new_bs_keys=' + Object.keys(window.__UV_BOOT_STATUS__).join(','));
          _bsObj = window.__UV_BOOT_STATUS__;
        }
        if (_bsObj === undefined && window.__UV_BOOT_STATUS__) {
          _bsObj = window.__UV_BOOT_STATUS__;
        }
      }, 10);
    }
    
    // Wait for boot status to exist, then start polling
    const _wait = setInterval(() => {
      if (window.__UV_BOOT_STATUS__) {
        _bsObj = window.__UV_BOOT_STATUS__;
        _portReadyVal = window.__UV_BOOT_STATUS__.portReady;
        startPoller();
        clearInterval(_wait);
      }
    }, 1);
    
    // Also override _update to track portReady changes immediately
    const _wait2 = setInterval(() => {
      if (window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__._update) {
        const orig = window.__UV_BOOT_STATUS__._update;
        if (!orig.__tracked) {
          window.__UV_BOOT_STATUS__._update = function(k, v) {
            console.log('[UPD] _update("' + k + '", ' + JSON.stringify(v) + ') at ' + Date.now());
            return orig.call(this, k, v);
          };
          window.__UV_BOOT_STATUS__._update.__tracked = true;
        }
        clearInterval(_wait2);
      }
    }, 1);
  });
  
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', msg => logs.push(msg.text()));
  
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  console.log('First load done, waiting 5s...');
  await new Promise(r => setTimeout(r, 5000));
  
  // Cache-bust JS files on reload
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
  
  await new Promise(r => setTimeout(r, 8000));
  
  console.log('=== UPD (all _update calls on reload) ===');
  logs.filter(l => l.includes('[UPD]')).forEach(l => console.log('  ' + l));
  
  console.log('\n=== POLL (portReady changes) ===');
  logs.filter(l => l.includes('[POLL]')).forEach(l => console.log('  ' + l));
  
  console.log('\n=== KEY EVENTS ===');
  logs.filter(l => l.includes('[PORT_SYNC]') || l.includes('[PORT_READY]') || l.includes('[DEFER') || l.includes('[FLUSH') || l.includes('[UV-ROUTE')).forEach(l => console.log('  ' + l));
  
  const final = await page.evaluate(() => ({
    portReady: window.__UV_BOOT_STATUS__?.portReady,
    pendingNavs: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
    iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0,130)
  }));
  console.log('\n=== FINAL ===');
  console.log(JSON.stringify(final, null, 2));
  
  await ctx.close();
  await browser.close();
}

main().catch(e => console.error('FATAL:', e));
