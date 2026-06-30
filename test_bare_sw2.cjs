const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const BARE_SW = `console.log('[BARE-SW] script evaluated');
self.addEventListener('install', function(e) { console.log('[BARE-SW] install'); self.skipWaiting(); });
self.addEventListener('activate', function(e) { console.log('[BARE-SW] activate'); e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(e) {});
`;

function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url === '/sw.js') {
        res.writeHead(200, { 'Content-Type': 'application/javascript' });
        res.end(BARE_SW);
        return;
      }
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test</title></head><body><h1>Test</h1><script>console.log("[PAGE] before SW reg"); navigator.serviceWorker.register("/sw.js", {scope:"/"}).then(function(reg){console.log("[PAGE] SW registered", reg.scope); reg.addEventListener("updatefound", function(){console.log("[PAGE] updatefound");}); }).catch(function(err){console.error("[PAGE] SW reg failed:", err.message);}); console.log("[PAGE] after SW reg");</script></body></html>');
        return;
      }
      res.writeHead(404).end('Not found');
    });
    server.listen(8084, () => { console.log('Server on 8084'); resolve(server); });
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', msg => { logs.push(`[${msg.type()}] ${msg.text()}`); console.log(`[PAGE ${msg.type()}] ${msg.text()}`); });
  page.on('pageerror', err => logs.push(`[PAGE-ERR] ${err.message}`));
  page.on('response', resp => { if (resp.status() >= 400) console.log(`[HTTP ${resp.status()}] ${resp.url()}`); });

  await page.goto('http://localhost:8084/', { waitUntil: 'load', timeout: 15000 });
  console.log('=== Page loaded, waiting for SW registration ===');

  // Poll for SW state instead of waiting for ready
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500));
    const info = await page.evaluate(async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        const reg = regs[0];
        if (!reg) return { status: 'no-regs' };
        return {
          status: 'has-reg',
          active: !!reg.active,
          installing: !!reg.installing,
          waiting: !!reg.waiting,
          activeUrl: reg.active?.scriptURL,
          activeState: reg.active?.state,
        };
      } catch(e) { return { error: e.message }; }
    });
    const hasInfo = info.status === 'has-reg' ? `active=${info.active} installing=${info.installing} state=${info.activeState}` : info.status;
    console.log(`t=${(i+1)*500}ms: ${hasInfo}`);
    if (info.active) break;
  }

  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
  server.close();
  console.log('Done');
}
main().catch(err => { console.error('FATAL:', err); process.exit(1); });
