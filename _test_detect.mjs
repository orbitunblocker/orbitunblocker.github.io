import http from 'http';

async function probeUrl(url) {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:8080/game-probe?url=' + encodeURIComponent(url), (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        const status = parseInt(res.headers['x-detect-status'] || '0');
        const ct = res.headers['x-detect-content-type'] || '';
        if (status !== 200 || !ct.includes('text/html')) resolve(null);
        else resolve(d);
      });
    }).on('error', reject);
  });
}

const ASSET_PATTERNS = [
  /\.zip['"`\s\)\]>]/i, /\.wasm['"`\s\)\]>]/i, /\.data['"`\s\)\]>]/i,
  /\/Build\//,
];
const ENGINE_PATTERNS = [
  { p: /UnityLoader/i, n: 'Unity' }, { p: /Emscripten/i, n: 'Emscripten' },
  { p: /ENVIRONMENT_IS_WEB/, n: 'Emscripten' }, { p: /WebAssembly\.instantiate/, n: 'WASM' },
];

function scanHtml(html) {
  for (const p of ASSET_PATTERNS) if (p.test(html)) return 'ASSET: ' + p.source;
  for (const e of ENGINE_PATTERNS) if (e.p.test(html)) return 'ENGINE: ' + e.n;
  return null;
}

async function main() {
  console.log('=== Test 1: HL root page ===');
  let html = await probeUrl('https://pixelsuft.github.io/hl/');
  console.log('Found:', html ? 'yes (' + html.length + ' chars)' : 'no');
  let result = scanHtml(html || '');
  console.log('Root scan:', result);
  console.log('Has Emscripten:', /Emscripten/i.test(html));
  console.log('Has xash.html:', /xash\.html/.test(html));

  console.log('\n=== Test 2: HL xash.html ===');
  html = await probeUrl('https://pixelsuft.github.io/hl/xash.html');
  console.log('Found:', html ? 'yes (' + html.length + ' chars)' : 'no');
  result = scanHtml(html || '');
  console.log('xash.html scan:', result);

  console.log('\n=== Test 3: Slope ===');
  html = await probeUrl('https://slope-game-io.github.io/games/slope/index.html');
  console.log('Found:', html ? 'yes (' + html.length + ' chars)' : 'no');
  result = scanHtml(html || '');
  console.log('Slope scan:', result);

  console.log('\n=== Test 4: Scratch ===');
  html = await probeUrl('https://scratch.mit.edu/projects/embed/17964117/');
  console.log('Found:', html ? 'yes (' + html.length + ' chars)' : 'no');
  result = scanHtml(html || '');
  console.log('Scratch scan:', result);

  console.log('\n=== Test 5: HL xash.html full scan ===');
  html = await probeUrl('https://pixelsuft.github.io/hl/xash.html');
  if (html) {
    // Show all asset/engine matches
    for (const p of ASSET_PATTERNS) {
      const m = html.match(p);
      if (m) console.log('  MATCH ' + p.source + ' → ' + m[0].substring(0, 80));
    }
    for (const e of ENGINE_PATTERNS) {
      const m = html.match(e.p);
      if (m) console.log('  MATCH ' + e.n + ' → ' + m[0].substring(0, 80));
    }
  }
}
main().catch(console.error);
