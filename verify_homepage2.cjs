const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  
  page.on('console', msg => {
    // Filter for notification/clock related logs
  });

  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Check state
  const state = await page.evaluate(() => {
    const clock = document.getElementById('heroClock');
    const notif = document.getElementById('heroNotifications');
    return {
      clockExists: !!clock,
      clockContent: clock ? clock.textContent : null,
      notifExists: !!notif,
      notifHTML: notif ? notif.innerHTML.substring(0, 500) : null,
      notifChildCount: notif ? notif.children.length : 0,
    };
  });

  console.log('State:', JSON.stringify(state, null, 2));

  // Dismiss intro and reveal hero
  await page.evaluate(() => {
    const intro = document.getElementById('introScreen');
    if (intro) intro.style.display = 'none';
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('reveal');
  });
  await page.waitForTimeout(500);

  // Check again
  const state2 = await page.evaluate(() => {
    const clock = document.getElementById('heroClock');
    const notif = document.getElementById('heroNotifications');
    return {
      clockContent: clock ? clock.textContent : null,
      notifHTML: notif ? notif.innerHTML.substring(0, 500) : null,
      notifChildCount: notif ? notif.children.length : 0,
    };
  });
  console.log('After dismiss:', JSON.stringify(state2, null, 2));

  await page.screenshot({ path: 'C:\\Users\\abeni\\Downloads\\orbit\\homepage.png', fullPage: true });
  console.log('Screenshot saved');

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
