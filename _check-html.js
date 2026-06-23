const https = require('https');
https.get('https://minecrafteaglercraft.gitlab.io/go/minecraft-1.5.2/', res => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => {
    console.log('Full HTML length:', d.length);
    const srcs = d.match(/src="([^"]+)"/g) || [];
    const hrefs = d.match(/href="([^"]+)"/g) || [];
    console.log('Scripts:');
    for (const s of srcs) console.log('  ' + s);
    console.log('Links:');
    for (const h of hrefs) console.log('  ' + h);
    // Also print the middle/end of the HTML
    console.log('\nHTML end (last 2000 chars):');
    console.log(d.slice(-2000));
  });
}).on('error', e => console.error(e));
