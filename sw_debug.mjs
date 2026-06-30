import { chromium } from 'playwright';

const URL = 'http://localhost:8080';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  // Use CDP to capture SW console logs
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true
  });

  // Log all target-created events (including SW)
  cdp.on('Target.attachedToTarget', (event) => {
    const info = event.targetInfo;
    console.log(`[CDP] Target created: type=${info.type} url=${info.url} id=${info.targetId}`);
  });

  // Listen for console messages from ALL targets
  cdp.on('Runtime.consoleAPICalled', (event) => {
    const args = (event.args || []).map(a => a.value ?? a.description).join(' ');
    console.log(`[SW-CONSOLE] ${args}`);
  });

  cdp.on('Runtime.exceptionThrown', (event) => {
    console.log(`[SW-EXCEPTION] ${event.exceptionDetails?.text}`, event.exceptionDetails?.exception);
  });

  console.log('Navigating...');
  await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
  console.log('Page loaded. Title:', await page.title());

  // Wait for SW registration result
  await new Promise(r => setTimeout(r, 5000));

  await browser.close();
  console.log('Done');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
