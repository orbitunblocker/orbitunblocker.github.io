const { spawn } = require('child_process');
const http = require('http');

async function main() {
    const proc = spawn('node', ['server.js'], {
        cwd: 'C:\\Users\\abeni\\Downloads\\orbit',
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
    });

    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server timeout')), 15000);
        const check = () => {
            http.get('http://localhost:8080/', (res) => { clearTimeout(timeout); resolve(); }).on('error', () => setTimeout(check, 500));
        };
        setTimeout(check, 1000);
    });

    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(e => console.log('GOTO WARN:', e.message));
    await new Promise(r => setTimeout(r, 3000));

    // Test UV encoding/decoding directly
    const result = await page.evaluate(() => {
        const uv = new Ultraviolet(__uv$config);
        const encoded = uv.encode('https://example.com');
        const decoded = uv.decode(encoded);
        const encoded2 = 'hvtrs8%2F-ezaopne%2Ccmm';
        const decoded2 = uv.decode(encoded2);
        const prefix = __uv$config.prefix;
        return { encoded, decoded, decoded2, prefix, encodeGoogle: uv.encode('https://www.google.com') };
    });
    console.log('UV TEST:', JSON.stringify(result, null, 2));

    await browser.close();
    proc.kill();
    console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
