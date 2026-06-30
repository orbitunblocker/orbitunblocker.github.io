import { chromium } from 'playwright';

const URL = 'http://localhost:8080';

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Take control of page CDP
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable');
  await cdp.send('Console.enable');
  
  // Auto-attach with waitForDebuggerOnStart to catch SW eval
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: true,  // Pause SW before it starts executing
    flatten: true
  });

  // When SW is created, attach a dedicated CDP session
  cdp.on('Target.attachedToTarget', async (event) => {
    const info = event.targetInfo;
    if (info.type === 'service_worker') {
      console.log(`[CDP] SW target detected: ${info.url} id=${info.targetId}`);
      
      try {
        // Attach to the SW and get its session
        const swSessionResult = await cdp.send('Target.attachToTarget', {
          targetId: info.targetId,
          flatten: true
        });
        console.log('[CDP] Attached to SW, session:', swSessionResult.sessionId);
        
        // Wait a tick for the session to be ready
        await new Promise(r => setTimeout(r, 100));
        
        // We need to communicate with the SW via its own session.
        // With flatten=true and Target.attachToTarget, events come through parent.
        // But we need to send commands to the child session.

        // Enable console and runtime on the SW
        // With flatten, commands sent to parent with sessionId target the child.
        // Actually, Target.attachToTarget with flatten creates a session that
        // is addressable via the returned sessionId.
        
        // We can send commands to the child session using:
        // await cdp.send('Runtime.enable', { sessionId: swSessionResult.sessionId });
        // But the CDP API in Playwright doesn't support sessionId parameter directly.
        
        // Alternative: use the raw CDP send
        await cdp.send('Runtime.enable');
        await cdp.send('Console.enable');
        
        // Now let the SW run
        await cdp.send('Runtime.runIfWaitingForDebugger');
        console.log('[CDP] SW execution resumed');
        
        // Listen for console messages - these should come through with flatten
        // But actually they'll come through the child session, which we need
        // to intercept separately.
        
      } catch(e) {
        console.log('[CDP] SW attach error:', e.message);
        // Still try to resume if attach fails
        try { await cdp.send('Runtime.runIfWaitingForDebugger'); } catch(_) {}
      }
    }
  });

  // Listen for console from all targets (with flatten, should include child targets)
  cdp.on('Runtime.consoleAPICalled', (event) => {
    const args = (event.args || []).map(a => a.value ?? a.description).join(' ');
    const ctxName = event.executionContextId;
    console.log(`[SW-CONSOLE ctx=${ctxName}] ${args}`);
  });

  cdp.on('Runtime.exceptionThrown', (event) => {
    console.log(`[SW-EXCEPTION] ${event.exceptionDetails?.text}`, 
      event.exceptionDetails?.exception?.description || '');
  });

  cdp.on('Console.messageAdded', (event) => {
    console.log(`[CONSOLE-API] ${event.message?.text}`);
  });

  console.log('Navigating...');
  await page.goto(URL, { waitUntil: 'load', timeout: 20000 });
  console.log('Page loaded.');

  await new Promise(r => setTimeout(r, 5000));

  await browser.close();
  console.log('Done');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
