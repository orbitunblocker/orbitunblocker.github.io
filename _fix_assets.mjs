import fs from 'fs';
import path from 'path';
import https from 'https';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = p => path.join(__dirname, 'public', 'assets', 'images', p);

function download(url, filepath) {
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const opts = { hostname: u.hostname, path: u.pathname + u.search, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 };
      https.get(opts, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const loc = res.headers.location;
          const absUrl = loc.startsWith('http') ? loc : (loc.startsWith('/') ? u.origin + loc : u.origin + '/' + loc);
          download(absUrl, filepath).then(resolve);
          res.resume();
          return;
        }
        if (res.statusCode !== 200) { resolve(false); return; }
        const ct = res.headers['content-type'] || '';
        if (!ct.startsWith('image/')) { resolve(false); return; }
        const f = fs.createWriteStream(filepath);
        res.pipe(f);
        f.on('finish', () => { f.close(); console.log('OK', path.basename(filepath)); resolve(true); });
        f.on('error', (e) => { fs.unlink(filepath, () => {}); resolve(false); });
      }).on('error', (e) => { resolve(false); });
    } catch(e) { resolve(false); }
  });
}

async function main() {
  // 1. Rename existing generic files first
  const gamesDir = path.join(__dirname, 'public', 'assets', 'images', 'games');
  if (fs.existsSync(path.join(gamesDir, 'img.jpg'))) {
    // This is from nintendo.com (superhot) ~297KB
    fs.renameSync(path.join(gamesDir, 'img.jpg'), path.join(gamesDir, 'superhot.jpg'));
    console.log('Renamed img.jpg → superhot.jpg');
  }
  if (fs.existsSync(path.join(gamesDir, 'img.png'))) {
    // This is from encrypted gstatic (slow-roads) ~3KB
    fs.renameSync(path.join(gamesDir, 'img.png'), path.join(gamesDir, 'slow-roads.jpg'));
    console.log('Renamed img.png → slow-roads.jpg');
  }

  // 2. Theme images - re-download with proper names
  const themeDir = base('themes');
  // Delete existing generic files
  for (const f of fs.readdirSync(themeDir)) {
    if (f === 'image.png' || f.startsWith('image-2026')) {
      fs.unlinkSync(path.join(themeDir, f));
    }
  }
  const themeUrls = [
    { url: 'https://i.ibb.co/jPTZkZpS/image.png', name: 'snow.png' },
    { url: 'https://i.ibb.co/zVMnb70D/image-2026-06-11-231050971.png', name: 'sunset.png' },
    { url: 'https://i.ibb.co/M58hgr0F/image.png', name: 'grape.png' },
    { url: 'https://i.ibb.co/d0r4nWsH/image.png', name: 'dracula.png' },
    { url: 'https://i.ibb.co/Z6nz0QKB/image-2026-06-11-231237791.png', name: 'ocean.png' },
    { url: 'https://i.ibb.co/dwb0Nn2T/image.png', name: 'forest.png' },
    { url: 'https://i.ibb.co/dwRrjsWK/image-2026-06-11-231356311.png', name: 'lavender.png' },
    { url: 'https://i.ibb.co/wZVbmXKf/image.png', name: 'amber.png' },
    { url: 'https://i.ibb.co/jZQbLB7v/image.png', name: 'rose.png' },
  ];
  for (const t of themeUrls) {
    await download(t.url, path.join(themeDir, t.name));
  }

  // 3. Icons - rename generic
  const iconDir = base('icons');
  if (fs.existsSync(path.join(iconDir, 'img.png'))) {
    // This is the gstatic search icon
    fs.renameSync(path.join(iconDir, 'img.png'), path.join(iconDir, 'google-favicon.png'));
    console.log('Renamed img.png → google-favicon.png');
  }
  // The drive_2026_32dp.ico is the google docs favicon - rename for clarity
  if (fs.existsSync(path.join(iconDir, 'drive_2026_32dp.ico'))) {
    fs.renameSync(path.join(iconDir, 'drive_2026_32dp.ico'), path.join(iconDir, 'google-drive.ico'));
    console.log('Renamed drive_2026_32dp.ico → google-drive.ico');
  }

  // 4. Quicklinks - rename the hash-name files
  const qlDir = base('quicklinks');
  if (fs.existsSync(path.join(qlDir, 'f38efa877c6c7b446c02ae1e89ac44d3.jpg'))) {
    fs.renameSync(path.join(qlDir, 'f38efa877c6c7b446c02ae1e89ac44d3.jpg'), path.join(qlDir, 'soundcloud.jpg'));
    console.log('Renamed f38efa... → soundcloud.jpg');
  }
  if (fs.existsSync(path.join(qlDir, 'q3I5kJ5U9.jpeg'))) {
    fs.renameSync(path.join(qlDir, 'q3I5kJ5U9.jpeg'), path.join(qlDir, 'github.jpeg'));
    console.log('Renamed q3I5kJ5U9 → github.jpeg');
  }

  console.log('\nAll fixes applied.');
}

main();
