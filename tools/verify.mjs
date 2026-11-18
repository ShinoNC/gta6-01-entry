// Functional check for SOLARIS KEYS phase A: loads the game in headless
// Chrome, starts it, walks, enters the starter car with F, drives it, exits,
// and reports zero console errors. Run: node tools/verify.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = dirname(dirname(fileURLToPath(import.meta.url)));
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

const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.waitForTimeout(500);
check('game loads, title state', await page.evaluate(() => window.__game.state === 'title'));

await page.click('#start-button');
await page.waitForTimeout(300);
check('START begins play', await page.evaluate(() => window.__game.state === 'play'));

const posBefore = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z }));
await page.keyboard.down('KeyW');
await page.waitForTimeout(6000);
await page.keyboard.up('KeyW');
const posAfter = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z }));
const walked = Math.hypot(posAfter.x - posBefore.x, posAfter.z - posBefore.z);
check('player walks with W', walked > 3, `moved ${walked.toFixed(1)}m`);

// Step the player beside the starter car, then press F to enter it.
await page.evaluate(() => {
  const car = window.__game.cars[0];
  window.__game.player.group.position.set(car.position.x + 2, 0, car.position.z);
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(300);
check('F enters the car', await page.evaluate(() => window.__game.drivenCar !== null));

const carBefore = await page.evaluate(() => ({ x: window.__game.drivenCar.position.x, z: window.__game.drivenCar.position.z }));
const camBefore = await page.evaluate(() => {
  const c = document.querySelector('#game-canvas');
  return c ? 'canvas-ok' : 'no-canvas';
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(8000);
await page.keyboard.up('KeyW');
const carState = await page.evaluate(() => ({
  x: window.__game.drivenCar.position.x,
  z: window.__game.drivenCar.position.z,
  speed: window.__game.drivenCar.speed,
}));
const driven = Math.hypot(carState.x - carBefore.x, carState.z - carBefore.z);
check('car drives with W', driven > 5 && Math.abs(carState.speed) > 5, `moved ${driven.toFixed(1)}m, speed ${(Math.abs(carState.speed) * 3.6).toFixed(0)} km/h`);
check('speedometer shows speed', await page.evaluate(() => Number(document.getElementById('hud-speed').textContent) > 0));
check('minimap drawn', await page.evaluate(() => {
  const ctx = document.getElementById('minimap').getContext('2d');
  const data = ctx.getImageData(0, 0, 168, 168).data;
  let nonEmpty = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 0) nonEmpty += 1;
  return nonEmpty > 1000;
}));
void camBefore;

await page.keyboard.press('KeyF');
await page.waitForTimeout(300);
check('F exits the car', await page.evaluate(() => window.__game.drivenCar === null && window.__game.player.group.visible === true));

await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('ESC pauses', await page.evaluate(() => window.__game.state === 'pause'));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check('ESC resumes', await page.evaluate(() => window.__game.state === 'play'));

check('zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ') : '');
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
