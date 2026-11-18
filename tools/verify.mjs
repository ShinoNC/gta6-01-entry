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

// ---- Phase B: traffic, pedestrians, wanted, police, missions, combat ----
// Headless Chrome runs ~2-5 fps and game dt caps at 0.05s, so game time
// runs several times slower than real time; waits below account for that.

const trafficBefore = await page.evaluate(() => ({
  x: window.__game.traffic.cars[0].car.position.x,
  z: window.__game.traffic.cars[0].car.position.z,
}));
await page.waitForTimeout(4000);
const trafficAfter = await page.evaluate(() => ({
  x: window.__game.traffic.cars[0].car.position.x,
  z: window.__game.traffic.cars[0].car.position.z,
}));
const trafficMoved = Math.hypot(trafficAfter.x - trafficBefore.x, trafficAfter.z - trafficBefore.z);
check('traffic cars drive on roads', trafficMoved > 1, `moved ${trafficMoved.toFixed(1)}m`);
check('traffic count is 10', await page.evaluate(() => window.__game.traffic.cars.length === 10));

check('pedestrians wander sidewalks', await page.evaluate(() => window.__game.pedestrians.peds.length >= 15));
const fleeing = await page.evaluate(() => {
  const p = window.__game.player.position;
  // Put one walker beside the player first: the city is big and the crowd
  // is spread thin, so a scare at a random spot may find nobody in range.
  window.__game.pedestrians.peds[0].mesh.group.position.set(p.x + 2, 0, p.z + 2);
  window.__game.pedestrians.scareFrom(p.x, p.z, 30);
  return window.__game.pedestrians.fleeingCount;
});
check('pedestrians flee from a scare', fleeing > 0, `${fleeing} fleeing`);

// Mission 1: the fixer calls shortly after the game starts.
await page.waitForSelector('#phone-panel:not(.hidden)', { timeout: 45000 });
await page.click('#phone-accept');
await page.waitForTimeout(500);
check('mission 1 briefing accepted', await page.evaluate(() => document.getElementById('hud-mission').textContent.includes('MISSION 1/8')));
await page.evaluate(() => {
  const target = window.__game.missions.target;
  window.__game.player.group.position.set(target.x, 0, target.z);
});
await page.waitForTimeout(4000);
check(
  'mission 1 completable, pays $400',
  await page.evaluate(() => window.__game.missions.doneCount() === 1 && window.__game.money === 1650),
  await page.evaluate(() => `done=${window.__game.missions.doneCount()} money=$${window.__game.money}`),
);

// Mission list screen (M), dismissing the next briefing first if it popped.
if (await page.evaluate(() => !document.getElementById('phone-panel').classList.contains('hidden'))) {
  await page.click('#phone-later');
  await page.waitForTimeout(300);
}
await page.keyboard.press('KeyM');
await page.waitForTimeout(500);
check(
  'M opens the mission list',
  await page.evaluate(() => {
    const screen = document.getElementById('mission-screen');
    return !screen.classList.contains('hidden') && screen.textContent.includes('FIRST FARE') && screen.textContent.includes('[DONE]');
  }),
);
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);
check('M closes the mission list', await page.evaluate(() => document.getElementById('mission-screen').classList.contains('hidden')));

// Stealing a parked car (not the starter) raises the wanted level.
await page.evaluate(() => {
  const car = window.__game.cars[3];
  window.__game.player.group.position.set(car.position.x + 2, 0, car.position.z);
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(500);
check('stealing a parked car gives 1 star', await page.evaluate(() => window.__game.wanted.stars >= 1));
check('steal toast shows', await page.evaluate(() => document.getElementById('hud-message').textContent.includes('STOLEN')));

// Police spawn and pursue.
await page.waitForTimeout(5000);
const policeUnits = await page.evaluate(() => window.__game.police.units(window.__game.player.position).length);
check('police units respond to wanted level', policeUnits >= 1, `${policeUnits} unit(s)`);
check('police panel visible', await page.evaluate(() => !document.getElementById('hud-police').classList.contains('hidden')));
const policeDistanceBefore = await page.evaluate(() => {
  const units = window.__game.police.units(window.__game.player.position);
  return units.length ? Math.min(...units.map((u) => u.distanceMetres)) : -1;
});
await page.waitForTimeout(4000);
const policeDistanceAfter = await page.evaluate(() => {
  const units = window.__game.police.units(window.__game.player.position);
  return units.length ? Math.min(...units.map((u) => u.distanceMetres)) : -1;
});
check(
  'police close in on the player',
  policeDistanceBefore > 0 && policeDistanceAfter >= 0 && policeDistanceAfter < policeDistanceBefore - 3,
  `nearest unit ${policeDistanceBefore}m -> ${policeDistanceAfter}m`,
);

// 3 stars brings the helicopter and a roadblock.
await page.evaluate(() => window.__game.wanted.setStars(3));
await page.waitForTimeout(4000);
check(
  'helicopter + roadblock at 3 stars',
  await page.evaluate(() => {
    const units = window.__game.police.units(window.__game.player.position);
    return window.__game.police.helicopter !== null && window.__game.police.roadblock.length === 2 && units.some((u) => u.status === 'SPOTLIGHT');
  }),
);

// Hiding out of police sight sheds a star: preload the hide timer, then
// teleport far from every unit and let the real update path finish it.
await page.keyboard.press('KeyF');
await page.waitForTimeout(300);
await page.evaluate(() => {
  window.__game.wanted.setStars(1);
  window.__game.wanted.hiddenSeconds = 7.5;
  window.__game.player.group.position.set(-150, 0, -150);
});
await page.waitForTimeout(8000);
check('wanted level falls while hidden', await page.evaluate(() => window.__game.wanted.stars === 0));

// Combat: pistol shot spends ammo and raises the wanted level.
await page.keyboard.press('Digit2');
await page.waitForTimeout(300);
await page.keyboard.press('Space');
await page.waitForTimeout(1000);
check(
  'shooting spends pistol ammo',
  await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag === 11),
  await page.evaluate(() => `mag=${window.__game.combat.ammoForHud()[1].mag}`),
);
check('shooting raises wanted', await page.evaluate(() => window.__game.wanted.stars >= 1));
await page.keyboard.press('Digit3');
await page.waitForTimeout(300);
check('SMG locked before mission 3', await page.evaluate(() => document.getElementById('hud-message').textContent.includes('locked')));

// Radio switches stations.
await page.keyboard.press('KeyR');
await page.waitForTimeout(500);
check('R switches radio station', await page.evaluate(() => document.getElementById('hud-radio').textContent.includes('RADIO SOL 101.9')));

// Save/load round-trips through the exposed save helpers.
check(
  'save/load round-trip',
  await page.evaluate(() => {
    window.__game.save.saveGame(1, { money: 9999, rep: 5, missionsDone: 3, weaponsOwned: ['fists', 'pistol'], playerX: 10, playerZ: 20 });
    const loaded = window.__game.save.loadGame(1);
    const snapshot = window.__game.snapshotSave();
    window.__game.save.saveGame(2, snapshot);
    const loadedSnapshot = window.__game.save.loadGame(2);
    return loaded && loaded.money === 9999 && loaded.missionsDone === 3 && loadedSnapshot && loadedSnapshot.missionsDone === 1;
  }),
);

check('zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ') : '');
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
