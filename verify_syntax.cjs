const fs = require('fs');

const css = fs.readFileSync('css/orbit.css', 'utf8');
const js = fs.readFileSync('js/app.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');

const checks = { pass: 0, fail: 0 };

function check(name, ok) {
  console.log((ok ? '  +' : '  -') + ' ' + name);
  if (ok) checks.pass++; else checks.fail++;
}

console.log('=== CSS ===');
check('no hero-notifications in fade-in selector', css.includes('.hero-logo,\n.hero-clock {'));
check('no hero.reveal .hero-notifications', !css.includes('.hero.reveal .hero-notifications'));
check('Bai Jamjuree in clock', css.includes("Bai Jamjuree"));
check('64px in clock', css.includes('font-size: 64px'));
check('#FFFFFF in clock', css.includes('color: #FFFFFF'));
check('Encode Sans in notifs', css.includes("Encode Sans"));
check('21px in notifs', css.includes('font-size: 21px'));
check('300 weight in notifs', css.includes('font-weight: 300'));
check('notif-line class', css.includes('.notif-line'));
check('caretBlink keyframes', css.includes('@keyframes caretBlink'));
check('no nc- classes', !css.includes('.nc-'));
check('no redFill', !css.includes('redFill'));
check('no ncFadeIn', !css.includes('ncFadeIn'));

console.log('\n=== JS ===');
check('no notifExpanded', !js.includes('notifExpanded'));
check('no equipCards', !js.includes('equipCards'));
check('no getCollapsedMaxHeight', !js.includes('getCollapsedMaxHeight'));
check('no toggleNotifCenter', !js.includes('toggleNotifCenter'));
check('no nc-card class', !js.includes('nc-card'));
check('no nc-dismiss class', !js.includes('nc-dismiss'));
check('no nc-expand-btn', !js.includes('nc-expand-btn'));
check('no dismissHoldTimer', !js.includes('dismissHoldTimer'));
check('has notif-line', js.includes('notif-line'));
check('has createNotificationCard', js.includes('function createNotificationCard'));
check('has addNotification', js.includes('function addNotification'));
check('has dismissNotification', js.includes('function dismissNotification'));
check('initNotifications simplified', js.includes('function initNotifications') && !js.includes('getCollapsedMaxHeight'));
check('goHome simplified', js.includes('heroNotifs.innerHTML = renderNotifications()'));
check('defaultNotifications preserved', js.includes('defaultNotifications'));

console.log('\n=== HTML ===');
check('Bai Jamjuree in font URL', html.includes('Bai+Jamjuree'));
check('Encode Sans in font URL', html.includes('Encode+Sans'));

console.log(`\nResult: ${checks.pass} pass, ${checks.fail} fail`);
process.exit(checks.fail > 0 ? 1 : 0);
