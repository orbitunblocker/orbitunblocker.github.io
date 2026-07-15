#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_JS = join(__dirname, '..', 'js', 'app.js');

const BLOCKED_PATTERNS = [
  'checking your browser', 'verify you are',
  'ddos-guard', 'performing a security check',
  'attention required', 'just a moment',
  'cf-browser-verification', 'challenge-platform'
];

const TIMEOUT_MS = 10000;

function extractGames(source) {
  const games = [];
  const gameRegex = /\{\s*\n\s*id:\s*"([^"]+)",\s*\n\s*title:\s*"([^"]+)",/g;
  let match;
  while ((match = gameRegex.exec(source)) !== null) {
    const id = match[1];
    const title = match[2];
    const startIdx = match.index;
    const endIdx = source.indexOf('},', startIdx);
    const block = source.slice(startIdx, endIdx === -1 ? startIdx + 500 : endIdx + 1);

    const urlMatch = block.match(/url:\s*(?:"([^"]+)"|([a-zA-Z]\w*))/);
    const sourceMatch = block.match(/source:\s*"([^"]+)"/);
    const badgeMatch = block.match(/badge:\s*"([^"]+)"/);

    if (urlMatch) {
      games.push({
        id,
        title,
        url: urlMatch[1] || urlMatch[2],
        source: sourceMatch ? sourceMatch[1] : 'unknown',
        badge: badgeMatch ? badgeMatch[1] : 'N/A'
      });
    }
  }
  return games;
}

async function checkUrl(game) {
  const start = Date.now();
  let result = { ...game, status: 'UNKNOWN', code: 0, redirects: [], latency: 0, error: '', blocked: false };

  if (!game.url || game.url === '') {
    result.status = 'NO_URL';
    return result;
  }

  if (game.url.startsWith('data:')) {
    result.status = 'EMBEDDED';
    return result;
  }

  if (game.url.match(/^[a-zA-Z]\w*Url$/)) {
    result.status = 'VARIABLE';
    return result;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(game.url, {
      signal: controller.signal,
      redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OrbitHealthCheck/1.0)' }
    });
    clearTimeout(timer);

    result.code = response.status;
    result.latency = Date.now() - start;

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') || '(none)';
      result.redirects.push(location);
      result.status = 'REDIRECT';
    } else     if (response.status >= 200 && response.status < 300) {
      const text = await response.text();
      const body = text.slice(0, 8000).toLowerCase();
      const blocked = body.length < 3000 && BLOCKED_PATTERNS.some(p => body.includes(p));
      if (blocked) {
        result.status = 'BLOCKED';
        result.blocked = true;
      } else {
        result.status = 'OK';
      }
    } else if (response.status === 403) {
      result.status = 'BLOCKED';
      result.blocked = true;
    } else if (response.status === 404) {
      result.status = 'NOT_FOUND';
    } else {
      result.status = `HTTP_${response.status}`;
    }
  } catch (err) {
    result.error = err.message;
    result.latency = Date.now() - start;
    if (err.name === 'AbortError') {
      result.status = 'TIMEOUT';
    } else if (err.message?.includes('ENOTFOUND') || err.message?.includes('ECONNREFUSED')) {
      result.status = 'UNREACHABLE';
    } else {
      result.status = 'ERROR';
    }
  }

  return result;
}

async function main() {
  console.log('Orbit Source Health Checker');
  console.log('=' .repeat(50));
  console.log(`Reading: ${APP_JS}\n`);

  const source = readFileSync(APP_JS, 'utf-8');
  const games = extractGames(source);

  console.log(`Found ${games.length} game entries.\n`);

  const results = [];
  let ok = 0, failed = 0, blocked = 0, redirect = 0, other = 0;

  for (const game of games) {
    const result = await checkUrl(game);
    results.push(result);

    const icon = result.status === 'OK' ? '✓' :
                 result.status === 'BLOCKED' ? '⛔' :
                 result.status === 'REDIRECT' ? '↪' :
                 result.status === 'EMBEDDED' || result.status === 'VARIABLE' || result.status === 'NO_URL' ? '•' : '✗';

    console.log(`${icon} ${result.id.padEnd(22)} ${result.status.padEnd(12)} ${result.code || ''}${result.error ? ' ' + result.error.slice(0, 50) : ''}`);

    if (result.status === 'OK') ok++;
    else if (result.status === 'BLOCKED') blocked++;
    else if (result.status === 'REDIRECT') redirect++;
    else if (['EMBEDDED', 'VARIABLE', 'NO_URL'].includes(result.status)) other++;
    else failed++;
  }

  const report = generateReport(results, ok, failed, blocked, redirect, other);
  const reportPath = join(__dirname, '..', 'health-report.md');
  writeFileSync(reportPath, report);
  console.log(`\nReport written to: ${reportPath}`);
  console.log(`Summary: ${ok} OK, ${failed} FAIL, ${blocked} BLOCKED, ${redirect} REDIRECT, ${other} SKIPPED\n`);
}

function generateReport(results, ok, failed, blocked, redirect, other) {
  const lines = [
    '# Orbit Source Health Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '## Summary',
    '',
    `| Status | Count |`,
    `|--------|-------|`,
    `| OK | ${ok} |`,
    `| Failed | ${failed} |`,
    `| Blocked | ${blocked} |`,
    `| Redirect | ${redirect} |`,
    `| Skipped (embedded/var/no-url) | ${other} |`,
    `| **Total** | **${results.length}** |`,
    '',
    '## Results',
    '',
    '| Game | URL | Status | Code | Source | Notes |',
    '|------|-----|--------|------|--------|-------|',
  ];

  for (const r of results) {
    const url = r.url && !r.url.match(/^[a-zA-Z]\w*Url$/) ? r.url : '(variable)';
    const notes = r.error || (r.redirects.length ? `→ ${r.redirects[0]}` : '');
    lines.push(`| ${r.id} | ${url} | ${r.status} | ${r.code} | ${r.source} | ${notes} |`);
  }

  return lines.join('\n');
}

main().catch(err => {
  console.error('Health check failed:', err);
  process.exit(1);
});
