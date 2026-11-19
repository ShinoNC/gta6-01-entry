// Visual verification shots for the fix batch (20/11): redesigned map,
// headlight beam at night, WASTED screen, 480px HUD. Eyeball checks, not
// automated — LOOK at the PNGs after running.
// Run: node tools/visual-verify.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const SHOTS = '/home/hatch/workspace/makefun/gta6-01/bugcheck-20261119/fixbatch2-shots';
mkdirSync(SHOTS, { recursive: true });
const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policySha = createHash('sha256').update(readFileSync(POLICY_PATH)).digest('hex');

const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-dev-shm-usage',
    '--force-device-scale-factor=1', `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
    `--hatch-webgl-allowed-domains-sha256=${policySha}`],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(500);

// 1. Redesigned map (N).
await page.keyboard.press('KeyN');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${SHOTS}/map-redesign.png` });
console.log('map-redesign.png');
await page.keyboard.press('KeyN');
await page.waitForTimeout(500);

// 2. Headlight at night: drive the starter car onto the clear N-S road.
await page.evaluate(() => {
  const g = window.__game;
  g.setGameMinutes(0);
  g.weather.forceClear();
  g.player.group.position.set(2, 0, -8);
});
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const g = window.__game;
  const car = g.drivenCar;
  car.group.position.set(0, 0, -40);
  car.heading = Math.PI;
  car.group.rotation.y = Math.PI;
  car.speed = 0;
});
await page.waitForTimeout(3000); // let the camera settle behind the car
await page.screenshot({ path: `${SHOTS}/headlight-night.png` });
console.log('headlight-night.png');

// 3. WASTED screen.
await page.evaluate(() => window.__game.endRun('WASTED'));
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/wasted-screen.png` });
console.log('wasted-screen.png');

// 4. BUSTED screen.
await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => window.__game.endRun('BUSTED'));
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/busted-screen.png` });
console.log('busted-screen.png');

// 5. HUD at 480px wide (portrait phone).
const narrow = await browser.newPage({ viewport: { width: 480, height: 800 } });
await narrow.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await narrow.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await narrow.click('#start-button');
await narrow.waitForTimeout(500);
await narrow.evaluate(() => document.getElementById('phone-later')?.click());
await narrow.waitForTimeout(3000);
await narrow.screenshot({ path: `${SHOTS}/hud-480px.png` });
console.log('hud-480px.png');

console.log(`errors: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
