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
    return { error: String(e).substring(0, 200) };
  }
}

const SITES = [
  ['https://www.google.com/', 'first test'],
  ['https://github.com/', ''],
  ['https://stackoverflow.com/', ''],
  ['https://news.ycombinator.com/', ''],
  ['https://reddit.com/', ''],
  ['https://twitter.com/', ''],
  ['https://discord.com/', ''],
  ['https://www.instagram.com/', ''],
  ['https://www.linkedin.com/', ''],
  ['https://www.facebook.com/', ''],
  ['https://youtube.com/', ''],
  ['https://www.bing.com/', ''],
  ['https://www.cloudflare.com/', ''],
  ['https://www.notion.so/', ''],
  ['https://www.twitch.tv/', ''],
  ['https://www.amazon.com/', ''],
  ['https://www.bbc.com/', ''],
  ['https://www.cnn.com/', ''],
  ['https://chat.openai.com/', ''],
  ['https://en.wikipedia.org/wiki/Main_Page', ''],
  ['https://www.nytimes.com/', ''],
  ['https://www.forbes.com/', ''],
  ['https://medium.com/', ''],
  ['https://www.quora.com/', ''],
];

async function main() {
  const browser = await chromium.launch({ headless: false, args: ['--no-sandbox', '--disable-gpu'] });
  const ctx = await browser.newContext();
  ctx.setDefaultTimeout(15000);
  const failures = [];
  const successes = [];

  async function ensurePageReady(page) {
    try {
      await page.evaluate(() => 1);
      return page;
    } catch {
      const p = await ctx.newPage();
      p.on('console', msg => {});
      console.log('  (recreated page)');
      await p.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
      await p.waitForTimeout(2000);
      for (let i = 0; i < 30; i++) {
        const d = await getDiag(p);
        if (d.portState?.status === 'ready') break;
        await p.waitForTimeout(500);
      }
      return p;
    }
  }

  let page = await ctx.newPage();
  page.on('console', msg => {});
  console.log('Loading Orbit...');
  await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);
  for (let i = 0; i < 30; i++) {
    const d = await getDiag(page);
    if (d.portState?.status === 'ready') break;
    await page.waitForTimeout(500);
  }
  console.log('SW ready. Starting tests...\n');

  for (const [url, note] of SITES) {
    page = await ensurePageReady(page);
    process.stdout.write(`${note || ''} ${url.substring(0, 50)} `.trimStart());
    try {
      await page.evaluate((u) => {
        if (window.VoltraBrowser) window.VoltraBrowser.navigate(u);
      }, url);
      await page.waitForTimeout(10000);
      const state = await page.evaluate(() => ({
        pending: window.VoltraBrowser?._browserUI?._pendingNavigations?.length,
        portReady: window.__UV_BOOT_STATUS__?.portReady,
        iframeSrc: document.getElementById('browserFrame-main')?.src?.substring(0, 100),
        readyState: (() => { const f = document.getElementById('browserFrame-main'); try { return f?.contentDocument?.readyState || 'blocked'; } catch(e) { return 'error'; } })(),
      }));
      const ok = state.pending === 0 && state.portReady === true && state.readyState === 'complete';
      if (ok) successes.push(url);
      else failures.push({ url, state });
      process.stdout.write(ok ? 'OK\n' : `FAIL ${JSON.stringify(state)}\n`);

      // Reload page between tests to avoid state corruption
      page = await ensurePageReady(page);
    } catch(e) {
      failures.push({ url, error: e.message.substring(0, 150) });
      process.stdout.write(`CRASH ${e.message.substring(0, 80)}\n`);
    }
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`OK: ${successes.length}, FAIL: ${failures.length}`);
  failures.forEach(f => console.log(`  ${f.url}: ${f.state ? JSON.stringify(f.state) : f.error}`));

  await ctx.close();
  await browser.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
