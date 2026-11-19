// Controls test for SOLARIS KEYS: tank controls (A/D turn, camera behind),
// click-only shooting, jump, handbrake, HUD bars next to the minimap.
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
const wrap = (a) => {
  let w = a;
  while (w > Math.PI) w -= Math.PI * 2;
  while (w < -Math.PI) w += Math.PI * 2;
  return w;
};

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);

// --- 1. No pointer lock: a canvas click never locks, and the mouse does
// not rotate the camera ---
await page.mouse.click(640, 360);
await page.waitForTimeout(500);
check('canvas click does not engage pointer lock', await page.evaluate(() => document.pointerLockElement === null));
const yawBeforeMouse = await page.evaluate(() => window.__game.chaseCamera.yaw);
await page.mouse.move(840, 360);
await page.mouse.move(340, 360);
await page.waitForTimeout(800);
const yawAfterMouse = await page.evaluate(() => window.__game.chaseCamera.yaw);
check('mouse move does not rotate the camera', Math.abs(yawAfterMouse - yawBeforeMouse) < 0.05, `yaw ${yawBeforeMouse.toFixed(2)} -> ${yawAfterMouse.toFixed(2)}`);

// --- 2. A/D turn the player in place (tank controls); the camera follows
// behind the heading ---
const headBefore = await page.evaluate(() => window.__game.player.heading);
const posBeforeTurn = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z }));
await page.keyboard.down('KeyD');
await page.waitForTimeout(4000);
await page.keyboard.up('KeyD');
const headAfterD = await page.evaluate(() => window.__game.player.heading);
const posAfterTurn = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z }));
const turned = wrap(headAfterD - headBefore);
check('D turns the player right in place (heading decreases, no displacement)', turned < -0.3 && Math.hypot(posAfterTurn.x - posBeforeTurn.x, posAfterTurn.z - posBeforeTurn.z) < 0.5, `heading ${headBefore.toFixed(2)} -> ${headAfterD.toFixed(2)} (Δ ${turned.toFixed(2)}) moved ${Math.hypot(posAfterTurn.x - posBeforeTurn.x, posAfterTurn.z - posBeforeTurn.z).toFixed(2)}m`);
// The camera chases heading+PI: after settling, yaw - (heading+PI) ~ 0.
await page.waitForTimeout(3000);
const camTrack = await page.evaluate(() => ({ yaw: window.__game.chaseCamera.yaw, heading: window.__game.player.heading }));
const trackErr = Math.abs(wrap(camTrack.yaw - (camTrack.heading + Math.PI)));
check('camera sits behind the heading after turning', trackErr < 0.3, `yaw=${camTrack.yaw.toFixed(2)} heading+PI=${(camTrack.heading + Math.PI).toFixed(2)} err=${trackErr.toFixed(2)}`);

// --- 3. The first click fires the pistol (no lock click to swallow it) ---
await page.evaluate(() => {
  window.__game.combat.unlockWeapon('pistol');
  window.__game.combat.restock();
});
await page.keyboard.press('Digit2');
await page.waitForTimeout(300);
const magBefore = await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag);
await page.mouse.click(640, 360);
await page.waitForTimeout(800);
const magAfterShot = await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag);
check('first click fires the pistol', magAfterShot === magBefore - 1, `mag ${magBefore} -> ${magAfterShot}`);

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
// Poll for the car entry, RETRYING the press: a fixed 500ms wait is too
// short when a headless frame stalls, and a single press is lost entirely
// if the player is knocked down (downTimer > 0) at that moment — the
// pistol shot in section 3 draws a pursuit car that may ram the player
// while they stand at spawn. Each retry re-presses F until the car is
// entered (F toggles, so the loop breaks as soon as it succeeds).
let entered = false;
let lastState = '';
for (let i = 0; i < 10 && !entered; i += 1) {
  if (i > 0) await page.keyboard.press('KeyF');
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => ({
    driven: window.__game.drivenCar !== null,
    state: window.__game.state,
    down: +window.__game.player.downTimer.toFixed(2),
    stars: window.__game.wanted.stars,
  }));
  entered = st.driven;
  lastState = `state=${st.state} downTimer=${st.down} stars=${st.stars}`;
}
check('F enters the starter car', entered, lastState);
if (!entered) { await browser.close(); process.exit(1); }
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

// --- 9. Screens open and close; there is no pointer lock to exit ---
await page.keyboard.press('KeyM');
await page.waitForTimeout(400);
check(
  'mission screen opens (no lock involved)',
  (await page.evaluate(() => document.pointerLockElement === null)) && (await page.evaluate(() => !document.getElementById('mission-screen').classList.contains('hidden'))),
);
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);
check('closing mission screen returns to play', await page.evaluate(() => window.__game.state === 'play'));
await page.keyboard.press('KeyB');
await page.waitForTimeout(400);
check(
  'empire screen opens (no lock involved)',
  (await page.evaluate(() => document.pointerLockElement === null)) && (await page.evaluate(() => !document.getElementById('empire-screen').classList.contains('hidden'))),
);
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);

// --- 10. Phone briefing appears at the gold marker ---
// The briefing now needs the player at the gold marker (52,0); the player is
// driving here, so move the car (the mission focus) to the marker.
await page.evaluate(() => {
  const car = window.__game.drivenCar;
  if (car) { car.position.set(52, 0, 0); car.speed = 0; }
  else window.__game.player.group.position.set(52, 0, 0);
  window.__game.missions.snooze = 0;
});
let phoneVisible = false;
for (let i = 0; i < 10 && !phoneVisible; i += 1) {
  await page.waitForTimeout(1000);
  phoneVisible = await page.evaluate(() => !document.getElementById('phone-panel').classList.contains('hidden'));
}
check('phone briefing appears at the marker', phoneVisible, `phone visible=${phoneVisible}`);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);

// --- 11. Esc pauses; Esc resumes; the game stays playable ---
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('Esc pauses the game', await page.evaluate(() => window.__game.state === 'pause'), `state=${await page.evaluate(() => window.__game.state)}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
check('Esc again returns to play', await page.evaluate(() => window.__game.state === 'play'));

check('zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ').slice(0, 400) : '');

const fails = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
