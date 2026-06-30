// Capture SW errors via CDP Log domain
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  
  // Create CDP session
  const cdp = await page.context().newCDPSession(page);
  
  // Enable relevant domains
  await cdp.send('Log.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Console.enable');
  
  // Set auto-attach for SW
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true
  });
  
  // Listen for ALL log entries
  cdp.on('Log.entryAdded', (event) => {
    const e = event.entry;
    if (e.source === 'service-worker' || e.url?.includes('sw.js')) {
      console.log(`[CDP-SW-LOG] ${e.level}: ${e.text}${e.url ? ' at ' + e.url : ''}`);
    }
  });
  
  // Listen for console API calls
  cdp.on('Runtime.consoleAPICalled', (event) => {
    const args = (event.args || []).map(a => a.value ?? a.description).join(' ');
    console.log(`[CDP-CONSOLE] ${args}`);
  });
  
  // Listen for exceptions
  cdp.on('Runtime.exceptionThrown', (event) => {
    console.log(`[CDP-EXCEPTION] ${event.exceptionDetails?.text}`, event.exceptionDetails?.exception?.description || '');
    if (event.exceptionDetails?.stackTrace) {
      console.log(`[CDP-EXCEPTION-STACK] ${event.exceptionDetails.stackTrace.callFrames?.map(f => `${f.url}:${f.lineNumber}:${f.columnNumber}`).join('\n  ')}`);
    }
  });
  
  // Listen for target lifecycle events
  cdp.on('Target.attachedToTarget', (event) => {
    console.log(`[CDP-TARGET] attached: ${event.targetInfo.type} ${event.targetInfo.url}`);
  });
  
  cdp.on('Target.detachedFromTarget', (event) => {
    console.log(`[CDP-TARGET] detached: session=${event.sessionId}`);
  });
  
  console.log('Navigating...');
  try {
    await page.goto('http://localhost:8080/', { waitUntil: 'load', timeout: 15000 });
    console.log('Page loaded');
  } catch(e) {
    console.log('Goto timeout/error:', e.message.substring(0, 100));
  }
  
  await new Promise(r => setTimeout(r, 5000));
  
  await browser.close();
  console.log('Done');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
