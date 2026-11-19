// Controls test for SOLARIS KEYS: pointer lock, jump, handbrake, click-only
// shooting, HUD bars next to the minimap, screens exiting pointer lock.
// Run: node tools/controls-test.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
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
  console.log(results[results.length - 1]);
}
const isLocked = () => page.evaluate(() => document.pointerLockElement === document.getElementById('game-canvas'));
const unlock = () => page.evaluate(() => document.exitPointerLock && document.exitPointerLock());

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);

// --- 1. Pointer lock engages on canvas click ---
await page.mouse.click(640, 360);
await page.waitForTimeout(500);
check('canvas click engages pointer lock', await isLocked());
check('input.locked tracks the lock', await page.evaluate(() => window.__game.input.locked === true));

// --- 2. Mouse move while locked rotates the camera (free look, no button held) ---
const yawBefore = await page.evaluate(() => window.__game.chaseCamera.yawOffset);
await page.mouse.move(840, 360);
await page.waitForTimeout(800);
const yawAfter = await page.evaluate(() => window.__game.chaseCamera.yawOffset);
check('mouse move while locked swings the camera', yawAfter > yawBefore + 0.2, `yawOffset ${yawBefore.toFixed(2)} -> ${yawAfter.toFixed(2)}`);

// --- 3. The lock click is not a shot; the next click shoots ---
await page.evaluate(() => {
  window.__game.combat.unlockWeapon('pistol');
  window.__game.combat.restock();
});
await page.keyboard.press('Digit2');
await page.waitForTimeout(300);
await unlock();
await page.waitForTimeout(400);
const magBefore = await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag);
await page.mouse.click(640, 360); // lock click — must NOT shoot
await page.waitForTimeout(800);
const magAfterLockClick = await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag);
check('lock click does not fire', magAfterLockClick === magBefore, `mag ${magBefore} -> ${magAfterLockClick}`);
await page.mouse.click(640, 360); // real shot
await page.waitForTimeout(800);
const magAfterShot = await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag);
check('click while locked fires the pistol', magAfterShot === magBefore - 1, `mag ${magBefore} -> ${magAfterShot}`);

// --- 4. Space no longer shoots; Space jumps on foot ---
const magBeforeSpace = await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag);
await page.keyboard.press('Space');
await page.waitForTimeout(300);
let maxY = 0;
for (let i = 0; i < 12; i += 1) {
  const y = await page.evaluate(() => window.__game.player.group.position.y);
  if (y > maxY) maxY = y;
  await page.waitForTimeout(200);
}
check('Space does not fire the pistol', await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag) === magBeforeSpace);
check('Space jumps: player leaves the ground', maxY > 0.5, `max y=${maxY.toFixed(2)}`);
await page.waitForTimeout(2000);
check(
  'player lands back on the ground',
  await page.evaluate(() => window.__game.player.group.position.y < 0.1 && window.__game.player.jumpY === 0),
  await page.evaluate(() => `y=${window.__game.player.group.position.y.toFixed(2)} jumpY=${window.__game.player.jumpY}`),
);

// --- 5. Jump while running ---
await page.keyboard.down('KeyW');
await page.keyboard.press('Space');
await page.waitForTimeout(600);
const runJumpY = await page.evaluate(() => window.__game.player.group.position.y);
await page.keyboard.up('KeyW');
check('jump works while running', runJumpY > 0.3, `y=${runJumpY.toFixed(2)}`);
await page.waitForTimeout(2000);

// --- 6. Handbrake stops much faster than coasting (measured on the open beach,
// far from traffic and buildings so nothing else can slow the car) ---
await page.evaluate(() => {
  const car = window.__game.cars[0];
  window.__game.player.group.position.set(car.position.x + 2, 0, car.position.z);
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(500);
await page.evaluate(() => {
  const car = window.__game.drivenCar;
  car.group.position.set(0, 0, 80);
  car.heading = Math.PI / 2;
  car.group.rotation.y = Math.PI / 2;
  car.speed = 30;
});
await page.keyboard.down('Space');
await page.waitForTimeout(5000);
await page.keyboard.up('Space');
const brakeSpeed = await page.evaluate(() => window.__game.drivenCar.speed);
await page.evaluate(() => {
  const car = window.__game.drivenCar;
  car.group.position.set(0, 0, 80);
  car.heading = Math.PI / 2;
  car.group.rotation.y = Math.PI / 2;
  car.speed = 30;
});
await page.waitForTimeout(5000);
const coastSpeed = await page.evaluate(() => window.__game.drivenCar.speed);
check(
  'handbrake (Space) stops far faster than coasting',
  brakeSpeed < coastSpeed * 0.8 && brakeSpeed < 18,
  `brake -> ${brakeSpeed.toFixed(1)} m/s, coast -> ${coastSpeed.toFixed(1)} m/s`,
);

// --- 6b. Traffic passing in the next lane does not slow the car ---
await page.evaluate(() => {
  const g = window.__game;
  const car = g.drivenCar;
  car.group.position.set(0, 0, -20);
  car.heading = Math.PI;
  car.group.rotation.y = Math.PI;
  car.speed = 30;
  // One NPC beside the player in the next lane; the rest parked at far edges.
  const npc = g.traffic.cars[0];
  npc.line = g.traffic.lines.find((l) => l.axis === 'z' && l.at === 0);
  npc.direction = -1;
  npc.along = -20;
  npc.cruiseSpeed = 10;
  g.traffic.placeOnRoad(npc);
  g.traffic.cars.forEach((n, i) => {
    if (i === 0) return;
    n.along = n.line.from;
    g.traffic.placeOnRoad(n);
  });
});
await page.waitForTimeout(3000);
const passSpeed = await page.evaluate(() => window.__game.drivenCar.speed);
check(
  'passing traffic in the next lane does not kill speed',
  passSpeed > 20,
  `speed ${passSpeed.toFixed(1)} m/s after the pass`,
);

// --- 7. Handbrake + steering slides the car (active drift) ---
await page.evaluate(() => {
  const car = window.__game.drivenCar;
  car.group.position.set(0, 0, 80);
  car.heading = Math.PI / 2;
  car.group.rotation.y = Math.PI / 2;
  car.speed = 30;
});
await page.keyboard.down('Space');
await page.keyboard.down('KeyD');
let skidded = false;
for (let i = 0; i < 16; i += 1) {
  skidded = await page.evaluate(() => window.__game.drivenCar.skidding);
  if (skidded) break;
  await page.waitForTimeout(300);
}
await page.keyboard.up('Space');
await page.keyboard.up('KeyD');
check('handbrake + steer makes the car skid', skidded);

// --- 8. Health/armour bars sit next to the minimap (GTA V style) ---
const barsRect = await page.evaluate(() => {
  const bars = document.getElementById('hud-bars').getBoundingClientRect();
  const map = document.getElementById('hud-minimap').getBoundingClientRect();
  return { barsLeft: bars.left, barsBottom: bars.bottom, mapTop: map.top, mapLeft: map.left };
});
check(
  'bars are left-aligned above the minimap',
  barsRect.barsLeft < 40 && barsRect.barsBottom <= barsRect.mapTop + 10,
  `bars left=${barsRect.barsLeft} bottom=${barsRect.barsBottom} minimap top=${barsRect.mapTop}`,
);

// --- 9. Opening a screen exits pointer lock (mouse free for UI) ---
await page.mouse.click(640, 360);
await page.waitForTimeout(400);
check('re-locked before screen test', await isLocked());
await page.keyboard.press('KeyM');
await page.waitForTimeout(400);
check(
  'mission screen exits pointer lock',
  (await isLocked()) === false && (await page.evaluate(() => !document.getElementById('mission-screen').classList.contains('hidden'))),
);
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);
await page.mouse.click(640, 360);
await page.waitForTimeout(400);
check('re-locked after closing mission screen', await isLocked());
await page.keyboard.press('KeyB');
await page.waitForTimeout(400);
check(
  'empire screen exits pointer lock',
  (await isLocked()) === false && (await page.evaluate(() => !document.getElementById('empire-screen').classList.contains('hidden'))),
);
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);

// --- 10. Phone briefing exits pointer lock ---
await page.mouse.click(640, 360);
await page.waitForTimeout(400);
await page.evaluate(() => { window.__game.missions.snooze = 0; });
await page.waitForTimeout(1500);
const phoneVisible = await page.evaluate(() => !document.getElementById('phone-panel').classList.contains('hidden'));
check(
  'phone briefing exits pointer lock',
  phoneVisible && (await isLocked()) === false,
  `phone visible=${phoneVisible} locked=${await isLocked()}`,
);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);

// --- 11. No pointer lock API: no crash, drag-to-look fallback still works ---
await page.evaluate(() => {
  const canvas = document.getElementById('game-canvas');
  Object.defineProperty(canvas, 'requestPointerLock', { value: undefined, configurable: true });
});
await page.mouse.click(640, 360);
await page.waitForTimeout(400);
check('click with no pointer-lock API does not lock (and does not crash)', (await isLocked()) === false);
const yawBeforeDrag = await page.evaluate(() => window.__game.chaseCamera.yawOffset);
await page.mouse.move(640, 360);
await page.mouse.down();
await page.mouse.move(840, 360, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
const yawAfterDrag = await page.evaluate(() => window.__game.chaseCamera.yawOffset);
check('drag-to-look fallback still rotates the camera', Math.abs(yawAfterDrag - yawBeforeDrag) > 0.1, `yawOffset ${yawBeforeDrag.toFixed(2)} -> ${yawAfterDrag.toFixed(2)}`);
await page.evaluate(() => {
  delete document.getElementById('game-canvas').requestPointerLock;
});

// --- 12. Esc exits the lock; the game stays playable ---
await page.mouse.click(640, 360);
await page.waitForTimeout(400);
check('locked before Esc test', await isLocked());
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
const afterEsc = await page.evaluate(() => ({ locked: document.pointerLockElement !== null, state: window.__game.state }));
check('Esc exits pointer lock', afterEsc.locked === false, `locked=${afterEsc.locked} state=${afterEsc.state}`);
if (afterEsc.state === 'pause') {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}
check('game returns to play after Esc handling', await page.evaluate(() => window.__game.state === 'play'));

check('zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ').slice(0, 400) : '');

const fails = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
