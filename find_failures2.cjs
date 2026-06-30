const { chromium } = require('playwright');

async function getDiag(page) {
  try {
    return await page.evaluate(() => {
      return new Promise((resolve, reject) => {
        const ctrl = navigator.serviceWorker.controller;
        if (!ctrl) return reject('no controller');
        const ch = new MessageChannel();
        ch.port1.onmessage = e => resolve(e.data);
        ctrl.postMessage({ type: 'GET_DIAG' }, [ch.port2]);
        setTimeout(() => reject('timeout'), 3000);
      });
    });
  } catch(e) {
    return { error: String(e).substring(0, 300) };
  }
}

async function setupBrowser(page) {
  // Ensure browser UI is rendered
  await page.evaluate(() => {
    // Dismiss intro screen
    const intro = document.getElementById('introScreen');
    if (intro && intro.style.display !== 'none') {
      intro.style.display = 'none';
    }
    // Ensure mainContent exists
    let mc = document.getElementById('mainContent');
    if (!mc) {
      mc = document.createElement('div');
      mc.id = 'mainContent';
      document.body.appendChild(mc);
    }
    mc.innerHTML = '';
    const mount = document.createElement('div');
    mount.id = 'browserMount';
    mc.appendChild(mount);
    if (window.VoltraBrowser && typeof window.VoltraBrowser.render === 'function') {
      // Also set the main content as the mainContent reference
      window.VoltraBrowser.render(mount);
    }
  });
  await page.waitForTimeout(500);
  // Verify iframe exists
  const hasIframe = await page.evaluate(() => !!document.getElementById('browserFrame-main'));
  if (!hasIframe) {
    console.log('ERROR: browserFrame-main iframe not created by render()');
    return false;
  }
  return true;
}

const SITES = [
  'https://www.google.com/',
  'https://github.com/',
  'https://stackoverflow.com/',
  'https://reddit.com/',
  'https://twitter.com/',
  'https://youtube.com/',
  'https://www.bing.com/',
  'https://www.cloudflare.com/',
  'https://www.instagram.com/',
  'https://www.linkedin.com/',
  'https://discord.com/',
  'https://www.notion.so/',
  'https://www.twitch.tv/',
  'https://chat.openai.com/',
  'https://www.amazon.com/',
  'https://www.bbc.com/',
  'https://www.cnn.com/',
  'https://en.wikipedia.org/wiki/Main_Page',
  'https://www.nytimes.com/',
  'https://www.forbes.com/',
  'https://medium.com/',
  'https://www.figma.com/',
  'https://www.netflix.com/',
  'https://www.spotify.com/',
  'https://www.ebay.com/',
  'https://www.etsy.com/',
  'https://www.shopify.com/',
  'https://news.ycombinator.com/',
  'https://www.quora.com/',
  'https://dev.to/',
  'https://hashnode.com/',
  'https://www.producthunt.com/',
  'https://www.behance.net/',
  'https://dribbble.com/',
  'https://lichess.org/',
  'https://www.khanacademy.org/',
  'https://www.coursera.org/',
  'https://developer.mozilla.org/',
  'https://www.freecodecamp.org/',
  'https://angular.dev/',
  'https://vuejs.org/',
  'https://react.dev/',
  'https://nextjs.org/',
  'https://www.typescriptlang.org/',
  'https://nodejs.org/',
  'https://www.docker.com/',
  'https://kubernetes.io/',
  'https://www.python.org/',
  'https://rust-lang.org/',
  'https://huggingface.co/',
  'https://www.slack.com/',
  'https://zoom.us/',
  'https://vercel.com/',
  'https://netlify.com/',
  'https://gitlab.com/',
  'https://atlassian.com/',
  'https://neverssl.com/',
  'https://httpbin.org/get',
  'https://www.wikipedia.org/',
  'https://www.airbnb.com/',
  'https://www.yelp.com/',
  'https://www.twitch.tv/',
  'https://www.adobe.com/',
  'https://www.office.com/',
];

async function main() {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(20000);
  const page = await ctx.newPage();
  
  page.on('console', msg => {});
  page.on('pageerror', err => console.log('  PAGE ERROR:', err.message.substring(0, 200)));
  page.on('crash', () => console.log('  *** PAGE CRASHED ***'));

  console.log('Loading Orbit...');
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Wait for SW
  for (let i = 0; i < 20; i++) {
    const d = await getDiag(page);
    if (d.portState?.status === 'ready') break;
    await page.waitForTimeout(500);
  }

  // Setup browser UI
  const ok = await setupBrowser(page);
  if (!ok) { console.log('Failed to setup browser UI'); await browser.close(); return; }

  // Navigate to a safe site to ensure everything works
  await page.evaluate(() => window.VoltraBrowser.navigate('https://example.com/'));
  await page.waitForTimeout(2000);
  const warmupState = await page.evaluate(() => ({
    iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0, 80),
    iframeDoc: (() => { const f = document.getElementById('browserFrame-main'); try { return f?.contentDocument?.readyState || 'no-doc'; } catch(e) { return 'error'; } })(),
  })).catch(() => ({}));
  console.log('Warmup state:', JSON.stringify(warmupState));

  // Test sites
  const results = [];
  for (const url of SITES) {
    process.stdout.write(`  ${url.substring(0, 55)} `);
    try {
      await page.evaluate((u) => window.VoltraBrowser.navigate(u), url);
      await page.waitForTimeout(12000);
      const state = await page.evaluate(() => ({
        pending: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
        portReady: window.__UV_BOOT_STATUS__?.portReady,
        iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0, 80),
        readyState: (() => { const f = document.getElementById('browserFrame-main'); try { return f?.contentDocument?.readyState || 'blocked'; } catch(e) { return 'error'; } })(),
      }));
      const ok = state.pending === 0 && state.portReady === true && (state.readyState === 'complete' || state.readyState === 'interactive');
      if (ok) process.stdout.write('OK\n');
      else { results.push({ url, state }); process.stdout.write(`FAIL ${JSON.stringify(state)}\n`); }
    } catch(e) {
      results.push({ url, error: e.message.substring(0, 120) });
      process.stdout.write(`CRASH ${e.message.substring(0, 60)}\n`);
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Tested ${SITES.length}`);
  console.log(`FAILURES: ${results.length}`);
  results.forEach(r => console.log(`  ${r.url}: ${r.state ? JSON.stringify(r.state) : r.error}`));

  await ctx.close();
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
