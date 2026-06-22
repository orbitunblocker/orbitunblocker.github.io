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
    console.log('OK server started');

    const puppeteer = (await import('puppeteer')).default;
    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--window-size=1280,900'],
    });
    const page = await browser.newPage();

    const allLogs = [];
    page.on('console', msg => allLogs.push(msg.text()));

    await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    for (let i = 0; i < 20; i++) {
        const ready = await page.evaluate(() => window.__UV_BOOT_STATUS__?.portReady);
        if (ready) break;
        await new Promise(r => setTimeout(r, 500));
    }
    console.log('OK port ready');

    await page.evaluate(() => { if (typeof window.loadSection === 'function') window.loadSection('browser'); });
    await new Promise(r => setTimeout(r, 2000));

    await page.evaluate(() => window.VoltraBrowser.navigate('https://example.com'));
    await new Promise(r => setTimeout(r, 10000));

    const content = await page.evaluate(() => {
        const iframe = document.querySelector('iframe');
        if (!iframe) return { error: 'no iframe' };
        try {
            const doc = iframe.contentDocument;
            if (!doc) return { error: 'no contentDocument', loc: iframe.contentWindow?.location?.href };
            return {
                loc: iframe.contentWindow?.location?.href,
                readyState: doc.readyState,
                title: doc.title,
                bodyPreview: doc.body ? doc.body.innerText.substring(0, 500) : 'no body',
                hasExampleDomain: doc.body ? doc.body.innerText.includes('Example Domain') : false,
                hasError: doc.body ? doc.body.innerText.includes('Error processing') : false,
                bodyLen: doc.body ? doc.body.innerHTML.length : 0,
            };
        } catch(e) {
            return { error: e.message, loc: iframe.contentWindow?.location?.href };
        }
    });
    console.log('CONTENT:', JSON.stringify(content, null, 2));

    if (content.hasExampleDomain) {
        console.log('SUCCESS: Example Domain loaded through UV proxy!');
    } else if (content.hasError) {
        console.log('FAILED: UV error page shown');
    } else {
        console.log('UNEXPECTED: Content does not match expected');
    }

    await browser.close();
    proc.kill();
    console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
