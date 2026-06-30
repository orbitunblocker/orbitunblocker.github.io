import https from 'https';

function check(url) {
  return new Promise((resolve) => {
    https.get(url, {timeout: 5000, headers: {'User-Agent': 'Mozilla/5.0'}}, (res) => {
      let d='';
      res.on('data',c=>d+=c);
      res.on('end',()=>{
        console.log(url.slice(0,60) + ' -> status=' + res.statusCode + ' type=' + (res.headers['content-type']||'?') + ' size=' + d.length);
        resolve({status: res.statusCode, data: d});
      });
    }).on('error', (e) => {
      console.log(url.slice(0,60) + ' -> ERROR: ' + e.message);
      resolve({status: 0, data: ''});
    });
  });
}

async function main() {
  await check('https://pixelsuft.github.io/hl/');
  await check('https://pixelsuft.github.io/hl/halva_en_out/halva_en-2.zip');
  await check('https://pixelsuft.github.io/hl/halva_en-2.zip');
  await check('https://pixelsuft.github.io/hl/index.html');
  
  // Get HTML to find actual asset URLs
  console.log('\nFetching HTML...');
  const result = await check('https://pixelsuft.github.io/hl/');
  const html = result.data;
  
  // Find all script src, link href, and other asset URLs
  const srcMatches = html.match(/src="[^"]*"/g) || [];
  const hrefMatches = html.match(/href="[^"]*"/g) || [];
  const dataSrcMatches = html.match(/data-src="[^"]*"/g) || [];
  
  console.log('\nScripts:');
  for(const m of srcMatches) console.log('  ' + m);
  console.log('\nLinks:');
  for(const m of hrefMatches) console.log('  ' + m);
  console.log('\nData-src:');
  for(const m of dataSrcMatches) console.log('  ' + m);
  
  // Search for .zip references
  if(html.includes('.zip')) {
    console.log('\nZIP references in HTML:');
    const lines = html.split('\n');
    for(const line of lines) {
      if(line.includes('.zip')) console.log('  ' + line.trim());
    }
  } else {
    console.log('\nNo .zip references found in HTML');
  }
}

main().catch(console.error);
