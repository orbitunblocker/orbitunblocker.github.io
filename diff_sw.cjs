const fs = require('fs');
const orig = fs.readFileSync('sw.js.orig.git', 'utf8').split('\n');
const curr = fs.readFileSync('sw.js', 'utf8').split('\n');

// Find differences
const maxLines = Math.max(orig.length, curr.length);
let inDiff = false;
for (let i = 0; i < maxLines; i++) {
  const o = i < orig.length ? orig[i] : null;
  const c = i < curr.length ? curr[i] : null;
  if (o !== c) {
    if (!inDiff) {
      console.log(`\n--- Difference at line ${i+1} ---`);
      inDiff = true;
    }
    if (o !== null) console.log(`  ORIG[${i+1}]: ${o.substring(0, 150)}`);
    if (c !== null) console.log(`  CURR[${i+1}]: ${c.substring(0, 150)}`);
    if (o === null) console.log(`  CURR[${i+1}]: ${c.substring(0, 150)} (ADDED)`);
    if (c === null) console.log(`  ORIG[${i+1}]: ${o.substring(0, 150)} (REMOVED)`);
  } else {
    inDiff = false;
  }
}
