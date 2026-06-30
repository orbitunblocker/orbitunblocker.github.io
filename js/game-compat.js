(function() {
  'use strict';

  var ASSET_PATTERNS = [
    /\.zip['"`\s\)\]>]/i,
    /\.pak['"`\s\)\]>]/i,
    /\.wasm['"`\s\)\]>]/i,
    /\.data['"`\s\)\]>]/i,
    /\.mem['"`\s\)\]>]/i,
    /\.unityweb['"`\s\)\]>]/i,
    /\.bundle['"`\s\)\]>]/i,
    /\/Build\//,
  ];

  var ENGINE_PATTERNS = [
    { p: /UnityLoader/,                  n: 'Unity loader' },
    { p: /createUnityInstance/,           n: 'Unity loader' },
    { p: /Emscripten/i,                   n: 'Emscripten' },
    { p: /ENVIRONMENT_IS_WEB/,            n: 'Emscripten' },
    { p: /locateFile\s*[:=]/,             n: 'Emscripten' },
    { p: /instantiateWasm\s*[:=]/,        n: 'Emscripten' },
    { p: /wasmBinaryFile/,                n: 'Emscripten' },
    { p: /scriptDirectory\s*[:=]/,        n: 'Emscripten' },
    { p: /WebAssembly\.instantiate/,       n: 'WebAssembly' },
    { p: /WebAssembly\.Module/,           n: 'WebAssembly' },
    { p: /wasmUnityWebData/,              n: 'Unity WASM' },
    { p: /dataFileUrl\s*[:=]/,            n: 'Emscripten data' },
    { p: /\.data\.unityweb/,              n: 'Unity manifest' },
    { p: /\.wasm\.unityweb/,              n: 'Unity manifest' },
    { p: /\.framework\.unityweb/,         n: 'Unity manifest' },
  ];

  // Common game entry sub-pages to probe if the root page shows engine indicators
  var ENGINE_SUB_PAGES = [
    'xash.html', 'game.html', 'unity.html',
    'loader.html', 'index.html'
  ];

  function scanHtml(html) {
    for (var i = 0; i < ASSET_PATTERNS.length; i++) {
      if (ASSET_PATTERNS[i].test(html)) {
        var s = ASSET_PATTERNS[i].source;
        s = s.replace(/\\\./g, '.').replace(/[\[\]'"`\s\\)\]>]/g, '');
        return { d: true, r: 'detected ' + s + ' asset' };
      }
    }
    for (var j = 0; j < ENGINE_PATTERNS.length; j++) {
      if (ENGINE_PATTERNS[j].p.test(html)) {
        return { d: true, r: 'detected ' + ENGINE_PATTERNS[j].n };
      }
    }
    return { d: false, r: '' };
  }

  function probeUrl(url) {
    return fetch('/game-probe?url=' + encodeURIComponent(url)).then(function(r) {
      var status = parseInt(r.headers.get('X-Detect-Status') || '0');
      var ct = r.headers.get('X-Detect-Content-Type') || '';
      if (status !== 200 || !ct.includes('text/html')) return null;
      return r.text();
    }).catch(function() { return null; });
  }

  window.detectGameMode = async function(gameId, gameUrl) {
    if (gameUrl.startsWith('data:') || gameUrl.startsWith('blob:') || gameUrl === 'about:blank') {
      return { mode: 'direct', reason: 'inline content' };
    }

    try {
      // 1. Probe the root game URL
      var html = await probeUrl(gameUrl);
      if (html === null) return { mode: 'proxy', reason: 'standard iframe' };

      // 2. Scan root page
      var result = scanHtml(html);
      if (result.d) return { mode: 'direct', reason: result.r };

      // 3. Check for engine indicator keywords even without pattern match
      var hasEngineKeyword = /Emscripten|Unity|WebAssembly|Xash3D/i.test(html);
      var hasFormAction = /action\s*=\s*['"]?[\w]+\.html/i.test(html);
      var hasNavLink = /href\s*=\s*['"]?[\w]+\.html/i.test(html);

      // 4. If root page looks like a launcher (engine keyword + form/link to sub-page),
      //    probe common sub-pages for asset references
      if (hasEngineKeyword || hasFormAction || hasNavLink) {
        var baseDir = gameUrl;
        if (baseDir.charAt(baseDir.length - 1) !== '/') {
          baseDir = baseDir.substring(0, baseDir.lastIndexOf('/') + 1);
        }

        for (var k = 0; k < ENGINE_SUB_PAGES.length; k++) {
          var subHtml = await probeUrl(baseDir + ENGINE_SUB_PAGES[k]);
          if (subHtml !== null) {
            var subResult = scanHtml(subHtml);
            if (subResult.d) return { mode: 'direct', reason: subResult.r };
          }
        }
      }

      return { mode: 'proxy', reason: 'standard iframe' };
    } catch (e) {
      console.warn('[GAME-COMPAT] detection error:', gameId, e.message);
      return { mode: 'proxy', reason: 'standard iframe' };
    }
  };
})();
