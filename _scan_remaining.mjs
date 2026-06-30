import fs from 'fs';

const files = ['index.html', 'js/app.js', 'js/browser-engine.js', 'js/proxy-engine.js', 'css/styles.css', 'css/orbit.css'];

// Check for ANY remaining http/https URL that looks like an image
const urlPattern = /https?:\/\/[^\s"'`]+\.(png|jpg|jpeg|gif|svg|webp|ico)(\?[^\s"'`]*)?/gi;

let found = 0;
for (const file of files) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip data:image and blob: URLs
      if (line.includes('data:image') || line.includes('blob:')) continue;
      const matches = [...line.matchAll(urlPattern)];
      for (const m of matches) {
        // Skip google.com/s2/favicons (dynamic bookmark favicon service)
        if (m[0].includes('google.com/s2/favicons')) continue;
        console.log(`${file}:${i + 1} - ${m[0]}`);
        found++;
      }
    }
  } catch(e) {}
}

// Also check for CSS background URLs
const bgPattern = /background(?:-image)?\s*:\s*url\(['"]?(https?:\/\/[^'")]+)['"]?\)/gi;
for (const file of files) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const matches = [...line.matchAll(bgPattern)];
      for (const m of matches) {
        console.log(`${file}:${i + 1} (CSS BG) - ${m[1]}`);
        found++;
      }
    }
  } catch(e) {}
}

if (found === 0) {
  console.log('No remaining external image URLs found.');
} else {
  console.log(`\n${found} external image URLs still need migration.`);
}
