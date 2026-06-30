import { chromium } from 'playwright';

const URL = 'http://localhost:8080';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await page.context().newCDPSession(page);

  // Listen for SW target creation and attach debugger to it
  cdp.on('Target.attachedToTarget', async (event) => {
    if (event.targetInfo.type === 'service_worker') {
      console.log(`[CDP] SW attached: ${event.targetInfo.url}`);
      // The session for the SW is event.sessionId
      // But we can also create a new CDP session to the target
      try {
        const swSession = await cdp.send('Target.attachToTarget', {
          targetId: event.targetInfo.targetId,
          flatten: true
        });
        console.log('[CDP] SW session created, sessionId:', swSession.sessionId);
        
        // Enable Runtime on the SW session
        // Note: with flatten=true, we should receive events via the parent session
        await cdp.send('Runtime.enable', {}); // this might go to page, not SW
      } catch(e) {
        console.log('[CDP] Failed to attach to SW:', e.message);
      }
    }
  });

  cdp.on('Runtime.consoleAPICalled', (event) => {
    const args = (event.args || []).map(a => a.value ?? a.description).join(' ');
    const execCtx = event.executionContextId;
    console.log(`[CONSOLE ctx=${execCtx}] ${args}`);
  });

  cdp.on('Runtime.exceptionThrown', (event) => {
    console.log(`[EXCEPTION] ${event.exceptionDetails?.text}`, 
      event.exceptionDetails?.exception?.description || '');
  });

  await cdp.send('Runtime.enable');
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true
  });

  console.log('Navigating...');
  await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
  console.log('Page loaded.');

  await new Promise(r => setTimeout(r, 5000));

  await browser.close();
  console.log('Done');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
