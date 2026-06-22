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

    // Capture console logs
    const logs = [];
    page.on('console', msg => logs.push(msg.text()));

    await page.goto('http://localhost:8080', { waitUntil: 'domcontentloaded', timeout: 10000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    for (let i = 0; i < 20; i++) {
        const ready = await page.evaluate(() => window.__UV_BOOT_STATUS__?.portReady);
        if (ready) break;
        await new Promise(r => setTimeout(r, 500));
    }

    await page.evaluate(() => { if (typeof window.loadSection === 'function') window.loadSection('browser'); });
    await new Promise(r => setTimeout(r, 2000));

    await page.evaluate(() => window.VoltraBrowser.navigate('https://example.com'));
    await new Promise(r => setTimeout(r, 10000));

    // Extract error details from the iframe
    const errorDetail = await page.evaluate(() => {
        const iframe = document.querySelector('iframe');
        if (!iframe) return { error: 'no iframe' };
        try {
            const doc = iframe.contentDocument;
            if (!doc) return { error: 'no contentDocument' };
            const fetchedURL = doc.getElementById('fetchedURL');
            const errorTitle = doc.getElementById('errorTitle');
            const errorMessage = doc.getElementById('errorMessage');
            const errorTrace = doc.getElementById('errorTrace');
            const uvVersion = doc.getElementById('uvVersion');
            const uvHost = doc.getElementById('uvHostname');
            return {
                type: 'error-page',
                fetchedURL: fetchedURL?.textContent,
                errorTitle: errorTitle?.textContent,
                errorMessage: errorMessage?.textContent,
                errorTrace: errorTrace?.value,
                uvVersion: uvVersion?.textContent,
                uvHost: uvHost?.textContent,
            };
        } catch(e) {
            return { error: e.message };
        }
    });
    console.log('ERROR_DETAIL:', JSON.stringify(errorDetail, null, 2));

    // Also check UV internal logs by looking for them in the console
    const uvLogs = logs.filter(l => l.includes('[UV-INTERNAL]'));
    console.log('UV_CONSOLE_LOGS:', uvLogs.length);
    uvLogs.forEach(l => console.log('  ', l));

    await browser.close();
    proc.kill();
    console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
