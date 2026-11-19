// Visual verification screenshots for bugs 5 (map) + 8 (readability).
// Captures: title, HUD while playing, map (N), mission (M), empire (B),
// pause (ESC), phone briefing (at the M1 marker), WASTED.
// Output: /tmp/ui-shots/*.png — inspect with your own eyes before reporting.
// Run: node tools/ui-shots.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const OUT = '/tmp/ui-shots';
mkdirSync(OUT, { recursive: true });
const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policySha = createHash('sha256').update(readFileSync(POLICY_PATH)).digest('hex');

const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-dev-shm-usage',
    '--force-device-scale-factor=1', `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
    `--hatch-webgl-allowed-domains-sha256=${policySha}`],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/1-title.png` });
console.log('1-title.png');

await page.click('#start-button');
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/2-hud.png` });
console.log('2-hud.png');

// Map (N) — the bug-5 shot. Measure the canvas box too.
await page.keyboard.press('KeyN');
await page.waitForTimeout(800);
const mapBox = await page.evaluate(() => {
  const c = document.getElementById('bigmap');
  const r = c.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight, canvasW: c.width, canvasH: c.height };
});
console.log('map box:', JSON.stringify(mapBox));
await page.screenshot({ path: `${OUT}/3-map.png` });
console.log('3-map.png');
await page.keyboard.press('KeyN');
await page.waitForTimeout(400);

// Mission screen (M).
await page.keyboard.press('KeyM');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/4-missions.png` });
console.log('4-missions.png');
// 4b. Same screen with the LONGEST realistic summary staged (DOM-only layout
// check: 8/8 jobs, 100%, 12h34m played) — must stay on one line.
await page.evaluate(() => { document.querySelector('#mission-list .mission-summary').textContent = '8/8 jobs done · 100% COMPLETE · 12h 34m played · payout $13,250'; });
await page.screenshot({ path: `${OUT}/4b-missions-long.png` });
console.log('4b-missions-long.png');
await page.keyboard.press('KeyM');
await page.waitForTimeout(400);

// Empire screen (B).
await page.keyboard.press('KeyB');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/5-empire.png` });
console.log('5-empire.png');
// 5b. Longest realistic empire summary staged (maxed empire, 3 days pending).
await page.evaluate(() => { document.querySelector('#empire-list .mission-summary').textContent = '3/3 businesses · $26,325/day · $78,975 waiting · 100% COMPLETE'; });
await page.screenshot({ path: `${OUT}/5b-empire-long.png` });
console.log('5b-empire-long.png');
await page.keyboard.press('KeyB');
await page.waitForTimeout(400);

// Pause (ESC).
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/6-pause.png` });
console.log('6-pause.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// Phone briefing: teleport to the M1 marker and wait for the phone.
await page.evaluate(() => { window.__game.player.group.position.set(52, 0, 0); });
let up = false;
for (let i = 0; i < 12 && !up; i += 1) {
  await page.waitForTimeout(2000);
  up = await page.evaluate(() => !document.getElementById('phone-panel').classList.contains('hidden'));
}
console.log('briefing up:', up);
await page.screenshot({ path: `${OUT}/7-briefing.png` });
console.log('7-briefing.png');
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(400);

// WASTED: kill the player.
await page.evaluate(() => { window.__game.damagePlayer(9999); });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/8-wasted.png` });
console.log('8-wasted.png');

// Resume after WASTED (CONTINUE button) so the remaining shots can run.
await page.evaluate(() => document.getElementById('down-button')?.click());
await page.waitForTimeout(800);

// 9. Toast (achievement message)
await page.evaluate(() => window.__game.hud.showMessage('ACHIEVEMENT — FIRST WHEELS +$100', 4, true));
await page.screenshot({ path: `${OUT}/9-toast.png` });
console.log('9-toast.png');

// 10. MISSION PASSED (auto-hides after 4s — shoot immediately)
await page.evaluate(() => window.__game.hud.showPassed('MISSION PASSED', 'FIRST FARE', ['+$500 · +50 REP', 'PISTOL UNLOCKED']));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/10-passed.png` });
console.log('10-passed.png');
await page.waitForTimeout(4200);

// 11. Garage screen — the garage is DRIVE-IN only (E works only in a car
// near the spray, like the real Pay'n'Spray). Enter the starter car first,
// then move the driven car to the spray like gta-audit-test §8 does.
await page.evaluate(() => window.__game.player.group.position.set(0, 0, -8));
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(600);
await page.evaluate(() => {
  const car = window.__game.drivenCar;
  car.group.position.set(104, 0, -52);
  car.position.set(104, 0, -52);
});
await page.waitForTimeout(1200);
await page.keyboard.press('KeyE');
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/11-garage.png` });
console.log('11-garage.png');
await page.keyboard.press('Escape'); // closes garage only (no pause toggle)
await page.waitForTimeout(300);

// 12. Dialogue panel (Juno line)
await page.evaluate(() => window.__game.dialogue.say('juno', 'Night run. Pistol out, eyes open.', 5));
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/12-dialogue.png` });
console.log('12-dialogue.png');

// 14. Driving HUD (still in the car at the spray — drive, speed row visible).
// Long W hold: headless game-time runs far slower than real time under load.
await page.keyboard.down('KeyW');
await page.waitForTimeout(8000);
await page.screenshot({ path: `${OUT}/14-driving.png` });
console.log('14-driving.png');
await page.keyboard.up('KeyW');

// 15. Police panel (3 stars, panel visible)
await page.evaluate(() => window.__game.wanted.setStars(3));
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/15-police.png` });
console.log('15-police.png');
await page.evaluate(() => window.__game.wanted.setStars(0));

// 16. Night HUD (clock 22:30, dark sky)
await page.evaluate(() => window.__game.setGameMinutes(22 * 60 + 30));
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/16-night.png` });
console.log('16-night.png');

// 13. BUSTED (terminal — last)
await page.evaluate(() => window.__game.endRun('BUSTED'));
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/13-busted.png` });
console.log('13-busted.png');

// 1b. Title at 1024x720 (narrower window — simulates a wider substitute
// font: the feature line must still fit on one line, nothing clipped).
const page2 = await browser.newPage({ viewport: { width: 1024, height: 720 } });
await page2.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page2.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page2.waitForTimeout(1500);
await page2.screenshot({ path: `${OUT}/1b-title-1024.png` });
console.log('1b-title-1024.png');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : '0 console/page errors');
await browser.close();
