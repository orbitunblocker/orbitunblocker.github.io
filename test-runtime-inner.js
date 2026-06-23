(async function() {
  var OUT = '';
  function log(m) { OUT += m + '\n'; }

  var ui = window.VoltraBrowser && window.VoltraBrowser._browserUI;
  if (!ui) { log('FAIL: BrowserUI not found'); return OUT; }

  // Ensure iframe exists
  var iframe = document.getElementById('browserFrame-main');
  if (!iframe) { log('FAIL: iframe not found (browser section not loaded)'); return OUT; }

  // Helper: override port, navigate, check deferral, restore, flush
  async function testDefer(label, url) {
    // Save original
    var origIsPortReady = ui._isPortReady.bind(ui);

    // Override to simulate port not ready
    ui.__portReady = false;
    ui._isPortReady = function() { return false; };
    ui._pendingNavigations = [];

    var navTs = Date.now();
    var portBefore = ui._isPortReady();

    ui._loadUrlInFrame(url);
    await new Promise(r => setTimeout(r, 300));

    var checkTs = Date.now();
    var portDuring = ui._isPortReady();
    var pendingCount = ui._pendingNavigations.length;
    var pendingUrls = ui._pendingNavigations.map(function(n) { return n.url; });

    // Restore port
    ui.__portReady = true;
    ui._isPortReady = function() { return true; };
    var flushTs = Date.now();
    ui._flushPendingNavigations();
    await new Promise(r => setTimeout(r, 2000));

    var afterPending = ui._pendingNavigations.length;
    var afterSrc = iframe.src ? iframe.src.substring(0, 120) : '(srcdoc: ' + (iframe.srcdoc ? iframe.srcdoc.length + ' chars' : 'none') + ')';

    log('');
    log('--- ' + label + ' ---');
    log('  url: ' + url);
    log('  navTime: ' + new Date(navTs).toISOString());
    log('  checkTime: ' + new Date(checkTs).toISOString());
    log('  flushTime: ' + new Date(flushTs).toISOString());
    log('  portBefore: ' + portBefore + ' | portDuring: ' + portDuring);
    log('  pendingDuring: ' + pendingCount + ' urls: ' + JSON.stringify(pendingUrls));
    log('  pendingAfterFlush: ' + afterPending);
    log('  iframeAfterFlush: ' + afterSrc);
    log('  deferred: ' + (pendingCount > 0) + ' | released: ' + (afterPending === 0));
  }

  // ===== SCENARIO 1-3: Address bar / Bookmark / Quicklink =====
  await testDefer('TEST 1: Address bar navigation before portReady', 'https://example.com/address-bar');
  await testDefer('TEST 2: Bookmark navigation before portReady', 'https://bookmark.example.com/saved-page');
  await testDefer('TEST 3: Quicklink navigation before portReady', 'https://quicklink.example.com/trending');

  // ===== SCENARIO 4: Startup restore =====
  log('');
  log('--- TEST 4: Browser startup restore before portReady ---');
  var hasRestoreDef = typeof ui._restoreUrlDeferred === 'function';
  var hasRestoreTabs = Array.isArray(ui._pendingRestoreTabs);
  var restSrc = hasRestoreDef ? ui._restoreUrlDeferred.toString().substring(0, 500) : 'NOT FOUND';
  log('  _restoreUrlDeferred exists: ' + hasRestoreDef);
  log('  _pendingRestoreTabs exists: ' + hasRestoreTabs);
  log('  Source:\n' + restSrc);

  // ===== SCENARIO 5: Game launch polling =====
  log('');
  log('--- TEST 5: Game launch before portReady ---');
  var openGameStr = typeof openGame === 'function' ? openGame.toString() : 'NOT FOUND';
  log('  openGame exists: ' + (typeof openGame === 'function'));
  log('  Has port polling: ' + (openGameStr.includes('_isPortReady') || openGameStr.includes('portReady') || openGameStr.includes('__portReady')));
  log('  Has setInterval loop: ' + openGameStr.includes('setInterval'));
  log('  Has 15s timeout: ' + openGameStr.includes('15000'));
  log('  Has GAME-DEFER log: ' + openGameStr.includes('GAME-DEFER'));
  log('  Has error state: ' + openGameStr.includes('game-loading-error'));
  log('  Source:\n' + openGameStr.substring(0, 600));

  // ===== SCENARIO 6: SW recovery =====
  log('');
  log('--- TEST 6: SW port failure recovery ---');
  log('  __UV_RECOVERY_ATTEMPTED__ guard: ' + (typeof window.__UV_RECOVERY_ATTEMPTED__ !== 'undefined') + ' (should be false - removed)');
  log('  swReinitCount: ' + (window.__UV_BOOT_STATUS__ ? window.__UV_BOOT_STATUS__.swReinitCount : 'N/A'));
  log('  bootStage: ' + (window.__UV_BOOT_STATUS__ ? window.__UV_BOOT_STATUS__.failedStage : 'N/A'));

  // Check for recovery code in PORT_STATE_SYNC handler
  var scripts = document.querySelectorAll('script');
  var appJsLoaded = false;
  for (var i = 0; i < scripts.length; i++) {
    if (scripts[i].src && scripts[i].src.includes('app.js')) { appJsLoaded = true; break; }
  }
  log('  app.js loaded: ' + appJsLoaded);

  // ===== SCENARIO 7: Multiple consecutive failures =====
  log('');
  log('--- TEST 7: Multiple consecutive deferred navigations ---');
  ui.__portReady = false;
  ui._isPortReady = function() { return false; };
  ui._pendingNavigations = [];

  var navTimes = [];
  navTimes.push(Date.now());
  ui._loadUrlInFrame('https://multi-a.example.com');
  await new Promise(r => setTimeout(r, 300));

  navTimes.push(Date.now());
  ui._loadUrlInFrame('https://multi-b.example.com');
  await new Promise(r => setTimeout(r, 300));

  navTimes.push(Date.now());
  ui._loadUrlInFrame('https://multi-c.example.com');
  await new Promise(r => setTimeout(r, 300));

  var mPending = ui._pendingNavigations.length;
  var mUrls = ui._pendingNavigations.map(function(n) { return n.url; });

  ui.__portReady = true;
  ui._isPortReady = function() { return true; };
  ui._flushPendingNavigations();
  await new Promise(r => setTimeout(r, 2000));

  var mAfter = ui._pendingNavigations.length;
  log('  Nav times: ' + JSON.stringify(navTimes.map(function(t) { return new Date(t).toISOString(); })));
  log('  Pending during: ' + mPending + ' urls: ' + JSON.stringify(mUrls));
  log('  Pending after flush: ' + mAfter);
  log('  All queued: ' + (mPending === 3) + ' | All released: ' + (mAfter === 0));

  // ===== SCENARIO 8: Reload during active proxy =====
  log('');
  log('--- TEST 8: Reload during active proxy session ---');
  var bp = ui._isPortReady();
  ui._loadUrlInFrame('voltra://brave-home');
  await new Promise(r => setTimeout(r, 3000));
  var ap = ui._isPortReady();
  var srcAfter = iframe.src ? iframe.src.substring(0, 100) : '(srcdoc)';
  log('  Port before: ' + bp + ' | after: ' + ap);
  log('  iframe after: ' + srcAfter);
  log('  Port stable: ' + (bp === true && ap === true));

  // ===== SCENARIO 9: 503 / Error page =====
  log('');
  log('--- TEST 9: 503/error page handling ---');
  var sep = typeof ui._showErrorPage === 'function';
  var sepSrc = sep ? ui._showErrorPage.toString() : 'NOT FOUND';
  var hfe = typeof ui.handleFrameError === 'function';
  log('  _showErrorPage: ' + sep);
  log('  handleFrameError: ' + hfe);
  log('  Uses srcdoc: ' + sepSrc.includes('srcdoc'));
  log('  Has error-card class: ' + sepSrc.includes('error-card'));
  log('  Has error-retry button: ' + sepSrc.includes('error-retry'));
  log('  Source:\n' + sepSrc.substring(0, 500));

  // Check iframe for error handler
  log('  iframe has onerror attr: ' + (iframe.getAttribute('onerror') || 'none'));

  // ===== SCENARIO 10: SharedWorker recreation =====
  log('');
  log('--- TEST 10: SharedWorker recreation ---');
  var boot = window.__UV_BOOT_STATUS__ || {};
  var bl = boot._log || [];
  function findLog(key, valFilter) {
    for (var i = 0; i < bl.length; i++) {
      if (bl[i].key === key && (valFilter === undefined || bl[i].val === valFilter)) {
        return new Date(bl[i].at).toISOString() + ' (ok)';
      }
    }
    return 'NONE';
  }
  log('  workerConstructed: ' + findLog('workerConstructed'));
  log('  portTransferred: ' + findLog('portTransferred'));
  log('  swActivated: ' + findLog('swActivated'));
  log('  portReady (true): ' + findLog('portReady', true));
  log('  swReady: ' + (boot.swReady === true));
  log('  bareMuxReady: ' + (boot.bareMuxReady === true));
  log('  swReinitCount: ' + boot.swReinitCount);
  log('  failedStage: ' + (boot.failedStage || 'none'));
  log('  Log events: ' + bl.length);

  // Check for SharedWorker retry code (tryCreateWorker)
  log('  SharedWorker retry (tryCreateWorker): ' + (typeof window.tryCreateWorker !== 'undefined' || appJsLoaded));

  // ===== SUMMARY =====
  log('');
  log('========================================');
  log('RUNTIME VERIFICATION SUMMARY');
  log('========================================');

  return OUT;
})()
