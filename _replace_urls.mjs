import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ==============================
// URL REPLACEMENT MAP
// ==============================
const replacements = [
  // === LOGO GIF ===
  { file: 'index.html', from: 'https://i.ibb.co/xS3pNYjB/tet-ezgif-com-effects-1.gif', to: '/assets/images/logos/tet-ezgif-com-effects-1.gif' },

  // === SEARCH ENGINE ICONS (browser-engine.js) ===
  { file: 'js/browser-engine.js', from: 'https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=http://google.com&size=256', to: '/assets/images/icons/google-favicon.png' },
  { file: 'js/browser-engine.js', from: 'https://www.bing.com/favicon.ico', to: '/assets/images/icons/bing.ico' },
  { file: 'js/browser-engine.js', from: 'https://duckduckgo.com/favicon.ico', to: '/assets/images/icons/duckduckgo.ico' },
  { file: 'js/browser-engine.js', from: 'https://4get.ca/favicon.ico', to: '/assets/images/icons/4get.ico' },

  // === QUICK-LINK IMAGES (browser-engine.js) ===
  { file: 'js/browser-engine.js', from: 'https://i.ytimg.com/vi/s-KZu1kru8Y/sddefault.jpg', to: '/assets/images/quicklinks/sddefault.jpg' },
  { file: 'js/browser-engine.js', from: 'https://freshonthenet.co.uk/wp-content/uploads/2020/10/Twitch-Logo.jpg', to: '/assets/images/quicklinks/Twitch-Logo.jpg' },
  { file: 'js/browser-engine.js', from: 'https://www.musicweek.com/cimages/f38efa877c6c7b446c02ae1e89ac44d3.jpg', to: '/assets/images/quicklinks/soundcloud.jpg' },
  { file: 'js/browser-engine.js', from: 'https://www.scdn.co/i/_global/open-graph-default.png', to: '/assets/images/quicklinks/open-graph-default.png' },
  { file: 'js/browser-engine.js', from: 'https://www.internetmatters.org/wp-content/uploads/2025/06/Chat-GPT-logo.webp', to: '/assets/images/quicklinks/Chat-GPT-logo.webp' },
  { file: 'js/browser-engine.js', from: 'https://gamemakerstoolkit.com/wp-content/uploads/2024/01/perk-discord.jpg', to: '/assets/images/quicklinks/perk-discord.jpg' },
  { file: 'js/browser-engine.js', from: 'https://blog.kubesimplify.com/img/blog/git-and-github-a-beginners-guide/q3I5kJ5U9.jpeg', to: '/assets/images/quicklinks/github.jpeg' },
  { file: 'js/browser-engine.js', from: 'https://variety.com/wp-content/uploads/2021/06/TikTok-Jump.png?w=970&h=545&crop=1', to: '/assets/images/quicklinks/TikTok-Jump.png' },
  { file: 'js/browser-engine.js', from: 'https://media.wired.com/photos/592681ffcfe0d93c47430739/3:2/w_2560%2Cc_limit/Netflix-Logo-Print_CMYK2.jpg', to: '/assets/images/quicklinks/Netflix-Logo-Print_CMYK2.jpg' },
  { file: 'js/browser-engine.js', from: 'https://espnpressroom.com/us/files/2021/06/0-ESPN-Logo-for-PressRoom-780x470.jpg', to: '/assets/images/quicklinks/0-ESPN-Logo-for-PressRoom-780x470.jpg' },

  // === GAME THUMBNAIL VARIABLES (app.js) ===
  { file: 'js/app.js', from: 'https://outred.org/g/assets/cookie-clicker/cookie1.jpeg', to: '/assets/images/games/cookie1.jpeg' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/basketball-stars/assets/images/basketball-stars.png', to: '/assets/images/games/basketball-stars.png' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/cluster-rush/splash.png', to: '/assets/images/games/splash.png' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/drift-hunters/drift-hunters.png', to: '/assets/images/games/drift-hunters.png' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/ducklife1/ducklife.png', to: '/assets/images/games/ducklife.png' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/minecraft-15/splash.jpeg', to: '/assets/images/games/splash.jpeg' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/elasticman/elasticman.jpg', to: '/assets/images/games/elasticman.jpg' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/flappy-bird/assets/thumb.png', to: '/assets/images/games/thumb.png' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/fruitninja/FruitNinjaTeaser.jpg', to: '/assets/images/games/FruitNinjaTeaser.jpg' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/ducklife2/ducklife2.png', to: '/assets/images/games/ducklife2.png' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/motox3m/splash.jpg', to: '/assets/images/games/splash.jpg' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/paperio2/images/icon512.png', to: '/assets/images/games/icon512.png' },
  { file: 'js/app.js', from: 'https://outred.org/g/assets/snowbattle/img/logo.png', to: '/assets/images/games/logo.png' },

  // === GAME THUMBNAILS - blog.free-dyndns.org ===
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Slope.webp', to: '/assets/images/games/Slope.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Eaglercraft_v1_8.webp', to: '/assets/images/games/Eaglercraft_v1_8.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/FNAF_1__Scratch_.webp', to: '/assets/images/games/FNAF_1__Scratch_.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/FNAF_2.webp', to: '/assets/images/games/FNAF_2.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/FNAF_3.webp', to: '/assets/images/games/FNAF_3.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/FNAF_4__Scratch_.webp', to: '/assets/images/games/FNAF_4__Scratch_.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Basketball_Stars.webp', to: '/assets/images/games/Basketball_Stars.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Drift_Boss.webp', to: '/assets/images/games/Drift_Boss.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Mario_Kart_64.webp', to: '/assets/images/games/Mario_Kart_64.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Cookie_Clicker.webp', to: '/assets/images/games/Cookie_Clicker.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Super_Mario_64.webp', to: '/assets/images/games/Super_Mario_64.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Drift_Hunters.webp', to: '/assets/images/games/Drift_Hunters.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Retro_Bowl.webp', to: '/assets/images/games/Retro_Bowl.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/OVO_Modded.webp', to: '/assets/images/games/OVO_Modded.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Subway_Surfers.webp', to: '/assets/images/games/Subway_Surfers.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/1v1_LOL.webp', to: '/assets/images/games/1v1_LOL.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Rooftop_Snipers.webp', to: '/assets/images/games/Rooftop_Snipers.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Stumble_Guys.webp', to: '/assets/images/games/Stumble_Guys.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/78_Hour_Rain.webp', to: '/assets/images/games/78_Hour_Rain.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Buckshot_Roulette.webp', to: '/assets/images/games/Buckshot_Roulette.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Burger___Frights.webp', to: '/assets/images/games/Burger___Frights.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Darkness_in_Spaceship.webp', to: '/assets/images/games/Darkness_in_Spaceship.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Baldis_Basics.webp', to: '/assets/images/games/Baldis_Basics.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Backrooms.webp', to: '/assets/images/games/Backrooms.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Granny.webp', to: '/assets/images/games/Granny.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Happy_Wheels.webp', to: '/assets/images/games/Happy_Wheels.webp' },
  { file: 'js/app.js', from: 'https://blog.free-dyndns.org/assets/imgs/g/Assessment_Examination.webp', to: '/assets/images/games/Assessment_Examination.webp' },

  // === GAME THUMBNAILS - miscellaneous ===
  { file: 'js/app.js', from: 'https://imgs.crazygames.com/games/fireboy-and-watergirl-the-forest-temple/cover-1586285142530.jpg?metadata=none&quality=60&height=4906', to: '/assets/images/games/cover-1586285142530.jpg' },
  { file: 'js/app.js', from: 'https://www.coolmathgames.com/sites/default/files/PapasBurgeria_OG-logo.jpg', to: '/assets/images/games/PapasBurgeria_OG-logo.jpg' },
  { file: 'js/app.js', from: 'https://static0.polygonimages.com/wordpress/wp-content/uploads/chorus/uploads/chorus_asset/file/22416111/smb_art.jpg?w=1600&h=900&fit=crop', to: '/assets/images/games/smb_art.jpg' },
  { file: 'js/app.js', from: 'https://imangistudios.com/wp-content/uploads/2022/01/Games_tr2_b.png', to: '/assets/images/games/Games_tr2_b.png' },
  { file: 'js/app.js', from: 'https://assets.nintendo.com/image/upload/c_fill,w_1200/q_auto:best/f_auto/dpr_2.0/store/software/switch/70010000020726/18a6f0955e118ae5589de02e64719e182133f5de71cc0017e93145cd938d212e', to: '/assets/images/games/superhot.jpg' },
  { file: 'js/app.js', from: 'https://m.media-amazon.com/images/I/610yCrA+ZPL._AC_UF350,350_QL80_.jpg', to: '/assets/images/games/610yCrA+ZPL._AC_UF350,350_QL80_.jpg' },
  { file: 'js/app.js', from: 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcT76btQTGOYcbq_of2VE8gwxwY8xt3xaGy9Mw&s', to: '/assets/images/games/slow-roads.jpg' },
  { file: 'js/app.js', from: 'https://miro.medium.com/1*Wto643yG6HgprZfAafHPdQ.jpeg', to: '/assets/images/games/papers-please.jpg' },
  { file: 'js/app.js', from: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/70/capsule_616x353.jpg?t=1745368462', to: '/assets/images/games/capsule_616x353.jpg' },
  { file: 'js/app.js', from: 'https://www.gamebrew.org/thumb.php?f=SorttheCourtVita.png&width=640', to: '/assets/images/games/sort-the-court.png' },

  // === Doom 2 thumbnail (also nintendo) ===
  { file: 'js/app.js', from: 'https://assets.nintendo.com/image/upload/c_fill,w_1200/q_auto:best/f_auto/dpr_2.0/store/software/switch/70010000018925/1892afd16e56eaedb6a3d73ef6d936c4f24e3f40bd17a541d360c1a47e564f83', to: '/assets/images/games/doom2.jpg' },

  // === SERVICE/CLOAK ICONS (app.js) ===
  { file: 'js/app.js', from: 'https://www.google.com/favicon.ico', to: '/assets/images/icons/google.ico' },
  { file: 'js/app.js', from: 'https://ssl.gstatic.com/classroom/favicon.png', to: '/assets/images/icons/favicon.png' },
  { file: 'js/app.js', from: 'https://docs.google.com/favicon.ico', to: '/assets/images/icons/google-drive.ico' },
  { file: 'js/app.js', from: 'https://ssl.gstatic.com/docs/documents/images/kix-favicon-2023q4.ico', to: '/assets/images/icons/kix-favicon-2023q4.ico' },

  // === THEME PREVIEW IMAGES (app.js) ===
  { file: 'js/app.js', from: 'https://i.ibb.co/jPTZkZpS/image.png', to: '/assets/images/themes/snow.png' },
  { file: 'js/app.js', from: 'https://i.ibb.co/zVMnb70D/image-2026-06-11-231050971.png', to: '/assets/images/themes/sunset.png' },
  { file: 'js/app.js', from: 'https://i.ibb.co/M58hgr0F/image.png', to: '/assets/images/themes/grape.png' },
  { file: 'js/app.js', from: 'https://i.ibb.co/d0r4nWsH/image.png', to: '/assets/images/themes/dracula.png' },
  { file: 'js/app.js', from: 'https://i.ibb.co/Z6nz0QKB/image-2026-06-11-231237791.png', to: '/assets/images/themes/ocean.png' },
  { file: 'js/app.js', from: 'https://i.ibb.co/dwb0Nn2T/image.png', to: '/assets/images/themes/forest.png' },
  { file: 'js/app.js', from: 'https://i.ibb.co/dwRrjsWK/image-2026-06-11-231356311.png', to: '/assets/images/themes/lavender.png' },
  { file: 'js/app.js', from: 'https://i.ibb.co/wZVbmXKf/image.png', to: '/assets/images/themes/amber.png' },
  { file: 'js/app.js', from: 'https://i.ibb.co/jZQbLB7v/image.png', to: '/assets/images/themes/rose.png' },

  // === PLACEHOLDER example URL (app.js) ===
  { file: 'js/app.js', from: 'https://example.com/favicon.ico', to: '/assets/images/icons/google.ico' },
];

// ==============================
// APPLY REPLACEMENTS
// ==============================
const filesToWrite = {};

for (const r of replacements) {
  const filePath = path.join(__dirname, r.file);
  if (!filesToWrite[filePath]) {
    filesToWrite[filePath] = fs.readFileSync(filePath, 'utf8');
  }
    const original = filesToWrite[filePath];
    const beforeCount = (original.match(new RegExp(r.from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    const newContent = original.split(r.from).join(r.to);
    if (beforeCount === 0) {
      console.log(`  MISS: ${r.from.substring(0, 60)}...`);
    } else {
      console.log(`  OK (${beforeCount}x): ${r.from.substring(0, 60)}...`);
    }
  filesToWrite[filePath] = newContent;
}

// Write changed files
for (const [filePath, content] of Object.entries(filesToWrite)) {
  fs.writeFileSync(filePath, content, 'utf8');
}

console.log('\nDone! Files updated.');
