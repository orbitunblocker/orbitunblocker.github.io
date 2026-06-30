const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto('http://localhost:8080/', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(3000);

  // Dismiss intro screen if present
  await page.evaluate(() => {
    const intro = document.getElementById('introScreen');
    if (intro && intro.style.display !== 'none') {
      intro.style.display = 'none';
    }
    const hero = document.getElementById('heroSection');
    if (hero) hero.classList.add('reveal');
  });
  await page.waitForTimeout(2000);

  // Check computed styles
  const styles = await page.evaluate(() => {
    const clock = document.getElementById('heroClock');
    const notif = document.getElementById('heroNotifications');
    const clockStyle = clock ? getComputedStyle(clock) : null;
    const notifStyle = notif ? getComputedStyle(notif) : null;
    const firstLine = notif ? notif.querySelector('.notif-line') : null;
    const lineStyle = firstLine ? getComputedStyle(firstLine, '::after') : null;
    return {
      clock: clockStyle ? {
        fontFamily: clockStyle.fontFamily,
        fontSize: clockStyle.fontSize,
        color: clockStyle.color,
      } : null,
      notif: notifStyle ? {
        fontFamily: notifStyle.fontFamily,
        fontWeight: notifStyle.fontWeight,
        fontSize: notifStyle.fontSize,
        color: notifStyle.color,
      } : null,
      notifContent: notif ? notif.innerText.substring(0, 200) : null,
      hasCaret: lineStyle ? lineStyle.content : null,
      notifCount: notif ? notif.querySelectorAll('.notif-line').length : 0,
    };
  });

  console.log('Clock styles:', JSON.stringify(styles.clock, null, 2));
  console.log('Notification styles:', JSON.stringify(styles.notif, null, 2));
  console.log('Notification text:', styles.notifContent);
  console.log('Notification count:', styles.notifCount);
  console.log('Caret content:', styles.hasCaret);

  await page.screenshot({ path: 'C:\\Users\\abeni\\Downloads\\orbit\\homepage.png', fullPage: true });
  console.log('Screenshot saved to homepage.png');

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
