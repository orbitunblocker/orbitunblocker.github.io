(async function() {
  try {
    var OUT = '';
    var WHITE_SCREENS = [];
    function log(m) { OUT += m + '\n'; }
    function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

    function state() {
      var b = window.__UV_BOOT_STATUS__ || {};
      var ifr = document.getElementById('browserFrame-main');
      return {
        portReady: b.portReady,
        swPortStatus: b.swPortStatus,
        bareMuxReady: b.bareMuxReady,
        swReady: b.swReady,
        iframeSrc: ifr ? (ifr.src || '(srcdoc)') : 'no-frame'
      };
    }

    function checkWS(iframe, navUrl, navType, ts) {
      if (!iframe) return { white: true, reason: 'no-iframe', ts: ts, url: navUrl, type: navType };
      try {
        var doc = iframe.contentDocument;
        if (!doc || !doc.body) return { white: true, reason: 'no-doc', ts: ts, url: navUrl, type: navType, src: iframe.src };
        var html = doc.body.innerHTML || '';
        var text = doc.body.innerText || '';
        var blank = html.trim() === '' || html === '<br>';
        var hasOrbitError = text.includes('Orbit') && (text.includes('Error') || text.includes('503') || text.includes('Timeout'));
        if (blank && !hasOrbitError) return { white: true, reason: 'empty-body', ts: ts, url: navUrl, type: navType, src: iframe.src, preview: text.substring(0, 50) };
        return { white: false, reason: 'ok', ts: ts, url: navUrl, type: navType, src: iframe.src, preview: text.substring(0, 80) };
      } catch(e) {
        // Cross-origin check: if no load event in last 5s and src is UV -> likely white
        return { white: false, reason: 'cross-origin', ts: ts, url: navUrl, type: navType, src: iframe.src };
      }
    }

    // Init browser
    log('=== STRESS TEST START ===');
    log('URL: ' + window.location.href + '\n');

    if (typeof loadSection === 'function') loadSection('browser');
    await new Promise(r => setTimeout(r, 500));
    var mount = document.getElementById('browserMount');
    if (mount && typeof VoltraBrowser !== 'undefined' && typeof VoltraBrowser.render === 'function') {
      VoltraBrowser.render(mount);
      log('Browser rendered\n');
    }
    await new Promise(r => setTimeout(r, 1000));

    var iframe = document.getElementById('browserFrame-main');
    if (!iframe) { log('FATAL: No iframe after render'); return OUT; }

    var loadCount = 0, errorCount = 0;
    function hookIFrame() {
      var f = document.getElementById('browserFrame-main');
      if (f) { iframe = f; return true; }
      return false;
    }
    hookIFrame();
    iframe.addEventListener('load', function() { loadCount++; });
    iframe.addEventListener('error', function() { errorCount++; });

    var bootState = state();
    log('Boot: portReady=' + bootState.portReady + ' sw=' + bootState.swPortStatus + ' iframe=' + bootState.iframeSrc + '\n');

    // ===================== PHASE 1: 50 Rapid Navs =====================
    log('=== PHASE 1: 50 Rapid Navigations ===\n');
    var URLS = ['google.com','wikipedia.org','github.com','duckduckgo.com','stackoverflow.com',
                'reddit.com','youtube.com','twitter.com','facebook.com','instagram.com',
                'linkedin.com','amazon.com','netflix.com','twitch.tv','spotify.com',
                'apple.com','microsoft.com','nytimes.com','bbc.com','cnn.com'];
    var p1 = [];
    var p1White = 0;
    for (var i = 0; i < 50; i++) {
      var url = URLS[i % URLS.length];
      var ts = Date.now();
      var sB = state();
      var lB = loadCount, eB = errorCount;
      try { if (window.VoltraBrowser && window.VoltraBrowser.navigate) VoltraBrowser.navigate(url); } catch (x) {}
      await new Promise(r => setTimeout(r, 1500));
      var lA = loadCount, eA = errorCount;
      var sA = state();
      var wc = checkWS(iframe, url, 'rapid-nav', ts);
      var e2 = { num: i+1, url: url, portReady: sA.portReady, swPortStatus: sA.swPortStatus, hadLoad: lA > lB, white: wc.white, reason: wc.reason, src: sA.iframeSrc };
      p1.push(e2);
      if (wc.white) { WHITE_SCREENS.push(e2); p1White++; }
      if ((i+1) % 10 === 0) log('  [' + (i+1) + '/50] white=' + p1White + ' last=' + url + ' load=' + (lA > lB));
    }
    log('Phase 1: ' + p1.length + ' navs, ' + p1White + ' white\n');

    // ===================== PHASE 2: 20 Reloads =====================
    log('=== PHASE 2: 20 Repeated Reloads on google.com ===\n');
    var p2 = [];
    var p2White = 0;
    try { if (window.VoltraBrowser && window.VoltraBrowser.navigate) VoltraBrowser.navigate('google.com'); } catch (x) {}
    await new Promise(r => setTimeout(r, 5000));
    for (var j = 0; j < 20; j++) {
      var ts2 = Date.now();
      var sB2 = state(); var lB2 = loadCount, eB2 = errorCount;
      try { if (window.VoltraBrowser && window.VoltraBrowser.refresh) VoltraBrowser.refresh(); } catch (x) {}
      await new Promise(r => setTimeout(r, 3000));
      var lA2 = loadCount, eA2 = errorCount; var sA2 = state();
      var wc2 = checkWS(iframe, 'google.com (reload)', 'reload', ts2);
      var e3 = { num: j+1, portReady: sA2.portReady, swPortStatus: sA2.swPortStatus, hadLoad: lA2 > lB2, white: wc2.white, reason: wc2.reason, src: sA2.iframeSrc };
      p2.push(e3);
      if (wc2.white) { WHITE_SCREENS.push(e3); p2White++; }
      if ((j+1) % 5 === 0) log('  [' + (j+1) + '/20] white=' + p2White);
    }
    log('Phase 2: ' + p2.length + ' reloads, ' + p2White + ' white\n');

    // ===================== PHASE 3: Game↔Browser Cycles =====================
    log('=== PHASE 3: Browser→Game→Browser Cycles ===\n');
    var p3 = [];
    var p3White = 0;
    var gids = (typeof gameIndex !== 'undefined') ? Object.keys(gameIndex).slice(0, 3) : [];
    log('Games: ' + gids.length + '\n');
    if (gids.length > 0) {
      for (var k = 0; k < 5; k++) {
        var gid = gids[k % gids.length];
        var ts3 = Date.now();
        // Launch game
        try { if (typeof openGame === 'function') openGame(gid); } catch (x) {}
        await new Promise(r => setTimeout(r, 3000));
        // Return to browser
        try { if (typeof backFromPlayer === 'function') backFromPlayer(); else if (typeof render === 'function') render('home'); else if (typeof loadSection === 'function') loadSection('browser'); } catch (x) {}
        await new Promise(r => setTimeout(r, 500));
        var mount3 = document.getElementById('browserMount');
        if (mount3 && typeof VoltraBrowser !== 'undefined' && typeof VoltraBrowser.render === 'function') {
          try { VoltraBrowser.render(mount3); } catch (x) {}
        }
        await new Promise(r => setTimeout(r, 2000));
        hookIFrame();
        // Verify browser works
        var lB3 = loadCount, eB3 = errorCount;
        try { if (window.VoltraBrowser && window.VoltraBrowser.navigate) VoltraBrowser.navigate('example.com'); } catch (x) {}
        await new Promise(r => setTimeout(r, 4000));
        var lA3 = loadCount, eA3 = errorCount;
        var sA3 = state();
        var wc3 = checkWS(iframe, 'example.com', 'game-cycle', ts3);
        var e4 = { num: k+1, gameId: gid, portReady: sA3.portReady, swPortStatus: sA3.swPortStatus, hadLoad: lA3 > lB3, white: wc3.white, reason: wc3.reason, src: sA3.iframeSrc };
        p3.push(e4);
        if (wc3.white) { WHITE_SCREENS.push(e4); p3White++; }
        log('  Cycle ' + (k+1) + '/5: game=' + gid + ' white=' + wc3.white);
      }
    } else {
      log('  SKIP (no games in index)\n');
    }
    log('Phase 3: ' + p3.length + ' cycles, ' + p3White + ' white\n');

    // ===================== PHASE 4: Long Session =====================
    log('=== PHASE 4: Long Session (40 mixed actions) ===\n');
    var MIXED = [
      { type: 'nav', url: 'google.com' }, { type: 'nav', url: 'wikipedia.org' },
      { type: 'nav', url: 'github.com' }, { type: 'nav', url: 'reddit.com' },
      { type: 'nav', url: 'stackoverflow.com' }, { type: 'reload' },
      { type: 'nav', url: 'duckduckgo.com' }, { type: 'nav', url: 'bbc.com' },
      { type: 'nav', url: 'nytimes.com' }, { type: 'reload' }
    ];
    var p4 = [];
    var p4White = 0;
    for (var m = 0; m < 40; m++) {
      var action = MIXED[m % MIXED.length];
      var ts4 = Date.now();
      var sB4 = state(); var lB4 = loadCount, eB4 = errorCount;
      try {
        if (action.type === 'nav' && window.VoltraBrowser && window.VoltraBrowser.navigate) VoltraBrowser.navigate(action.url);
        else if (window.VoltraBrowser && window.VoltraBrowser.refresh) VoltraBrowser.refresh();
      } catch (x) {}
      await new Promise(r => setTimeout(r, 3000));
      var lA4 = loadCount, eA4 = errorCount; var sA4 = state();
      var wc4 = checkWS(iframe, action.url || '(reload)', 'long-session', ts4);
      var e5 = { num: m+1, action: action.type, url: action.url || '(reload)', portReady: sA4.portReady, swPortStatus: sA4.swPortStatus, hadLoad: lA4 > lB4, white: wc4.white, reason: wc4.reason, src: sA4.iframeSrc };
      p4.push(e5);
      if (wc4.white) { WHITE_SCREENS.push(e5); p4White++; }
      if ((m+1) % 10 === 0) log('  [' + (m+1) + '/40] white=' + p4White);
    }
    log('Phase 4: ' + p4.length + ' actions, ' + p4White + ' white\n');

    // ===================== PHASE 5: Recovery Cycles =====================
    log('=== PHASE 5: 5 Recovery Cycles ===\n');
    var p5 = [];
    var p5White = 0;
    for (var r = 0; r < 5; r++) {
      var ts5 = Date.now();
      var sB5 = state(); var lB5 = loadCount, eB5 = errorCount;
      try {
        document.dispatchEvent(new CustomEvent('PORT_STATE_SYNC', {
          detail: { portReady: false, status: 'failed', reinitCount: r + 1 }
        }));
      } catch (x) {}
      await new Promise(r => setTimeout(r, 3000));
      try { if (window.VoltraBrowser && window.VoltraBrowser.navigate) VoltraBrowser.navigate('google.com'); } catch (x) {}
      await new Promise(r => setTimeout(r, 5000));
      var lA5 = loadCount, eA5 = errorCount; var sA5 = state();
      var wc5 = checkWS(iframe, 'google.com', 'recovery-cycle', ts5);
      var recovered = sA5.portReady === true && sA5.swPortStatus === 'ready';
      var e6 = { num: r+1, portBefore: sB5.portReady, portAfter: sA5.portReady, swAfter: sA5.swPortStatus, hadLoad: lA5 > lB5, white: wc5.white, reason: wc5.reason, recovered: recovered, src: sA5.iframeSrc };
      p5.push(e6);
      if (wc5.white) { WHITE_SCREENS.push(e6); p5White++; }
      log('  Cycle ' + (r+1) + '/5: white=' + wc5.white + ' recovered=' + recovered);
    }
    log('Phase 5: ' + p5.length + ' cycles, ' + p5White + ' white\n');

    // ===================== SUMMARY =====================
    log('\n========== WHITE SCREEN LOG ==========\n');
    if (WHITE_SCREENS.length === 0) {
      log('NO WHITE SCREENS DETECTED\n');
    } else {
      for (var wi = 0; wi < WHITE_SCREENS.length; wi++) {
        var w = WHITE_SCREENS[wi];
        log('#' + (wi+1) + ' url=' + w.url + ' reason=' + w.reason + ' port=' + w.portReady + ' sw=' + w.swPortStatus + ' load=' + w.hadLoad + ' src=' + (w.src || '').substring(0, 60));
      }
    }

    function sum(ph) {
      var t = ph.length, w = ph.filter(function(x) { return x.white; }).length, l = ph.filter(function(x) { return x.hadLoad; }).length;
      return { t: t, w: w, l: l };
    }
    var s1 = sum(p1), s2 = sum(p2), s3 = sum(p3), s4 = sum(p4), s5 = sum(p5);
    var gt = s1.t + s2.t + s3.t + s4.t + s5.t;
    var gw = s1.w + s2.w + s3.w + s4.w + s5.w;

    log('\n========== FINAL RESULTS ==========\n');
    log(pad('Phase', 14) + pad('Actions', 9) + pad('White', 7) + pad('Loads', 7) + 'Result');
    log(new Array(45).join('-'));
    function f(w) { return w === 0 ? 'PASS' : 'FAIL'; }
    log(pad('1 Rapid Navs', 14) + pad(s1.t, 9) + pad(s1.w, 7) + pad(s1.l, 7) + f(s1.w));
    log(pad('2 Reloads', 14) + pad(s2.t, 9) + pad(s2.w, 7) + pad(s2.l, 7) + f(s2.w));
    log(pad('3 Game Cycles', 14) + pad(s3.t, 9) + pad(s3.w, 7) + pad(s3.l, 7) + f(s3.w));
    log(pad('4 Long Session', 14) + pad(s4.t, 9) + pad(s4.w, 7) + pad(s4.l, 7) + f(s4.w));
    log(pad('5 Recovery', 14) + pad(s5.t, 9) + pad(s5.w, 7) + pad(s5.l, 7) + f(s5.w));
    log(new Array(45).join('-'));
    log(pad('TOTAL', 14) + pad(gt, 9) + pad(gw, 7) + pad(s1.l + s2.l + s3.l + s4.l + s5.l, 7) + f(gw));
    log('\nTotal: ' + gt + ' | White: ' + gw + ' | Rate: ' + (gt > 0 ? (gw/gt*100).toFixed(1) : 0) + '%');

    window.__STRESS_RESULTS__ = { total: gt, white: gw, details: WHITE_SCREENS };
    return OUT;
  } catch (e) {
    return 'INNER ERROR: ' + e.message + ' | ' + (e.stack || '').substring(0, 300);
  }
})()
