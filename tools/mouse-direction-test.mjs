// Tank-controls test for VICE ROYALE (mouse-look deleted 20/11: A/D turn in
// place, W walks the facing direction, camera always behind the heading,
// click attacks immediately). Verifies EMPIRICALLY through real keyboard
// and mouse input, plus one end-to-end click-to-shoot check.
// Run: node tools/mouse-direction-test.mjs
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
function info(name, detail = '') {
  console.log(`INFO ${name}${detail ? ` — ${detail}` : ''}`);
}
const wrap = (a) => {
  let w = a;
  while (w > Math.PI) w -= Math.PI * 2;
  while (w < -Math.PI) w += Math.PI * 2;
  return w;
};

const viewState = () => page.evaluate(() => {
  const g = window.__game;
  const p = g.player.position;
  const c = g.camera.position;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    viewX: dx / len, viewZ: dz / len,
    x: p.x, z: p.z, heading: g.player.heading,
    yaw: g.chaseCamera.yaw, hasOffset: 'yawOffset' in g.chaseCamera,
  };
});
// Headless runs at ~0.15x game speed, so the chase yaw lags real time.
// Poll until the camera yaw has settled behind the heading AND the camera
// position has swung around too (the view direction follows the position
// lerp, which trails the yaw).
async function waitForCameraSettle(maxMs = 30000) {
  const t0 = Date.now();
  for (;;) {
    const s = await viewState();
    const facingX = Math.sin(s.heading);
    const facingZ = Math.cos(s.heading);
    const yawOk = Math.abs(wrap(s.yaw - (s.heading + Math.PI))) < 0.15;
    const viewOk = Math.abs(s.viewX - facingX) < 0.2 && Math.abs(s.viewZ - facingZ) < 0.2;
    if ((yawOk && viewOk) || Date.now() - t0 > maxMs) return s;
    await page.waitForTimeout(500);
  }
}
// Hold a key until the heading is within `tol` of `target` (or timeout).
async function turnTo(key, target, tol = 0.2, maxMs = 40000) {
  await page.keyboard.down(key);
  const t0 = Date.now();
  let s;
  for (;;) {
    s = await viewState();
    if (Math.abs(wrap(s.heading - target)) < tol || Date.now() - t0 > maxMs) break;
    await page.waitForTimeout(400);
  }
  await page.keyboard.up(key);
  return s;
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);
check('no mouse-look state left (chaseCamera has no yawOffset)',
  (await viewState()).hasOffset === false);

// --- Baseline: standing still, camera behind, view faces -Z (north) ---
const base = await waitForCameraSettle();
info('baseline', `heading=${base.heading.toFixed(2)} yaw=${base.yaw.toFixed(2)} view=(${base.viewX.toFixed(2)},${base.viewZ.toFixed(2)})`);
check('baseline view faces -Z (north)', base.viewZ < -0.8 && Math.abs(base.viewX) < 0.3, `view=(${base.viewX.toFixed(2)},${base.viewZ.toFixed(2)})`);
check('baseline camera sits behind the heading', Math.abs(wrap(base.yaw - (base.heading + Math.PI))) < 0.2, `yawErr=${Math.abs(wrap(base.yaw - (base.heading + Math.PI))).toFixed(2)}`);

// --- D turns right (heading decreases), standing still ---
// The KEY property is the direction: holding D must decrease the heading.
// The exact PI/2 target is arbitrary and unreachable at headless speed
// (the turn needs 0.63s of game-time; at run-2 slowness that is ~100s real),
// so poll for a clear directional turn, then set the heading directly for
// the camera/view geometry checks below (spin-repro already validates the
// heading/yaw loop deterministically).
const headBeforeD = (await viewState()).heading;
await page.keyboard.down('KeyD');
let afterD = await viewState();
const dT0 = Date.now();
while (Date.now() - dT0 < 60000) {
  afterD = await viewState();
  if (wrap(afterD.heading - headBeforeD) < -0.4) break;
  await page.waitForTimeout(500);
}
await page.keyboard.up('KeyD');
info('after holding D', `heading=${afterD.heading.toFixed(2)} pos=(${afterD.x.toFixed(1)},${afterD.z.toFixed(1)})`);
check('D turns the player right (heading decreases)', wrap(afterD.heading - headBeforeD) < -0.3, `heading=${afterD.heading.toFixed(2)} (Δ ${wrap(afterD.heading - headBeforeD).toFixed(2)})`);
check('turning in place does not move the player', Math.hypot(afterD.x - base.x, afterD.z - base.z) < 0.5, `moved=${Math.hypot(afterD.x - base.x, afterD.z - base.z).toFixed(2)}m`);
await page.evaluate(() => {
  const g = window.__game;
  g.player.heading = Math.PI / 2;
  g.player.group.rotation.y = Math.PI / 2;
});
const settledD = await waitForCameraSettle();
check('camera follows behind after the turn', Math.abs(wrap(settledD.yaw - (settledD.heading + Math.PI))) < 0.2);
check('view follows the facing direction (east)', settledD.viewX > 0.8 && Math.abs(settledD.viewZ) < 0.4, `view=(${settledD.viewX.toFixed(2)},${settledD.viewZ.toFixed(2)})`);

// --- A turns left (heading increases) ---
const headBeforeA = (await viewState()).heading;
await page.keyboard.down('KeyA');
let afterA = await viewState();
const aT0 = Date.now();
while (Date.now() - aT0 < 60000) {
  afterA = await viewState();
  if (wrap(afterA.heading - headBeforeA) > 0.4) break;
  await page.waitForTimeout(500);
}
await page.keyboard.up('KeyA');
info('after holding A', `heading=${afterA.heading.toFixed(2)}`);
check('A turns the player left (heading increases)', wrap(afterA.heading - headBeforeA) > 0.3, `heading=${afterA.heading.toFixed(2)} (Δ ${wrap(afterA.heading - headBeforeA).toFixed(2)})`);

// --- W walks the facing direction (north from spawn) ---
await page.evaluate(() => {
  const g = window.__game;
  g.player.group.position.set(0, 0, 0);
  g.player.heading = Math.PI;
  g.player.group.rotation.y = Math.PI;
});
await page.waitForTimeout(300);
const walkStart = await viewState();
await page.keyboard.down('KeyW');
// Poll until the walk covers real ground: a fixed 6s hold is ~0.3s of
// headless game-time in the 12x12 city (barely 1m). 2.5m is enough to
// prove the direction.
const walkT0 = Date.now();
let walkEnd = await viewState();
for (;;) {
  walkEnd = await viewState();
  if (Math.hypot(walkEnd.x - walkStart.x, walkEnd.z - walkStart.z) > 2.5 || Date.now() - walkT0 > 30000) break;
  await page.waitForTimeout(500);
}
await page.keyboard.up('KeyW');
const walkDx = walkEnd.x - walkStart.x;
const walkDz = walkEnd.z - walkStart.z;
info('W walk', `from (0,0) to (${walkEnd.x.toFixed(1)},${walkEnd.z.toFixed(1)}) heading=${walkEnd.heading.toFixed(2)}`);
check('W walks the facing direction (north, -Z)', walkDz < -2 && Math.abs(walkDx) < 1.5, `moved=(${walkDx.toFixed(1)},${walkDz.toFixed(1)})`);

// --- Mouse does nothing: wild moves + drag change neither heading nor yaw ---
const beforeMouse = await viewState();
await page.mouse.move(640, 360);
await page.mouse.move(1240, 100, { steps: 10 });
await page.mouse.move(40, 600, { steps: 10 });
await page.mouse.down();
await page.mouse.move(900, 200, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(800);
const afterMouse = await viewState();
check('mouse movement does not turn the player',
  Math.abs(wrap(afterMouse.heading - beforeMouse.heading)) < 0.05, `dHeading=${wrap(afterMouse.heading - beforeMouse.heading).toFixed(3)}`);
check('mouse movement does not move the camera',
  Math.abs(wrap(afterMouse.yaw - beforeMouse.yaw)) < 0.05, `dYaw=${wrap(afterMouse.yaw - beforeMouse.yaw).toFixed(3)}`);
check('no pointer lock is ever engaged', await page.evaluate(() => document.pointerLockElement === null));

// --- Click shoots the facing direction: turn east, click, car takes damage ---
const lane = await page.evaluate(() => {
  const g = window.__game;
  const boxes = g.hud.city.buildingBoxes;
  const inside = (x, z) => boxes.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  for (let z = -120; z <= 120; z += 4) {
    if (inside(0, z) || inside(35, z)) continue;
    const blocked = boxes.some((b) => b.minX < 35 && b.maxX > 0 && b.minZ < z + 1 && b.maxZ > z - 1);
    if (!blocked) return z;
  }
  return null;
});
check('found a clear east-west firing lane', lane !== null, `z=${lane}`);
if (lane !== null) {
  // The heading is set directly to east in the evaluate below (the turn
  // itself is covered by the D/A sections above); the property under test
  // here is that the click shoots the facing direction.
  await page.evaluate((z) => {
    const g = window.__game;
    g.player.group.position.set(0, 0, z);
    g.player.heading = Math.PI / 2;
    g.player.group.rotation.y = Math.PI / 2;
    const target = g.cars.find((c) => c.name !== 'SUNSET COUPE' && !c.destroyed);
    for (const c of g.cars) if (c !== target) c.group.position.set(500, 0, 500);
    target.group.position.set(35, 0, z);
    target.hp = 100;
    g.combat.setOwnedWeapons(['fists', 'pistol']);
    g.combat.selectWeapon(1);
    g.combat.restock();
    g.combat.cooldownTimer = 0;
    window.__shootTarget = target;
  }, lane);
  let hpAfter = 100;
  for (let attempt = 0; attempt < 5 && hpAfter === 100; attempt += 1) {
    await page.mouse.click(640, 360);
    await page.waitForTimeout(3000); // pistol cooldown in game time
    hpAfter = await page.evaluate(() => window.__shootTarget.hp);
  }
  info('click-to-shoot east', `target hp 100 -> ${hpAfter}`);
  check('click shoots the facing direction (car east takes 12 damage)', hpAfter === 88, `hp=${hpAfter}`);
}

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const fails = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
