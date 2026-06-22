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

    // Capture ALL requests and responses
    const allReqs = [];
    const allResps = [];
    const allConsoles = [];
    page.on('request', req => allReqs.push({ url: req.url().substring(0, 120), type: req.resourceType(), method: req.method() }));
    page.on('response', resp => allResps.push({ url: resp.url().substring(0, 120), status: resp.status(), type: resp.request().resourceType() }));
    page.on('console', msg => allConsoles.push(msg.text()));

    await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    for (let i = 0; i < 20; i++) {
        const ready = await page.evaluate(() => window.__UV_BOOT_STATUS__?.portReady);
        if (ready) break;
        await new Promise(r => setTimeout(r, 500));
    }

    // Load browser section
    await page.evaluate(() => { if (typeof window.loadSection === 'function') window.loadSection('browser'); });
    await new Promise(r => setTimeout(r, 2000));

    // Check what iframes exist
    const iframeInfo = await page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe');
        return Array.from(iframes).map((f, i) => ({
            idx: i,
            id: f.id,
            src: f.getAttribute('src'),
            inDocSrc: f.src,
        }));
    });
    console.log('IFRAMES before nav:', JSON.stringify(iframeInfo));

    // Navigate
    await page.evaluate(() => window.VoltraBrowser.navigate('https://example.com'));

    // Check that the iframe src changed
    await new Promise(r => setTimeout(r, 500));
    const iframeAfter = await page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe');
        return Array.from(iframes).map(f => ({ id: f.id, src: f.getAttribute('src'), inDocSrc: f.src }));
    });
    console.log('IFRAMES after nav (500ms):', JSON.stringify(iframeAfter));

    // Wait and check again
    await new Promise(r => setTimeout(r, 2000));
    const iframeAfter2 = await page.evaluate(() => {
        const iframes = document.querySelectorAll('iframe');
        return Array.from(iframes).map(f => ({ id: f.id, src: f.getAttribute('src'), inDocSrc: f.src }));
    });
    console.log('IFRAMES after nav (2500ms):', JSON.stringify(iframeAfter2));

    // Now check all network requests for /service/ or /bare/
    console.log('=== NETWORK REQUESTS ===');
    allReqs.forEach((r, i) => console.log(i, r.method, r.url, '(' + r.type + ')'));

    console.log('=== NETWORK RESPONSES ===');
    allResps.forEach((r, i) => console.log(i, r.status, r.url, '(' + r.type + ')'));

    // Check console for UV-related
    const uvConsole = allConsoles.filter(c => c.includes('[UV') || c.includes('/service/') || c.includes('bareClient'));
    console.log('=== UV CONSOLE ===');
    uvConsole.forEach(c => console.log(c));

    await browser.close();
    proc.kill();
    console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
