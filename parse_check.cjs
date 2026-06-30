const fs = require('fs');

// Check original sw.js before modifications
fs.writeFileSync('sw.js.orig', fs.readFileSync('sw.js', 'utf8'));

// Stash current changes
const { execSync } = require('child_process');
execSync('git stash', { stdio: 'pipe' });

// Read the original
const origCode = fs.readFileSync('sw.js', 'utf8');
console.log(`Original sw.js: ${origCode.length} bytes`);

try {
  const stripped = origCode.replace(/importScripts\(.+?\);/g, '// removed import');
  new Function(stripped);
  console.log('ORIGINAL PARSE OK');
} catch(e) {
  console.log('ORIGINAL PARSE ERROR:', e.message);
}

// Restore changes
execSync('git stash pop', { stdio: 'pipe' });

// Now check the current (modified) version
const currentCode = fs.readFileSync('sw.js', 'utf8');
console.log(`\nCurrent sw.js: ${currentCode.length} bytes`);

try {
  const stripped = currentCode.replace(/importScripts\(.+?\);/g, '// removed import');
  new Function(stripped);
  console.log('CURRENT PARSE OK');
} catch(e) {
  console.log('CURRENT PARSE ERROR:', e.message);
  
  // Find the error location by binary search
  const stripped2 = currentCode.replace(/importScripts\(.+?\);/g, '// removed import');
  const lines = stripped2.split('\n');
  for (let i = 0; i < lines.length; i++) {
    try {
      new Function(lines.slice(0, i+1).join('\n'));
    } catch(e2) {
      console.log(`  Error at line ${i+1}: "${lines[i].substring(0, 120)}"`);
      console.log(`  ${e2.message}`);
      break;
    }
  }
}
