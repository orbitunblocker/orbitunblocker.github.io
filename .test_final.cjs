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
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--window-size=1280,900'],
    });
    const page = await browser.newPage();

    // Track ALL requests
    const urls = [];
    page.on('request', req => urls.push(req.url()));

    await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    for (let i = 0; i < 20; i++) {
        const ready = await page.evaluate(() => window.__UV_BOOT_STATUS__?.portReady);
        if (ready) break;
        await new Promise(r => setTimeout(r, 500));
    }

    // Clear URL list
    urls.length = 0;

    // Load browser section
    await page.evaluate(() => { if (typeof window.loadSection === 'function') window.loadSection('browser'); });
    await new Promise(r => setTimeout(r, 2000));

    // Navigate
    await page.evaluate(() => window.VoltraBrowser.navigate('https://example.com'));
    await new Promise(r => setTimeout(r, 8000));

    // Check all iframe-related info
    const info = await page.evaluate(() => {
        const iframe = document.querySelector('iframe');
        if (!iframe) return { error: 'no iframe' };
        const info = {
            id: iframe.id,
            srcAttr: iframe.getAttribute('src'),
            inDocSrc: iframe.src,
            hasSrcdoc: !!iframe.srcdoc,
            sandbox: iframe.sandbox?.value,
        };
        try {
            info.contentLocation = iframe.contentWindow?.location?.href || 'no access';
        } catch(e) {
            info.contentLocation = 'err: ' + e.message;
        }
        return info;
    });
    console.log('IFRAME:', JSON.stringify(info, null, 2));

    // Check if ANY URL in the list contains /service/
    const serviceUrls = urls.filter(u => u.includes('/service/'));
    console.log('ALL URLS with /service/:', serviceUrls.length);
    serviceUrls.forEach(u => console.log('  ', u));

    // Also look for /bare/
    const bareUrls = urls.filter(u => u.includes('/bare/'));
    console.log('ALL URLS with /bare/:', bareUrls.length);
    bareUrls.forEach(u => console.log('  ', u));

    // Check what the total URL count was
    console.log('TOTAL URLS captured:', urls.length);

    // Check server-trace.log
    const fs = await import('fs');
    try {
        const trace = fs.readFileSync('C:\\Users\\abeni\\Downloads\\orbit\\server-trace.log', 'utf8');
        const lines = trace.trim().split('\n');
        const recent = lines.slice(-30);
        console.log('=== SERVER TRACE (last 30) ===');
        recent.forEach(l => console.log(l));
    } catch(e) {
        console.log('No server trace:', e.message);
    }

    await browser.close();
    proc.kill();
    console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
