import https from 'https';
const url = 'https://minecrafteaglercraft.gitlab.io/go/minecraft-1.5.2/';
https.get(url, r => {
  let d = '';
  r.on('data', c => d += c);
  r.on('end', () => {
    console.log('Length:', d.length);
    const srcs = d.match(/src="([^"]+)"/g) || [];
    for (const x of srcs) console.log(x);
    console.log('---LAST 1500---');
    console.log(d.slice(-1500));
  });
});
