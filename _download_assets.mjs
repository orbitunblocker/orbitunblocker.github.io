import fs from 'fs';
import path from 'path';
import https from 'https';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const results = [];
let successCount = 0;
let failCount = 0;

function urlToFilename(url, contentType) {
  const u = new URL(url);
  let ext = path.extname(u.pathname).toLowerCase();
  if (ext && ext.length <= 5) return path.basename(u.pathname);
  const mimeMap = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/webp': '.webp', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico' };
  return `img${mimeMap[contentType] || '.bin'}`;
}

function download(url, dest) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    protocol.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, (res) => {
      const ct = res.headers['content-type'] || '';
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        download(res.headers.location, dest).then(resolve);
        return;
      }
      if (res.statusCode !== 200) {
        resolve({ url, dest, status: res.statusCode, error: `HTTP ${res.statusCode}` });
        return;
      }
      if (!ct.startsWith('image/')) {
        res.resume();
        resolve({ url, dest, status: 200, error: `Not an image: ${ct}` });
        return;
      }
      const fn = urlToFilename(url, ct);
      const fp = path.join(dest, fn);
      const file = fs.createWriteStream(fp);
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve({ url, dest, status: 200, file: fp, error: null });
      });
      file.on('error', (e) => {
        fs.unlink(fp, () => {});
        resolve({ url, dest, status: 200, error: e.message });
      });
    }).on('error', (e) => {
      if (e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'ECONNRESET') {
        resolve({ url, dest, status: 0, error: e.code });
      } else {
        resolve({ url, dest, status: 0, error: e.message });
      }
    }).on('timeout', function() { this.destroy(); resolve({ url, dest, status: 0, error: 'TIMEOUT' }); });
  });
}

async function batchDownload(entries, concurrency = 5) {
  const results = [];
  for (let i = 0; i < entries.length; i += concurrency) {
    const batch = entries.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(e => download(e.url, e.dest)));
    results.push(...batchResults);
    for (const r of batchResults) {
      if (r.error) { failCount++; console.log(`FAIL [${r.error}] ${r.url}`); }
      else { successCount++; console.log(`OK   ${r.file}`); }
    }
  }
  return results;
}

// ---- ALL EXTERNAL IMAGES ----
const tasks = [];

// 1. Logo GIF (index.html)
tasks.push({ url: 'https://i.ibb.co/xS3pNYjB/tet-ezgif-com-effects-1.gif', dest: path.join(__dirname, 'public', 'assets', 'images', 'logos') });

// 2. Theme previews (app.js)
const themes = [
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
for (const t of themes) {
  tasks.push({ url: t.url, dest: path.join(__dirname, 'public', 'assets', 'images', 'themes') });
}

// 3. Search engine favicons (browser-engine.js)
const searchIcons = [
  { url: 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://google.com&size=256', name: 'google-search.png' },
  { url: 'https://www.bing.com/favicon.ico', name: 'bing.ico' },
  { url: 'https://duckduckgo.com/favicon.ico', name: 'duckduckgo.ico' },
  { url: 'https://4get.ca/favicon.ico', name: '4get.ico' },
];
for (const s of searchIcons) {
  tasks.push({ url: s.url, dest: path.join(__dirname, 'public', 'assets', 'images', 'icons') });
}

// 4. Quick-link images (browser-engine.js)
const quicklinks = [
  { url: 'https://i.ytimg.com/vi/s-KZu1kru8Y/sddefault.jpg', name: 'youtube.jpg' },
  { url: 'https://freshonthenet.co.uk/wp-content/uploads/2020/10/Twitch-Logo.jpg', name: 'twitch.jpg' },
  { url: 'https://www.musicweek.com/cimages/f38efa877c6c7b446c02ae1e89ac44d3.jpg', name: 'soundcloud.jpg' },
  { url: 'https://www.scdn.co/i/_global/open-graph-default.png', name: 'spotify.png' },
  { url: 'https://www.internetmatters.org/wp-content/uploads/2025/06/Chat-GPT-logo.webp', name: 'chatgpt.webp' },
  { url: 'https://gamemakerstoolkit.com/wp-content/uploads/2024/01/perk-discord.jpg', name: 'discord.jpg' },
  { url: 'https://blog.kubesimplify.com/img/blog/git-and-github-a-beginners-guide/q3I5kJ5U9.jpeg', name: 'github.jpeg' },
  { url: 'https://variety.com/wp-content/uploads/2021/06/TikTok-Jump.png?w=970&h=545&crop=1', name: 'tiktok.png' },
  { url: 'https://media.wired.com/photos/592681ffcfe0d93c47430739/3:2/w_2560%2Cc_limit/Netflix-Logo-Print_CMYK2.jpg', name: 'netflix.jpg' },
  { url: 'https://espnpressroom.com/us/files/2021/06/0-ESPN-Logo-for-PressRoom-780x470.jpg', name: 'espn.jpg' },
];
for (const q of quicklinks) {
  tasks.push({ url: q.url, dest: path.join(__dirname, 'public', 'assets', 'images', 'quicklinks') });
}

// 5. Service/cloak icons (app.js)
const serviceIcons = [
  { url: 'https://www.google.com/favicon.ico', name: 'google.ico' },
  { url: 'https://ssl.gstatic.com/classroom/favicon.png', name: 'classroom.png' },
  { url: 'https://docs.google.com/favicon.ico', name: 'google-docs.ico' },
  { url: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon-2023q4.ico', name: 'google-docs-favicon.ico' },
];
for (const s of serviceIcons) {
  tasks.push({ url: s.url, dest: path.join(__dirname, 'public', 'assets', 'images', 'icons') });
}

// 6. Game thumbnails (app.js)
const games = [
  { url: 'https://outred.org/g/assets/cookie-clicker/cookie1.jpeg', name: 'cookie-clicker.jpeg' },
  { url: 'https://outred.org/g/assets/basketball-stars/assets/images/basketball-stars.png', name: 'basketball-stars.png' },
  { url: 'https://outred.org/g/assets/cluster-rush/splash.png', name: 'cluster-rush.png' },
  { url: 'https://outred.org/g/assets/drift-hunters/drift-hunters.png', name: 'drift-hunters-outred.png' },
  { url: 'https://outred.org/g/assets/ducklife1/ducklife.png', name: 'ducklife1.png' },
  { url: 'https://outred.org/g/assets/minecraft-15/splash.jpeg', name: 'minecraft-15.jpeg' },
  { url: 'https://outred.org/g/assets/elasticman/elasticman.jpg', name: 'elasticman.jpg' },
  { url: 'https://outred.org/g/assets/flappy-bird/assets/thumb.png', name: 'flappy-bird.png' },
  { url: 'https://outred.org/g/assets/fruitninja/FruitNinjaTeaser.jpg', name: 'fruit-ninja.jpg' },
  { url: 'https://outred.org/g/assets/ducklife2/ducklife2.png', name: 'ducklife2.png' },
  { url: 'https://outred.org/g/assets/motox3m/splash.jpg', name: 'motox3m.jpg' },
  { url: 'https://outred.org/g/assets/paperio2/images/icon512.png', name: 'paperio2.png' },
  { url: 'https://outred.org/g/assets/snowbattle/img/logo.png', name: 'snowbattle.png' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Slope.webp', name: 'slope.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Eaglercraft_v1_8.webp', name: 'eaglercraft.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/FNAF_1__Scratch_.webp', name: 'fnaf1.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/FNAF_2.webp', name: 'fnaf2.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/FNAF_3.webp', name: 'fnaf3.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/FNAF_4__Scratch_.webp', name: 'fnaf4.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Basketball_Stars.webp', name: 'basketball-stars-blog.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Drift_Boss.webp', name: 'drift-boss.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Mario_Kart_64.webp', name: 'mario-kart-64.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Cookie_Clicker.webp', name: 'cookie-clicker-blog.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Super_Mario_64.webp', name: 'super-mario-64.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Drift_Hunters.webp', name: 'drift-hunters-blog.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Retro_Bowl.webp', name: 'retro-bowl.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/OVO_Modded.webp', name: 'ovo-modded.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Subway_Surfers.webp', name: 'subway-surfers.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/1v1_LOL.webp', name: '1v1-lol.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Rooftop_Snipers.webp', name: 'rooftop-snipers.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Stumble_Guys.webp', name: 'stumble-guys.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/78_Hour_Rain.webp', name: '78-hour-rain.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Buckshot_Roulette.webp', name: 'buckshot-roulette.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Burger___Frights.webp', name: 'burger-frights.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Darkness_in_Spaceship.webp', name: 'darkness-in-spaceship.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Baldis_Basics.webp', name: 'baldis-basics.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Backrooms.webp', name: 'backrooms.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Granny.webp', name: 'granny.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Happy_Wheels.webp', name: 'happy-wheels.webp' },
  { url: 'https://blog.free-dyndns.org/assets/imgs/g/Assessment_Examination.webp', name: 'assessment-exam.webp' },
  { url: 'https://imgs.crazygames.com/games/fireboy-and-watergirl-the-forest-temple/cover-1586285142530.jpg?metadata=none&quality=60&height=4906', name: 'fireboy-watergirl.jpg' },
  { url: 'https://www.coolmathgames.com/sites/default/files/PapasBurgeria_OG-logo.jpg', name: 'papas-burgeria.jpg' },
  { url: 'https://static0.polygonimages.com/wordpress/wp-content/uploads/chorus/uploads/chorus_asset/file/22416111/smb_art.jpg?w=1600&h=900&fit=crop', name: 'super-mario-art.jpg' },
  { url: 'https://imangistudios.com/wp-content/uploads/2022/01/Games_tr2_b.png', name: 'tunnel-rush.png' },
  { url: 'https://assets.nintendo.com/image/upload/c_fill,w_1200/q_auto:best/f_auto/dpr_2.0/store/software/switch/70010000020726/18a6f0955e118ae5589de02e64719e182133f5de71cc0017e93145cd938d212e', name: 'superhot.jpg' },
  { url: 'https://m.media-amazon.com/images/I/610yCrA+ZPL._AC_UF350,350_QL80_.jpg', name: 'tetris.jpg' },
  { url: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT76btQTGOYcbq_of2VE8gwxwY8xt3xaGy9Mw&s', name: 'slow-roads.jpg' },
  { url: 'https://miro.medium.com/1*Wto643yG6HgprZfAafHPdQ.jpeg', name: 'papers-please.jpeg' },
  { url: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/70/capsule_616x353.jpg?t=1745368462', name: 'half-life.jpg' },
  { url: 'https://www.gamebrew.org/thumb.php?f=SorttheCourtVita.png&width=640', name: 'sort-the-court.png' },
];
for (const g of games) {
  tasks.push({ url: g.url, dest: path.join(__dirname, 'public', 'assets', 'images', 'games') });
}

console.log(`Total download tasks: ${tasks.length}`);
console.log('Starting batch downloads...\n');

const allResults = await batchDownload(tasks, 5);

console.log('\n=== SUMMARY ===');
console.log(`Succeeded: ${successCount}`);
console.log(`Failed: ${failCount}`);
console.log(`Total: ${tasks.length}`);

// Write report
const reportPath = path.join(__dirname, 'asset-download-report.json');
const report = { timestamp: new Date().toISOString(), successCount, failCount, total: tasks.length, details: allResults };
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(`Report written to ${reportPath}`);
