async function main() {
    const { spawn } = require('child_process');
    const http = require('http');
    const puppeteer = (await import('puppeteer')).default;

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

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--window-size=1280,900'],
    });
    const page = await browser.newPage();

    page.on('console', (msg) => console.log('[PAGE]', msg.type(), msg.text()));

    await page.goto('http://localhost:8080', { waitUntil: 'networkidle0', timeout: 15000 }).catch(() => {});

    for (let i = 0; i < 20; i++) {
        const ready = await page.evaluate(() => window.__UV_BOOT_STATUS__.portReady);
        if (ready) break;
        await new Promise(r => setTimeout(r, 500));
    }
    console.log('OK port ready');

    const status = await page.evaluate(() => ({
        portReady: window.__UV_BOOT_STATUS__.portReady,
        bareMuxReady: window.__UV_BOOT_STATUS__.bareMuxReady,
        swPortStatus: window.__UV_BOOT_STATUS__.swPortStatus,
    }));
    console.log('STATUS:', JSON.stringify(status));

    // Load browser section first
    await page.evaluate(() => {
        if (typeof window.loadSection === 'function') window.loadSection('browser');
    });
    await new Promise(r => setTimeout(r, 1000));

    // Navigate using VoltraBrowser.navigate
    const result = await page.evaluate(async () => {
        let out = [];
        if (typeof window.VoltraBrowser?.navigate === 'function') {
            try {
                out.push('VoltraBrowser.navigate exists');
                window.VoltraBrowser.navigate('https://example.com');
                out.push('navigate called');
            } catch(e) {
                out.push('navigate error: ' + e.message);
            }
        } else {
            out.push('no VoltraBrowser.navigate');
            const keys = Object.keys(window).filter(k => k.includes('Voltra') || k.includes('browse') || k.includes('Browse'));
            out.push('found: ' + keys.join(', '));
        }
        const iframe = document.querySelector('iframe');
        out.push('iframe: ' + (iframe ? (iframe.src || 'empty-src').substring(0, 150) : 'none'));
        out.push('routeDebug: ' + JSON.stringify(window.__UV_ROUTE_DEBUG__ || {}));
        return out.join(' | ');
    });
    console.log('NAV RESULT:', result);

    // Wait for iframe to load content
    await new Promise(r => setTimeout(r, 8000));
    const final = await page.evaluate(() => {
        const iframe = document.querySelector('iframe');
        let contentInfo = {};
        if (iframe && iframe.contentDocument) {
            try {
                const doc = iframe.contentDocument;
                contentInfo.title = doc.title;
                contentInfo.bodyLen = doc.body ? doc.body.innerHTML.length : 0;
                contentInfo.hasContent = doc.body && doc.body.innerHTML.length > 50;
                contentInfo.url = iframe.src ? iframe.src.substring(0, 200) : 'none';
            } catch(e) {
                contentInfo.error = e.message;
                contentInfo.url = iframe.src;
            }
        } else {
            contentInfo.note = iframe ? 'no contentDocument (cross-origin)' : 'no iframe';
            if (iframe) contentInfo.url = iframe.src;
        }
        return contentInfo;
    });
    console.log('IFRAME:', JSON.stringify(final));

    // Try GET_DIAG with multiple approaches
    const controller = await page.evaluate(async () => {
        try {
            const reg = await navigator.serviceWorker.ready;
            return reg.active ? true : false;
        } catch(e) { return false; }
    });
    console.log('SW_ACTIVE:', controller);

    // Use navigator.serviceWorker.ready to get the active registration
    const diag = await page.evaluate(async () => {
        try {
            const reg = await navigator.serviceWorker.ready;
            if (!reg || !reg.active) return { error: 'no active SW' };
            const channel = new MessageChannel();
            return await Promise.race([
                new Promise(resolve => {
                    channel.port1.onmessage = e => {
                        channel.port1.close();
                        resolve(e.data);
                    };
                    reg.active.postMessage({ type: 'GET_DIAG' }, [channel.port2]);
                }),
                new Promise(resolve => setTimeout(() => resolve({ error: 'timeout' }), 3000))
            ]);
        } catch (e) {
            return { error: e.message };
        }
    });
    console.log('DIAG:', JSON.stringify(diag, (k, v) => k === 'port' ? undefined : v));

    await browser.close();
    proc.kill();
    console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
