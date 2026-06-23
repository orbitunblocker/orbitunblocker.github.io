(async function() {
  // debug: catch and report any error
  try {
    var OUT = '';

    // ==== SIMPLE CHECKS FIRST ====
    OUT += 'CHECK 1: page loaded\n';
    OUT += 'CHECK 2: boot=' + (typeof window.__UV_BOOT_STATUS__) + '\n';

    if (window.__UV_BOOT_STATUS__) {
      OUT += 'CHECK 3: portReady=' + window.__UV_BOOT_STATUS__.portReady + '\n';
      OUT += 'CHECK 4: swPortStatus=' + window.__UV_BOOT_STATUS__.swPortStatus + '\n';
      OUT += 'CHECK 5: bareMuxReady=' + window.__UV_BOOT_STATUS__.bareMuxReady + '\n';
      OUT += 'CHECK 6: swReady=' + window.__UV_BOOT_STATUS__.swReady + '\n';
      OUT += 'CHECK 7: failedStage=' + (window.__UV_BOOT_STATUS__.failedStage || 'none') + '\n';
    }

    OUT += 'CHECK 8: VoltraBrowser=' + (typeof window.VoltraBrowser) + '\n';

    // Load browser section
    if (typeof loadSection === 'function') {
      OUT += 'CHECK 9: loadSection exists, calling\n';
      loadSection('browser');
      await new Promise(r => setTimeout(r, 5000));
      OUT += 'CHECK 10: after loadSection\n';
    }

    var ui = window.VoltraBrowser && window.VoltraBrowser._browserUI;
    OUT += 'CHECK 11: browserUI=' + (ui ? 'exists' : 'null') + '\n';

    var iframe = document.getElementById('browserFrame-main');
    OUT += 'CHECK 12: iframe=' + (iframe ? 'exists' : 'null') + '\n';

    if (iframe) {
      OUT += 'CHECK 13: iframe.src=' + (iframe.src || '(empty)') + '\n';
      OUT += 'CHECK 14: iframe.srcdoc length=' + (iframe.srcdoc ? iframe.srcdoc.length : 0) + '\n';
    }

    // ==== RUN SCENARIO TESTS ====
    function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

    function getState() {
      var b = window.__UV_BOOT_STATUS__ || {};
      var ui2 = window.VoltraBrowser && window.VoltraBrowser._browserUI;
      var ifr = document.getElementById('browserFrame-main');
      return {
        portReady: b.portReady,
        swPortStatus: b.swPortStatus,
        bareMuxReady: b.bareMuxReady,
        iframeSrc: ifr ? (ifr.src || '(srcdoc)') : 'no-frame',
        srcdocLen: ifr && ifr.srcdoc ? ifr.srcdoc.length : 0,
        routeDebug: window.__UV_ROUTE_DEBUG__ ? JSON.parse(JSON.stringify(window.__UV_ROUTE_DEBUG__)) : null
      };
    }

    function checkIFrame() {
      var ifr = document.getElementById('browserFrame-main');
      if (!ifr) return { blank: true, error503: false, errorOrbit: false, text: 'no-iframe' };
      try {
        var doc = ifr.contentDocument;
        if (!doc || !doc.body) return { blank: true, error503: false, errorOrbit: false, text: 'no-doc' };
        var html = doc.body.innerHTML || '';
        var text = doc.body.innerText || '';
        var isBlank = html.trim() === '' || html === '<br>';
        var has503 = text.includes('503') || text.includes('Service Unavailable');
        var hasOrbitError = text.includes('This page could not be loaded') || text.includes('proxy request timed out');
        return { blank: isBlank, error503: has503, errorOrbit: hasOrbitError, textLength: html.length, preview: text.substring(0, 80) };
      } catch(e) {
        return { blank: 'cors', error503: false, errorOrbit: false, text: 'cross-origin: ' + e.message };
      }
    }

    var results = [];

    function record(label, data) {
      data.label = label;
      data.ts = new Date().toISOString();
      results.push(data);
      OUT += '\n===== ' + label + ' =====\n';
      for (var k in data) {
        if (k !== 'label') OUT += '  ' + k + ': ' + JSON.stringify(data[k]) + '\n';
      }
    }

    // Hook iframe events
    var iframeEvents = [];
    var ifr = document.getElementById('browserFrame-main');
    if (ifr) {
      ifr.addEventListener('load', function() { iframeEvents.push({ type: 'load', ts: Date.now() }); });
      ifr.addEventListener('error', function() { iframeEvents.push({ type: 'error', ts: Date.now() }); });
    }

    // ==== TEST 1: google.com ====
    OUT += '\n--- Starting TEST 1: google.com ---\n';
    var s1 = getState();
    OUT += 'State before: portReady=' + s1.portReady + ' iframeSrc=' + s1.iframeSrc + '\n';

    var nav1 = Date.now();
    iframeEvents = [];
    if (window.VoltraBrowser && window.VoltraBrowser.navigate) {
      window.VoltraBrowser.navigate('google.com');
      OUT += 'Navigated at ' + new Date(nav1).toISOString() + '\n';
    }

    // Wait 12 seconds for page to load
    await new Promise(r => setTimeout(r, 12000));

    var s1a = getState();
    var ev1 = iframeEvents.filter(function(e) { return e.ts >= nav1; });
    var fc1 = checkIFrame();
    OUT += 'After: portReady=' + s1a.portReady + ' iframeSrc=' + s1a.iframeSrc + '\n';
    OUT += '  iframe content: blank=' + fc1.blank + ' 503=' + fc1.error503 + ' orbitError=' + fc1.errorOrbit + ' preview=' + fc1.preview + '\n';
    OUT += '  iframe events: ' + ev1.length + ' (load=' + ev1.filter(function(e){return e.type==='load'}).length + ' error=' + ev1.filter(function(e){return e.type==='error'}).length + ')\n';

    record('TEST 1: google.com', {
      ts: new Date(nav1).toISOString(),
      portReady: s1a.portReady,
      swPortStatus: s1a.swPortStatus,
      iframeSrcBefore: s1.iframeSrc,
      encodedUVUrl: s1a.routeDebug ? (s1a.routeDebug.lastEncoded || 'N/A') : 'N/A',
      finalIframeSrc: s1a.iframeSrc,
      iframeLoadEvent: ev1.length > 0 ? ev1[0].type + ' at ' + new Date(ev1[0].ts).toISOString() : 'none',
      iframeErrorEvent: ev1.filter(function(e){return e.type==='error'}).length > 0 ? 'yes' : 'no',
      swResponseStatus: 'N/A (no SW capture)',
      had503: fc1.error503,
      hadBlankIframe: fc1.blank === true,
      recoverySucceeded: s1a.portReady === true,
      contentPreview: fc1.preview
    });

    // ==== TEST 2: wikipedia.org ====
    OUT += '\n--- Starting TEST 2: wikipedia.org ---\n';
    var s2 = getState();
    iframeEvents = [];
    var nav2 = Date.now();
    if (window.VoltraBrowser && window.VoltraBrowser.navigate) window.VoltraBrowser.navigate('wikipedia.org');
    await new Promise(r => setTimeout(r, 12000));

    var s2a = getState();
    var ev2 = iframeEvents.filter(function(e) { return e.ts >= nav2; });
    var fc2 = checkIFrame();

    record('TEST 2: wikipedia.org', {
      ts: new Date(nav2).toISOString(),
      portReady: s2a.portReady,
      swPortStatus: s2a.swPortStatus,
      iframeSrcBefore: s2.iframeSrc,
      encodedUVUrl: s2a.routeDebug ? (s2a.routeDebug.lastEncoded || 'N/A') : 'N/A',
      finalIframeSrc: s2a.iframeSrc,
      iframeLoadEvent: ev2.length > 0 ? ev2[0].type + ' at ' + new Date(ev2[0].ts).toISOString() : 'none',
      iframeErrorEvent: ev2.filter(function(e){return e.type==='error'}).length > 0 ? 'yes' : 'no',
      swResponseStatus: 'N/A',
      had503: fc2.error503,
      hadBlankIframe: fc2.blank === true || fc2.blank === 'cors',
      recoverySucceeded: s2a.portReady === true,
      contentPreview: fc2.preview
    });

    // ==== TEST 3: github.com ====
    OUT += '\n--- Starting TEST 3: github.com ---\n';
    var s3 = getState();
    iframeEvents = [];
    var nav3 = Date.now();
    if (window.VoltraBrowser && window.VoltraBrowser.navigate) window.VoltraBrowser.navigate('github.com');
    await new Promise(r => setTimeout(r, 12000));

    var s3a = getState();
    var ev3 = iframeEvents.filter(function(e) { return e.ts >= nav3; });
    var fc3 = checkIFrame();

    record('TEST 3: github.com', {
      ts: new Date(nav3).toISOString(),
      portReady: s3a.portReady,
      swPortStatus: s3a.swPortStatus,
      iframeSrcBefore: s3.iframeSrc,
      encodedUVUrl: s3a.routeDebug ? (s3a.routeDebug.lastEncoded || 'N/A') : 'N/A',
      finalIframeSrc: s3a.iframeSrc,
      iframeLoadEvent: ev3.length > 0 ? ev3[0].type + ' at ' + new Date(ev3[0].ts).toISOString() : 'none',
      iframeErrorEvent: ev3.filter(function(e){return e.type==='error'}).length > 0 ? 'yes' : 'no',
      swResponseStatus: 'N/A',
      had503: fc3.error503,
      hadBlankIframe: fc3.blank === true || fc3.blank === 'cors',
      recoverySucceeded: s3a.portReady === true,
      contentPreview: fc3.preview
    });

    // ==== TEST 4: Quicklink (duckduckgo.com) ====
    OUT += '\n--- Starting TEST 4: quicklink ---\n';
    var s4 = getState();
    iframeEvents = [];
    var nav4 = Date.now();
    if (window.VoltraBrowser && window.VoltraBrowser.navigate) window.VoltraBrowser.navigate('duckduckgo.com');
    await new Promise(r => setTimeout(r, 12000));

    var s4a = getState();
    var ev4 = iframeEvents.filter(function(e) { return e.ts >= nav4; });
    var fc4 = checkIFrame();

    record('TEST 4: Quicklink (duckduckgo.com)', {
      ts: new Date(nav4).toISOString(),
      portReady: s4a.portReady,
      swPortStatus: s4a.swPortStatus,
      iframeSrcBefore: s4.iframeSrc,
      encodedUVUrl: s4a.routeDebug ? (s4a.routeDebug.lastEncoded || 'N/A') : 'N/A',
      finalIframeSrc: s4a.iframeSrc,
      iframeLoadEvent: ev4.length > 0 ? ev4[0].type + ' at ' + new Date(ev4[0].ts).toISOString() : 'none',
      iframeErrorEvent: ev4.filter(function(e){return e.type==='error'}).length > 0 ? 'yes' : 'no',
      swResponseStatus: 'N/A',
      had503: fc4.error503,
      hadBlankIframe: fc4.blank === true || fc4.blank === 'cors',
      recoverySucceeded: s4a.portReady === true,
      contentPreview: fc4.preview
    });

    // ==== TEST 5: Bookmark (stackoverflow.com) ====
    OUT += '\n--- Starting TEST 5: bookmark ---\n';
    var s5 = getState();
    iframeEvents = [];
    var nav5 = Date.now();
    if (window.VoltraBrowser && window.VoltraBrowser.navigate) window.VoltraBrowser.navigate('stackoverflow.com');
    await new Promise(r => setTimeout(r, 12000));

    var s5a = getState();
    var ev5 = iframeEvents.filter(function(e) { return e.ts >= nav5; });
    var fc5 = checkIFrame();

    record('TEST 5: Bookmark (stackoverflow.com)', {
      ts: new Date(nav5).toISOString(),
      portReady: s5a.portReady,
      swPortStatus: s5a.swPortStatus,
      iframeSrcBefore: s5.iframeSrc,
      encodedUVUrl: s5a.routeDebug ? (s5a.routeDebug.lastEncoded || 'N/A') : 'N/A',
      finalIframeSrc: s5a.iframeSrc,
      iframeLoadEvent: ev5.length > 0 ? ev5[0].type + ' at ' + new Date(ev5[0].ts).toISOString() : 'none',
      iframeErrorEvent: ev5.filter(function(e){return e.type==='error'}).length > 0 ? 'yes' : 'no',
      swResponseStatus: 'N/A',
      had503: fc5.error503,
      hadBlankIframe: fc5.blank === true || fc5.blank === 'cors',
      recoverySucceeded: s5a.portReady === true,
      contentPreview: fc5.preview
    });

    // ==== TEST 6: Game launch ====
    OUT += '\n--- Starting TEST 6: game ---\n';
    var s6 = getState();
    var gameNav = Date.now();
    var gameUrl = null;
    if (typeof gameIndex !== 'undefined') {
      var gkeys = Object.keys(gameIndex);
      for (var gi = 0; gi < gkeys.length; gi++) {
        if (gameIndex[gkeys[gi]].url) { gameUrl = gameIndex[gkeys[gi]].url; break; }
      }
    }
    OUT += 'Game URL: ' + gameUrl + '\n';

    var gResult = { portReady: s6.portReady, swPortStatus: s6.swPortStatus };
    if (gameUrl && typeof openGame === 'function') {
      openGame(gkeys[0]);
      await new Promise(r => setTimeout(r, 10000));

      var s6a = getState();
      var gf = document.getElementById('gameFrame');
      var gSrc = gf ? gf.src : 'no-frame';
      try {
        var gDoc = gf && gf.contentDocument;
        var gText = gDoc && gDoc.body ? gDoc.body.innerText || '' : '';
        gResult = {
          ts: new Date(gameNav).toISOString(),
          portReady: s6a.portReady,
          swPortStatus: s6a.swPortStatus,
          iframeSrcBefore: s6.iframeSrc,
          encodedUVUrl: gSrc,
          finalIframeSrc: gSrc,
          iframeLoadEvent: 'game-frame',
          iframeErrorEvent: 'game-frame',
          swResponseStatus: 'game-frame',
          had503: gText.includes('503'),
          hadBlankIframe: gText.trim() === '',
          recoverySucceeded: s6a.portReady === true,
          contentPreview: gText.substring(0, 80)
        };
      } catch(e) {
        gResult = { ts: new Date(gameNav).toISOString(), portReady: s6a.portReady, swPortStatus: s6a.swPortStatus, iframeSrcBefore: s6.iframeSrc, encodedUVUrl: 'error: ' + e.message, finalIframeSrc: 'error', iframeLoadEvent: 'error', iframeErrorEvent: 'error', swResponseStatus: 'error', had503: false, hadBlankIframe: 'error', recoverySucceeded: false, contentPreview: e.message };
      }
    }
    record('TEST 6: Game launch', gResult);

    // ==== TEST 7: Reload during proxy ====
    OUT += '\n--- Starting TEST 7: reload ---\n';
    var s7b = getState();
    iframeEvents = [];
    // Navigate first
    var nav7 = Date.now();
    if (window.VoltraBrowser && window.VoltraBrowser.navigate) window.VoltraBrowser.navigate('example.com');
    await new Promise(r => setTimeout(r, 8000));

    var s7m = getState();
    iframeEvents = [];
    // Now refresh
    var ref7 = Date.now();
    if (window.VoltraBrowser && window.VoltraBrowser.refresh) window.VoltraBrowser.refresh();
    await new Promise(r => setTimeout(r, 10000));

    var s7a = getState();
    var ev7 = iframeEvents.filter(function(e) { return e.ts >= ref7; });
    var fc7 = checkIFrame();

    record('TEST 7: Reload during proxy', {
      ts: new Date(ref7).toISOString(),
      portReady: s7a.portReady,
      swPortStatus: s7a.swPortStatus,
      iframeSrcBefore: s7b.iframeSrc + ' → ' + s7m.iframeSrc,
      encodedUVUrl: s7a.routeDebug ? (s7a.routeDebug.lastEncoded || 'N/A') : 'N/A',
      finalIframeSrc: s7a.iframeSrc,
      iframeLoadEvent: ev7.length > 0 ? ev7[0].type + ' at ' + new Date(ev7[0].ts).toISOString() : 'none',
      iframeErrorEvent: ev7.filter(function(e){return e.type==='error'}).length > 0 ? 'yes' : 'no',
      swResponseStatus: 'N/A',
      had503: fc7.error503,
      hadBlankIframe: fc7.blank === true || fc7.blank === 'cors',
      recoverySucceeded: s7a.portReady === true,
      contentPreview: fc7.preview
    });

    // ==== TEST 8: Reload during port recovery ====
    OUT += '\n--- Starting TEST 8: recovery reload ---\n';
    var s8 = getState();
    iframeEvents = [];

    // Dispatch port failure
    document.dispatchEvent(new CustomEvent('PORT_STATE_SYNC', { detail: { portReady: false, status: 'failed', reinitCount: 1 } }));
    await new Promise(r => setTimeout(r, 2000));

    var ref8 = Date.now();
    if (window.VoltraBrowser && window.VoltraBrowser.navigate) window.VoltraBrowser.navigate('example.com');
    await new Promise(r => setTimeout(r, 10000));

    var s8a = getState();
    var ev8 = iframeEvents.filter(function(e) { return e.ts >= ref8; });
    var fc8 = checkIFrame();

    record('TEST 8: Reload during port recovery', {
      ts: new Date(ref8).toISOString(),
      portReady: s8a.portReady,
      swPortStatus: s8a.swPortStatus,
      iframeSrcBefore: s8.iframeSrc,
      encodedUVUrl: s8a.routeDebug ? (s8a.routeDebug.lastEncoded || 'N/A') : 'N/A',
      finalIframeSrc: s8a.iframeSrc,
      iframeLoadEvent: ev8.length > 0 ? ev8[0].type + ' at ' + new Date(ev8[0].ts).toISOString() : 'none',
      iframeErrorEvent: ev8.filter(function(e){return e.type==='error'}).length > 0 ? 'yes' : 'no',
      swResponseStatus: 'N/A',
      had503: fc8.error503,
      hadBlankIframe: fc8.blank === true || fc8.blank === 'cors',
      recoverySucceeded: s8a.portReady === true,
      contentPreview: fc8.preview
    });

    // ==== TEST 9: SharedWorker restart ====
    OUT += '\n--- Starting TEST 9: SharedWorker restart ---\n';
    var s9 = getState();
    iframeEvents = [];

    // Close the SharedWorker port
    if (window.__uv_shared_worker) {
      try { window.__uv_shared_worker.port.close(); } catch(e) {}
    }

    document.dispatchEvent(new CustomEvent('PORT_STATE_SYNC', { detail: { portReady: false, status: 'failed', reinitCount: 2 } }));
    await new Promise(r => setTimeout(r, 4000));

    var nav9 = Date.now();
    if (window.VoltraBrowser && window.VoltraBrowser.navigate) window.VoltraBrowser.navigate('example.com');
    await new Promise(r => setTimeout(r, 10000));

    var s9a = getState();
    var ev9 = iframeEvents.filter(function(e) { return e.ts >= nav9; });
    var fc9 = checkIFrame();

    // Check if port recovered
    var recovered9 = s9a.portReady === true && s9a.swPortStatus === 'ready';

    record('TEST 9: SharedWorker restart', {
      ts: new Date(nav9).toISOString(),
      portReady: s9a.portReady,
      swPortStatus: s9a.swPortStatus,
      iframeSrcBefore: s9.iframeSrc,
      encodedUVUrl: s9a.routeDebug ? (s9a.routeDebug.lastEncoded || 'N/A') : 'N/A',
      finalIframeSrc: s9a.iframeSrc,
      iframeLoadEvent: ev9.length > 0 ? ev9[0].type + ' at ' + new Date(ev9[0].ts).toISOString() : 'none',
      iframeErrorEvent: ev9.filter(function(e){return e.type==='error'}).length > 0 ? 'yes' : 'no',
      swResponseStatus: 'N/A',
      had503: fc9.error503,
      hadBlankIframe: fc9.blank === true || fc9.blank === 'cors',
      recoverySucceeded: recovered9,
      contentPreview: fc9.preview
    });

    // ==== TEST 10: SW restart ====
    OUT += '\n--- Starting TEST 10: SW restart ---\n';
    var s10 = getState();
    iframeEvents = [];

    var swReg = await navigator.serviceWorker.getRegistration();
    var swRecreated = false;

    if (swReg) {
      await swReg.unregister();
      OUT += 'SW unregistered\n';
      await new Promise(r => setTimeout(r, 2000));

      var nav10 = Date.now();
      if (window.VoltraBrowser && window.VoltraBrowser.navigate) window.VoltraBrowser.navigate('example.com');
      await new Promise(r => setTimeout(r, 12000));

      var s10a = getState();
      var ev10 = iframeEvents.filter(function(e) { return e.ts >= nav10; });
      var fc10 = checkIFrame();

      var newReg = await navigator.serviceWorker.getRegistration();
      swRecreated = !!newReg;
      OUT += 'SW recreated: ' + swRecreated + '\n';

      record('TEST 10: SW restart', {
        ts: new Date(nav10).toISOString(),
        portReady: s10a.portReady,
        swPortStatus: s10a.swPortStatus,
        iframeSrcBefore: s10.iframeSrc,
        encodedUVUrl: s10a.routeDebug ? (s10a.routeDebug.lastEncoded || 'N/A') : 'N/A',
        finalIframeSrc: s10a.iframeSrc,
        iframeLoadEvent: ev10.length > 0 ? ev10[0].type + ' at ' + new Date(ev10[0].ts).toISOString() : 'none',
        iframeErrorEvent: ev10.filter(function(e){return e.type==='error'}).length > 0 ? 'yes' : 'no',
        swResponseStatus: 'recreated=' + swRecreated,
        had503: fc10.error503,
        hadBlankIframe: fc10.blank === true || fc10.blank === 'cors',
        recoverySucceeded: s10a.portReady === true && swRecreated === true,
        contentPreview: fc10.preview
      });
    } else {
      record('TEST 10: SW restart', {
        ts: new Date().toISOString(),
        portReady: s10.portReady,
        swPortStatus: s10.swPortStatus,
        iframeSrcBefore: s10.iframeSrc,
        encodedUVUrl: 'N/A',
        finalIframeSrc: 'N/A',
        iframeLoadEvent: 'N/A',
        iframeErrorEvent: 'N/A',
        swResponseStatus: 'no-registration',
        had503: false,
        hadBlankIframe: 'N/A',
        recoverySucceeded: false,
        contentPreview: 'no-sw-registration'
      });
    }

    // ==== FINAL SUMMARY ====
    OUT += '\n\n============================================================';
    OUT += '\nRAILWAY DEPLOYMENT DIAGNOSTIC — PASS/FAIL SUMMARY';
    OUT += '\n============================================================\n';

    var hdr = pad('#', 3) + pad('Test', 40) + pad('port', 6) + pad('503', 5) + pad('Blank', 7) + pad('Load', 6) + pad('Recov', 6) + 'RESULT';
    OUT += hdr + '\n';
    OUT += new Array(80).join('-') + '\n';

    var passCount = 0, failCount = 0;
    for (var ri = 0; ri < results.length; ri++) {
      var r = results[ri];
      var portOk = r.portReady === true || r.portReady === true;
      var got503 = r.had503 === true;
      var blank = r.hadBlankIframe === true;
      var recovered = r.recoverySucceeded === true;
      var passed = portOk && !got503 && !blank && recovered;
      if (r.label.indexOf('SW restart') >= 0) {
        // For SW restart, allow blank during recreation
        passed = recovered;
      }
      if (passed) passCount++; else failCount++;
      OUT += pad(ri+1, 3) + pad(r.label.substring(0, 38), 40) +
             pad(r.portReady, 6) + pad(got503 ? 'Y' : 'n', 5) +
             pad(blank ? 'Y' : 'n', 7) +
             pad(r.iframeLoadEvent.substring(0, 5), 6) +
             pad(recovered ? 'OK' : 'FAIL', 6) +
             (passed ? 'PASS' : 'FAIL') + '\n';
    }

    OUT += '\nTotal: ' + (passCount + failCount) + ' | PASS: ' + passCount + ' | FAIL: ' + failCount + '\n';

    return OUT;
  } catch (e) {
    return 'INNER ERROR: ' + e.message + '\n' + e.stack;
  }
})()
