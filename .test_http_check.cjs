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

    // Track all network requests
    const requests = [];
    const responses = [];
    page.on('request', req => {
        if (req.url().includes('/service/') || req.url().includes('/bare/')) {
            requests.push({ url: req.url(), method: req.method(), type: req.resourceType() });
        }
    });
    page.on('response', resp => {
        if (resp.url().includes('/service/') || resp.url().includes('/bare/')) {
            responses.push({ url: resp.url(), status: resp.status(), type: resp.request().resourceType() });
        }
    });

    await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 3000));

    // Wait for port ready
    for (let i = 0; i < 20; i++) {
        const ready = await page.evaluate(() => window.__UV_BOOT_STATUS__?.portReady);
        if (ready) break;
        await new Promise(r => setTimeout(r, 500));
    }

    // Load browser section
    await page.evaluate(() => { if (typeof window.loadSection === 'function') window.loadSection('browser'); });
    await new Promise(r => setTimeout(r, 2000));

    // Navigate
    await page.evaluate(() => window.VoltraBrowser.navigate('https://example.com'));

    // Wait for navigation to complete
    await new Promise(r => setTimeout(r, 10000));

    console.log('REQUESTS:', JSON.stringify(requests));
    console.log('RESPONSES:', JSON.stringify(responses));

    // Check iframe contentDocument
    const content = await page.evaluate(() => {
        const iframe = document.querySelector('iframe');
        if (!iframe) return { error: 'no iframe' };
        try {
            const doc = iframe.contentDocument;
            if (!doc) return { error: 'no contentDocument', src: iframe.src };
            return {
                src: iframe.src,
                readyState: doc.readyState,
                title: doc.title,
                bodyPreview: doc.body ? doc.body.innerText.substring(0, 500) : 'no body',
                bodyLen: doc.body ? doc.body.innerHTML.length : 0,
            };
        } catch(e) {
            return { error: e.message, src: iframe.src };
        }
    });
    console.log('CONTENT:', JSON.stringify(content, null, 2));

    // Make direct HTTP request to the Bare endpoint
    const bareResult = await new Promise((resolve) => {
        const http = require('http');
        const data = JSON.stringify({
            headers: { Host: 'example.com', 'User-Agent': 'Mozilla/5.0' },
        });
        const opts = {
            hostname: 'localhost',
            port: 8080,
            path: '/bare/v1/',
            method: 'GET',
            headers: {
                'X-Bare-Host': 'example.com',
                'X-Bare-Port': '443',
                'X-Bare-Protocol': 'https:',
                'X-Bare-Path': '/',
                'X-Bare-Headers': JSON.stringify({ Host: 'example.com', 'User-Agent': 'Mozilla/5.0' }),
                'X-Bare-Forward-Headers': '[]',
            },
        };
        const req = http.request(opts, res => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                resolve({
                    status: res.statusCode,
                    bareStatus: res.headers['x-bare-status'],
                    bodyLen: body.length,
                    bodyPreview: body.substring(0, 300),
                });
            });
        });
        req.on('error', e => resolve({ error: e.message }));
        req.end();
    });
    console.log('BARE_DIRECT:', JSON.stringify(bareResult, null, 2));

    await browser.close();
    proc.kill();
    console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
