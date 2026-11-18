// Functional check for SOLARIS KEYS (phases A-C): loads the game in headless
// Chrome and plays it through the normal path — title screen + options,
// walk, enter the starter car with F, drive it (skid smoke fires), exit,
// pause, traffic, pedestrians, wanted, police, missions, combat, radio,
// ammo crates, save/load — then loads the chase shot in a second page and
// checks the helicopter is in frame. Reports zero console errors.
// Run: node tools/verify.mjs
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
check(
  'title screen has NEW GAME + OPTIONS',
  await page.evaluate(() => {
    const start = document.getElementById('start-button');
    const options = document.getElementById('options-button');
    return start.textContent === 'NEW GAME' && !options.classList.contains('hidden') && document.getElementById('title-skyline') !== null;
  }),
);
await page.click('#options-button');
await page.waitForTimeout(300);
check('OPTIONS opens the options screen', await page.evaluate(() => !document.getElementById('options-screen').classList.contains('hidden')));
await page.click('#sound-toggle');
await page.waitForTimeout(200);
check('sound toggle flips to OFF', await page.evaluate(() => document.getElementById('sound-toggle').textContent === 'SOUND: OFF'));
await page.click('#sound-toggle');
await page.click('#options-back');
await page.waitForTimeout(300);
check('BACK returns to the title screen', await page.evaluate(() => !document.getElementById('title-screen').classList.contains('hidden')));

await page.click('#start-button');
await page.waitForTimeout(300);
check('NEW GAME begins play', await page.evaluate(() => window.__game.state === 'play'));

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

// Hard steering at speed throws skid smoke (or impact sparks on a wall):
// either way the shared particle pool must have live particles.
await page.keyboard.down('KeyW');
await page.keyboard.down('KeyD');
await page.waitForTimeout(6000);
await page.keyboard.up('KeyD');
await page.keyboard.up('KeyW');
check(
  'skid smoke / impact sparks fire while driving hard',
  await page.evaluate(() => window.__game.effects.activeCount > 0),
  await page.evaluate(() => `${window.__game.effects.activeCount} live particles`),
);
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
  'mission 1 completable, pays $500',
  await page.evaluate(() => window.__game.missions.doneCount() === 1 && window.__game.money === 1750),
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
check(
  'mission list shows total story payout',
  await page.evaluate(() => document.getElementById('mission-list').textContent.includes('total story payout $13,250')),
);
check(
  'mission-list CLOSE button is inside the 720p viewport',
  await page.evaluate(() => {
    const rect = document.getElementById('mission-close-button').getBoundingClientRect();
    return rect.bottom <= 720 && rect.top >= 0;
  }),
  await page.evaluate(() => {
    const rect = document.getElementById('mission-close-button').getBoundingClientRect();
    return `button bottom at ${Math.round(rect.bottom)}px`;
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
// 12s window: pursuit cars follow the road network, so they may first drive
// to an intersection (Euclidean distance briefly rises) before turning toward
// the player. 4s was too short to see the approach.
await page.waitForTimeout(12000);
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

// Ammo crate: walk into the Marina crate and the pistol refills to a full mag.
await page.evaluate(() => window.__game.player.group.position.set(26, 0, 26));
await page.waitForTimeout(2000);
check(
  'ammo crate restocks the pistol',
  await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag === 12),
  await page.evaluate(() => `mag=${window.__game.combat.ammoForHud()[1].mag}`),
);

// Radio switches stations and the HUD names the track now playing.
await page.keyboard.press('KeyR');
await page.waitForTimeout(500);
check('R switches radio station', await page.evaluate(() => document.getElementById('hud-radio').textContent.includes('RADIO SOL 101.9')));
check(
  'HUD radio line names the track',
  await page.evaluate(() => document.getElementById('hud-radio').textContent.includes('—')),
  await page.evaluate(() => document.getElementById('hud-radio').textContent),
);

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
check(
  'corrupt save loads as empty, not a crash',
  await page.evaluate(() => {
    localStorage.setItem('solaris-keys-save-3', '{"money":"not-a-number","version":99}');
    return window.__game.save.loadGame(3) === null;
  }),
);

// ---- Chase shot: helicopter in frame, 3 stars, full police panel ----
const chasePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
chasePage.on('pageerror', (e) => errors.push(`CHASE PAGEERROR: ${e.message}`));
chasePage.on('console', (m) => { if (m.type() === 'error') errors.push(`CHASE CONSOLE: ${m.text()}`); });
await chasePage.goto(`file://${ENTRY}/game/index.html?shot=chase&seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await chasePage.waitForFunction(() => window.__shotReady === true, null, { timeout: 120000 });
await chasePage.waitForTimeout(500);
const heliScreen = await chasePage.evaluate(() => window.__game.heliOnScreen());
check(
  'helicopter in frame in the chase shot',
  heliScreen !== null && !heliScreen.behind && Math.abs(heliScreen.x) < 0.95 && Math.abs(heliScreen.y) < 0.95,
  heliScreen ? `screen x=${heliScreen.x.toFixed(2)} y=${heliScreen.y.toFixed(2)}` : 'no helicopter',
);
check(
  'chase shot shows 3 stars + mission 6/8 + Juno dialogue, no banner',
  await chasePage.evaluate(() => {
    const stars = document.getElementById('hud-stars').textContent;
    const mission = document.getElementById('hud-mission').textContent;
    const dialogue = document.getElementById('dialogue-panel');
    const message = document.getElementById('hud-message').textContent;
    return stars === '★★★☆☆' && mission.includes('MISSION 6/8') && !dialogue.classList.contains('hidden') && !message.includes('VEHICLE STOLEN');
  }),
  await chasePage.evaluate(() => `${document.getElementById('hud-stars').textContent} | ${document.getElementById('hud-mission').textContent} | ${document.getElementById('hud-message').textContent}`),
);
check(
  'chase shot police panel lists 7 units incl. helicopter',
  await chasePage.evaluate(() => {
    const rows = document.querySelectorAll('#hud-police .police-row');
    return rows.length >= 7 && document.getElementById('hud-police').textContent.includes('SPOTLIGHT');
  }),
  await chasePage.evaluate(() => `${document.querySelectorAll('#hud-police .police-row').length} rows`),
);

check('zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ') : '');
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
