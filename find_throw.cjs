// Find the EXACT line in sw.js that throws during eval
const http = require('http');
const fs = require('fs');
const { chromium } = require('playwright');

const swContent = fs.readFileSync('sw.js', 'utf8');
const lines = swContent.split('\n');

// Build an SW that imports UV and then runs each non-comment line
// individually in try/catch, logging the line number
let swTest = `importScripts('./uv/uv.bundle.js');
importScripts('./uv/uv.config.js');
importScripts('./uv/uv.sw.js');

// Test each line of the original sw.js in try/catch
const __SW_LINES__ = [];
const __SW_LINE_ERR__ = [];

${lines.slice(4).map((line, i) => {
  const lineNum = i + 5;
  const trimmed = line.trim();
  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith('//')) return '';
  // Skip function definitions and block starters (they don't throw by themselves)
  if (trimmed.startsWith('function ') || trimmed.endsWith('{') || trimmed === '{' || trimmed === '}') {
    return line; // return the original line
  }
  // For other lines, wrap in try/catch
  return `try { ${line} __SW_LINES__.push(${lineNum}); } catch(e) { __SW_LINE_ERR__.push({line:${lineNum}, msg:e.message, stack:(e.stack||'').substring(0,200)}); }`;
}).join('\n')}
// If no errors, log success
if (__SW_LINE_ERR__.length === 0) console.log('[SW-TEST] ALL LINES OK');
else console.log('[SW-TEST] ERRORS:', JSON.stringify(__SW_LINE_ERR__));
`;

// Now actually I need a smarter approach - this is getting too complex
// Let me just test the SW line-by-line manually

// Start server with wrapped SW
function startServer(swCode, port) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url === '/sw.js') {
        res.writeHead(200, {'Content-Type':'application/javascript'});
        res.end(swCode);
        return;
      }
      if (req.url.startsWith('/uv/')) {
        const p = '.' + req.url;
        if (fs.existsSync(p)) {
          res.writeHead(200, {'Content-Type':'application/javascript'});
          res.end(fs.readFileSync(p,'utf8'));
          return;
        }
      }
      if (req.url === '/') {
        res.writeHead(200,{'Content-Type':'text/html'});
        res.end('<!DOCTYPE html><html><body><script>navigator.serviceWorker.register("/sw.js",{scope:"/"}).then(function(r){console.log("[PAGE] OK");}).catch(function(e){console.error("[PAGE] FAIL:",e.message);});</script></body></html>');
        return;
      }
      res.writeHead(404).end();
    });
    server.listen(port, () => resolve(server));
  });
}

async function main() {
  // Test by wrapping specific sections of sw.js in try/catch
  // to find which section throws during eval
  
  // I'll use the template approach - keep imports, then add sw code AFTER imports
  // in progressively larger chunks, wrapping each chunk in try/catch
  
  // First, strip the import lines from sw.js
  const codeAfterImports = swContent.replace(/^importScripts\('.+?'\);\n?/gm, '').trim();
  
  // Divide into 5 chunks
  const chunkSize = Math.ceil(codeAfterImports.length / 5);
  const chunks = [];
  for (let i = 0; i < 5; i++) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize, codeAfterImports.length);
    chunks.push(codeAfterImports.substring(start, end));
  }
  
  // Test each chunk isolated
  for (let i = 0; i < chunks.length; i++) {
    const swCode = `importScripts('./uv/uv.bundle.js');
importScripts('./uv/uv.config.js');
importScripts('./uv/uv.sw.js');
try { ${chunks[i]} } catch(e) { console.log('[SW-CHUNK' + (i+1) + ' THREW]:', e.message); throw e; }
console.log('[SW-CHUNK' + (i+1) + '] OK');`;
    
    const server = await startServer(swCode, 8090 + i);
    const page = await browser.newPage();
    
    const l = await new Promise(r => {
      const logs = [];
      page.on('console', msg => logs.push(msg.text()));
      page.goto(`http://localhost:${8090 + i}/`, {waitUntil:'load',timeout:5000}).then(async () => {
        await new Promise(s => setTimeout(s, 2000));
        const info = await page.evaluate(async () => {
          try { const regs = await navigator.serviceWorker.getRegistrations(); return { regs: regs.length }; } catch(e) { return {err: e.message}; }
        });
        r({ name: `chunk ${i+1}`, logs, info });
      }).catch(e => r({ name: `chunk ${i+1}`, logs, info: {err: e.message} }));
    });
    
    const swMsg = l.logs.find(x => x.includes('SW-CHUNK'));
    console.log(`${l.name}: regs=${l.info.regs} | ${swMsg || 'no SW log'}`);
    if (l.info.regs === 0) {
      l.logs.filter(x => x.includes('FAIL')).forEach(x => console.log(`  ${x}`));
    }
    
    await page.close();
    await new Promise(r => server.close(r));
  }
  
  await browser.close();
}

// Clean approach: test each chunk independently
async function run() {
  const browser = await chromium.launch({headless:true, args:['--no-sandbox']});
  const failChunks = [];
  
  const codeAfterImports = swContent.replace(/^importScripts\('.+?'\);\n?/gm, '').trim();
  
  // Split into 8 smaller chunks
  const chunkSize = Math.ceil(codeAfterImports.length / 8);
  
  for (let i = 0; i < 8; i++) {
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize, codeAfterImports.length);
    const chunk = codeAfterImports.substring(start, end);
    
    const swCode = `importScripts('./uv/uv.bundle.js');
importScripts('./uv/uv.config.js');
importScripts('./uv/uv.sw.js');
try { ${chunk} } catch(e) {
  console.log('[SW-CHUNK' + (i+1) + ' THREW]:', e.message);
  throw e;
}
console.log('[SW-CHUNK' + (i+1) + '] OK');`;
    
    const port = 8100 + i;
    const server = await startServer(swCode, port);
    const page = await browser.newPage();
    
    const result = await new Promise(r => {
      const logs = [];
      page.on('console', msg => logs.push(msg.text()));
      page.goto(`http://localhost:${port}/`, {waitUntil:'load',timeout:10000}).then(async () => {
        await new Promise(s => setTimeout(s, 2000));
        try {
          const info = await page.evaluate(async () => {
            try { const regs = await navigator.serviceWorker.getRegistrations(); return { regs: regs.length }; } catch(e) { return {err: e.message}; }
          });
          r({ name: `chunk${i+1}`, logs, info, port });
        } catch(e) { r({ name: `chunk${i+1}`, logs, info: {err: e.message}, port }); }
      }).catch(e => r({ name: `chunk${i+1}`, logs, info: {err: e.message}, port }));
    });
    
    const swMsg = result.logs.find(x => x.includes('SW-CHUNK'));
    console.log(`${result.name}: regs=${result.info.regs} | ${swMsg || 'no SW log'}`);
    if (result.info.regs === 0 || (result.info.regs > 0 && !swMsg?.includes('OK'))) {
      console.log(`  -> FAILED`);
      failChunks.push(i);
      result.logs.filter(x => x.includes('FAIL') || x.includes('SW')).forEach(x => console.log(`  ${x}`));
    }
    
    await page.close();
    await new Promise(r => server.close(r));
  }
  
  console.log(`\nFailed chunks: ${failChunks.join(', ')}`);
  if (failChunks.length === 1) {
    console.log('THE FAILING CHUNK IS CHUNK ' + (failChunks[0] + 1));
    // Print the failing code
    const i = failChunks[0];
    const start = i * chunkSize;
    const end = Math.min((i + 1) * chunkSize, codeAfterImports.length);
    console.log('\nFailing code:');
    console.log(codeAfterImports.substring(start, end));
  }
  
  await browser.close();
}

run().catch(err => { console.error('FATAL:', err); process.exit(1); });
