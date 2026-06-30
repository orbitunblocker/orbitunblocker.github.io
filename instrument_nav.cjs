const fs = require('fs');

// Instrument browser-engine.js
let be = fs.readFileSync('js/browser-engine.js', 'utf8');

// navigate() entry
be = be.replace(
  'navigate(url) {\n      // Intercept',
  'navigate(url) {\n      console.log("[NAV-TRACE] navigate() called at", Date.now(), "url:", url);\n      // Intercept'
);

// navigate() home early return
be = be.replace(
  'this._updateBookmarkBtn();\n        return;\n      }\n\n      if (url === \'orbit://settings\')',
  'console.log("[NAV-TRACE] navigate() EARLY RETURN: home at", Date.now());\n        this._updateBookmarkBtn();\n        return;\n      }\n\n      if (url === \'orbit://settings\')'
);

// navigate() settings early return
be = be.replace(
  'this._updateBookmarkBtn();\n        return;\n      }\n\n      const parsed',
  'console.log("[NAV-TRACE] navigate() EARLY RETURN: settings at", Date.now());\n        this._updateBookmarkBtn();\n        return;\n      }\n\n      const parsed'
);

// navigate() parsed + about:blank early return
be = be.replace(
  'const parsed = InputParser.parse(url);\n      const targetUrl = parsed.url;\n\n      if (targetUrl === \'about\')',
  'const parsed = InputParser.parse(url);\n      const targetUrl = parsed.url;\n      console.log("[NAV-TRACE] navigate() parsed type:", parsed.type, "targetUrl:", targetUrl, "at", Date.now());\n\n      if (targetUrl === \'about\')'
);

// _isPortReady
be = be.replace(
  '_isPortReady() {\n      return window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__.portReady === true;\n    }',
  '_isPortReady() {\n      const r = window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__.portReady === true;\n      console.log("[NAV-TRACE] _isPortReady() =>", r, "at", Date.now());\n      return r;\n    }'
);

// _loadUrlInFrame entry
be = be.replace(
  '_loadUrlInFrame(url) {\n      const iframe = document.getElementById(\'browserFrame\');\n      if (!iframe) return;\n\n      if (isBraveHome(url))',
  '_loadUrlInFrame(url) {\n      const iframe = document.getElementById(\'browserFrame\');\n      if (!iframe) { console.log("[NAV-TRACE] _loadUrlInFrame() EARLY RETURN: no iframe at", Date.now()); return; }\n      console.log("[NAV-TRACE] _loadUrlInFrame() enter at", Date.now(), "url:", url, "portReady:", this._isPortReady());\n\n      if (isBraveHome(url))'
);

// _loadUrlInFrame brave home early return
be = be.replace(
  'this.updateNavButtons();\n        return;\n      }\n\n      if (url === \'orbit://settings\')',
  'console.log("[NAV-TRACE] _loadUrlInFrame() EARLY RETURN: brave home at", Date.now());\n        this.updateNavButtons();\n        return;\n      }\n\n      if (url === \'orbit://settings\')'
);

// _loadUrlInFrame settings early return
be = be.replace(
  'this.updateNavButtons();\n        return;\n      }\n\n      const normalized',
  'console.log("[NAV-TRACE] _loadUrlInFrame() EARLY RETURN: settings at", Date.now());\n        this.updateNavButtons();\n        return;\n      }\n\n      const normalized'
);

// Defer check
be = be.replace(
  'if (useUv && !this._isPortReady()) {\n        console.log(\'[DEFER-NAV]',
  'if (useUv && !this._isPortReady()) {\n        console.log("[NAV-TRACE] DEFER: url=" + url + " port NOT ready, queueing at", Date.now(), "queue len:", this._pendingNavigations.length);\n        console.log(\'[DEFER-NAV]'
);

// Queue push
be = be.replace(
  'this._pendingNavigations.find(n => n.url === url)) {\n          this._pendingNavigations.push',
  'this._pendingNavigations.find(n => n.url === url)) {\n          console.log("[NAV-TRACE] QUEUING url=" + url + " at", Date.now());\n          this._pendingNavigations.push'
);

// After queued
be = be.replace(
  'push({ url, normalized, ts: Date.now() });\n        }\n        return;\n      }\n\n      this.showLoading();',
  'push({ url, normalized, ts: Date.now() });\n          console.log("[NAV-TRACE] QUEUED: url=" + url + " queue len:", this._pendingNavigations.length, "at", Date.now());\n        } else {\n          console.log("[NAV-TRACE] DUPLICATE SKIP: url=" + url + " at", Date.now());\n        }\n        console.log("[NAV-TRACE] DEFER RETURN at", Date.now());\n        return;\n      }\n\n      console.log("[NAV-TRACE] PORT READY: proceeding for url=" + url + " at", Date.now());\n      this.showLoading();'
);

// iframe.src assignment
be = be.replace(
  'iframe.src = finalSrc;\n      this.updateNavButtons();\n    }\n\n    _flushPendingNavigations()',
  'console.log("[NAV-TRACE] ASSIGNING iframe.src =", finalSrc, "at", Date.now());\n      iframe.src = finalSrc;\n      this.updateNavButtons();\n      console.log("[NAV-TRACE] _loadUrlInFrame() complete at", Date.now());\n    }\n\n    _flushPendingNavigations()'
);

// _flushPendingNavigations entry
be = be.replace(
  '_flushPendingNavigations() {\n      const pending = this._pendingNavigations || [];\n      this._pendingNavigations = [];\n      if (pending.length === 0) return;\n      console.log(\'[FLUSH-NAV]',
  '_flushPendingNavigations() {\n      const pending = this._pendingNavigations || [];\n      this._pendingNavigations = [];\n      console.log("[NAV-TRACE] _flushPendingNavigations() enter at", Date.now(), "drained:", pending.length);\n      if (pending.length === 0) { console.log("[NAV-TRACE] _flushPendingNavigations() EARLY RETURN: queue empty at", Date.now()); return; }\n      console.log("[NAV-TRACE] _flushPendingNavigations() flushing " + pending.length + " at", Date.now());\n      console.log(\'[FLUSH-NAV]'
);

// _flushPendingNavigations forEach
be = be.replace(
  'pending.forEach(({ url }) => {\n        this._loadUrlInFrame(url);\n      });\n    }',
  'pending.forEach(({ url, ts }) => {\n        console.log("[NAV-TRACE] Flush processing: url=" + url + " queued_at=" + ts + " elapsed=" + (Date.now()-ts) + "ms at", Date.now());\n        this._loadUrlInFrame(url);\n      });\n      console.log("[NAV-TRACE] _flushPendingNavigations() done at", Date.now());\n    }'
);

fs.writeFileSync('js/browser-engine.js', be);
console.log('browser-engine.js instrumented OK');

// Instrument app.js - syncPortStateFromSW
let app = fs.readFileSync('js/app.js', 'utf8');

// syncPortStateFromSW entry
app = app.replace(
  'async function syncPortStateFromSW() {\n      if (!(\'serviceWorker\' in navigator)) return;',
  'async function syncPortStateFromSW() {\n      var _st = Date.now();\n      console.log("[NAV-TRACE] syncPortStateFromSW() called at", _st);\n      if (!(\'serviceWorker\' in navigator)) { console.log("[NAV-TRACE] syncPortStateFromSW(): no SW at", Date.now()); return; }'
);

// syncPortStateFromSW got registration
app = app.replace(
  'const registration = await navigator.serviceWorker.ready;\n        if (!registration.active) {',
  'console.log("[NAV-TRACE] syncPortStateFromSW() got reg active:", !!registration.active, "at", Date.now(), "elapsed:", Date.now()-_st);\n        if (!registration.active) {'
);

// syncPortStateFromSW sending
app = app.replace(
  'registration.active.postMessage({ type: \'SYNC_PORT_STATE\', checkHealth: true }, [channel.port2]);',
  'console.log("[NAV-TRACE] syncPortStateFromSW() sending SYNC_PORT_STATE at", Date.now(), "elapsed:", Date.now()-_st);\n            registration.active.postMessage({ type: \'SYNC_PORT_STATE\', checkHealth: true }, [channel.port2]);'
);

// syncPortStateFromSW got response
app = app.replace(
  'if (response) {\n          window.__UV_BOOT_STATUS__._update(\'swSynced\', true);',
  'if (response) {\n          console.log("[NAV-TRACE] syncPortStateFromSW() got response at", Date.now(), "portReady:", response.portReady, "status:", response.status, "elapsed:", Date.now()-_st);\n          window.__UV_BOOT_STATUS__._update(\'swSynced\', true);'
);

// syncPortStateFromSW flushing
app = app.replace(
  'if (typeof ui._flushPendingNavigations === \'function\') {\n                ui._flushPendingNavigations();\n              }',
  'if (typeof ui._flushPendingNavigations === \'function\') {\n                console.log("[NAV-TRACE] syncPortStateFromSW() calling _flushPendingNavigations at", Date.now());\n                ui._flushPendingNavigations();\n              }'
);

// PORT_SYNC handler entry
app = app.replace(
  'console.log(\'[PORT_SYNC] source: SW broadcast\');\n          window.__UV_BOOT_STATUS__._update(\'swPortStateSync\', true);',
  'console.log(\'[PORT_SYNC] source: SW broadcast\');\n          console.log("[NAV-TRACE] PORT_SYNC: portReady=" + event.data.portReady + " status=" + event.data.status + " at", Date.now());\n          window.__UV_BOOT_STATUS__._update(\'swPortStateSync\', true);'
);

// PORT_SYNC flushing
app = app.replace(
  'if (typeof ui._flushPendingNavigations === \'function\') {\n                ui._flushPendingNavigations();\n              }\n            }',
  'if (typeof ui._flushPendingNavigations === \'function\') {\n                console.log("[NAV-TRACE] PORT_SYNC calling _flushPendingNavigations at", Date.now());\n                ui._flushPendingNavigations();\n              }\n            } else {\n              console.log("[NAV-TRACE] PORT_SYNC portReady=" + event.data.portReady + " NOT flushing at", Date.now());\n            }'
);

// Periodic check
app = app.replace(
  'setInterval(function() {\n        var portReady = window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__.portReady === true;\n        if (portReady && window.syncPortStateFromSW) {',
  'setInterval(function() {\n        var portReady = window.__UV_BOOT_STATUS__ && window.__UV_BOOT_STATUS__.portReady === true;\n        console.log("[NAV-TRACE] periodic health check at", Date.now(), "portReady:", portReady);\n        if (portReady && window.syncPortStateFromSW) {'
);

fs.writeFileSync('js/app.js', app);
console.log('app.js instrumented OK');
