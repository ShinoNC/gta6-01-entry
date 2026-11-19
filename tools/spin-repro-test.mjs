// Spin repro + regression test for SOLARIS KEYS (bug 1: W-only spins in
// circles when a mouse-look yawOffset is present).
//
// Theory under test: the chase camera targets heading + PI + yawOffset, and
// the walking player snaps heading to cameraYaw + PI every frame. With a
// nonzero yawOffset the camera chases a target that is always yawOffset ahead
// of itself, so it rotates at yawOffset * STIFFNESS rad/s and the player
// walks in a circle. Mouse untouched during the walk does not help: the
// offset was set by an earlier mouse-look and persists while pointer-locked.
//
// The direct simulations below call the MINIFIED game code (player.update +
// ChaseCamera.update) in a tight loop with a fake W-only input, 600 frames
// at dt=1/60 = 10s of game time. The real-input scenario then confirms the
// same behaviour through the actual keyboard/mouse path.
// Run: node tools/spin-repro-test.mjs
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

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
// Stay on the title screen: the real loop returns early there, so the direct
// simulations below are the only thing moving the player/camera.
await page.waitForTimeout(500);

// Direct simulation: W-only on foot, given a starting yawOffset.
// Returns total unwrapped camera rotation, heading rotation, path length and
// net displacement over 10s of game time.
async function simWalk(yawOffset, frames = 600, dt = 1 / 60) {
  return page.evaluate(({ yawOffset: off, frames: n, dt: step }) => {
    const g = window.__game;
    const p = g.player;
    const cam = g.chaseCamera;
    p.group.position.set(0, 0, 0);
    p.heading = Math.PI;
    p.group.rotation.y = Math.PI;
    p.jumpY = 0;
    p.jumpV = 0;
    cam.yaw = 0;
    cam.yawOffset = off;
    cam.currentPosition.set(0, 3.4, 7.5);
    const fake = {
      moveAxes: () => ({ forward: 1, strafe: 0 }),
      isDown: () => false,
      pressed: () => false,
      dragDeltaX: 0,
      dragging: false,
      locked: true, // pointer locked: offset does NOT decay (the live bug setup)
    };
    const fakeCity = { resolveCircle: () => {} }; // collision is orthogonal to the heading/yaw loop
    const wrap = (a) => {
      let w = a;
      while (w > Math.PI) w -= Math.PI * 2;
      while (w < -Math.PI) w += Math.PI * 2;
      return w;
    };
    let yawRot = 0;
    let headRot = 0;
    let path = 0;
    let prevYaw = cam.yaw;
    let prevHead = p.heading;
    let prevX = 0;
    let prevZ = 0;
    let minX = 0;
    let maxX = 0;
    let minZ = 0;
    let maxZ = 0;
    for (let i = 0; i < n; i += 1) {
      p.update(step, fake, cam.yaw, fakeCity);
      cam.update(step, p.position, p.heading, false, fake, 0, 0);
      yawRot += Math.abs(wrap(cam.yaw - prevYaw));
      headRot += Math.abs(wrap(p.heading - prevHead));
      prevYaw = cam.yaw;
      prevHead = p.heading;
      const { x, z } = p.position;
      path += Math.hypot(x - prevX, z - prevZ);
      prevX = x;
      prevZ = z;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const disp = Math.hypot(p.position.x, p.position.z);
    return {
      yawRot, headRot, path, disp,
      endX: p.position.x, endZ: p.position.z,
      endYaw: cam.yaw, endHeading: p.heading, endOffset: cam.yawOffset,
      boxW: maxX - minX, boxD: maxZ - minZ,
    };
  }, { yawOffset, frames, dt });
}

// --- Sim A: W-only, no mouse-look offset (control) ---
const a = await simWalk(0);
info('sim A W-only yawOffset=0', `yawRot=${a.yawRot.toFixed(2)} headRot=${a.headRot.toFixed(2)} path=${a.path.toFixed(1)}m disp=${a.disp.toFixed(1)}m end=(${a.endX.toFixed(1)},${a.endZ.toFixed(1)})`);
check('A: W-only, no offset — camera does not rotate', a.yawRot < 0.1, `yawRot=${a.yawRot.toFixed(2)} rad`);
check('A: W-only, no offset — player walks straight', a.disp > 40 && a.path / Math.max(0.1, a.disp) < 1.2, `path=${a.path.toFixed(1)}m disp=${a.disp.toFixed(1)}m`);

// --- Sim B: W-only, max mouse-look offset (the reported bug) ---
const b = await simWalk(1.2);
info('sim B W-only yawOffset=1.2', `yawRot=${b.yawRot.toFixed(2)} headRot=${b.headRot.toFixed(2)} path=${b.path.toFixed(1)}m disp=${b.disp.toFixed(1)}m end=(${b.endX.toFixed(1)},${b.endZ.toFixed(1)}) box=${b.boxW.toFixed(1)}x${b.boxD.toFixed(1)}m`);
check('B: W-only, offset 1.2 — camera does not spin', b.yawRot < 2.0, `yawRot=${b.yawRot.toFixed(2)} rad over 10s`);
check('B: W-only, offset 1.2 — player walks away, not in circles', b.disp > 20, `disp=${b.disp.toFixed(1)}m path=${b.path.toFixed(1)}m`);

// --- Sim C: W-only, moderate offset ---
const c = await simWalk(0.5);
info('sim C W-only yawOffset=0.5', `yawRot=${c.yawRot.toFixed(2)} headRot=${c.headRot.toFixed(2)} path=${c.path.toFixed(1)}m disp=${c.disp.toFixed(1)}m`);
check('C: W-only, offset 0.5 — camera does not spin', c.yawRot < 2.0, `yawRot=${c.yawRot.toFixed(2)} rad over 10s`);
check('C: W-only, offset 0.5 — player walks away, not in circles', c.disp > 20, `disp=${c.disp.toFixed(1)}m path=${c.path.toFixed(1)}m`);

// --- Sim D: W-only at low FPS (dt capped at 0.05) with offset ---
const d = await simWalk(1.2, 200, 0.05);
info('sim D W-only yawOffset=1.2 dt=0.05', `yawRot=${d.yawRot.toFixed(2)} path=${d.path.toFixed(1)}m disp=${d.disp.toFixed(1)}m`);
check('D: low FPS, offset 1.2 — camera does not spin', d.yawRot < 2.0, `yawRot=${d.yawRot.toFixed(2)} rad over 10s`);

// --- Sim E: driving W-only with offset (car heading does not snap — expect no spin) ---
const e = await page.evaluate(() => {
  const g = window.__game;
  const car = g.cars[0];
  const cam = g.chaseCamera;
  car.group.position.set(0, 0, -8);
  car.heading = Math.PI;
  car.group.rotation.y = Math.PI;
  car.speed = 0;
  car.steerAngle = 0;
  cam.yaw = 0;
  cam.yawOffset = 1.2;
  cam.currentPosition.set(0, 3.2, -0.5);
  const fake = {
    moveAxes: () => ({ forward: 1, strafe: 0 }),
    isDown: () => false,
    pressed: () => false,
    dragDeltaX: 0,
    dragging: false,
    locked: true,
  };
  const wrap = (a) => {
    let w = a;
    while (w > Math.PI) w -= Math.PI * 2;
    while (w < -Math.PI) w += Math.PI * 2;
    return w;
  };
  let yawRot = 0;
  let headRot = 0;
  let prevYaw = cam.yaw;
  let prevHead = car.heading;
  const fakeCity = { resolveCircle: () => {} };
  for (let i = 0; i < 600; i += 1) {
    car.update(1 / 60, fake, fakeCity, 1);
    cam.update(1 / 60, car.position, car.heading, true, fake, 0, 0);
    yawRot += Math.abs(wrap(cam.yaw - prevYaw));
    headRot += Math.abs(wrap(car.heading - prevHead));
    prevYaw = cam.yaw;
    prevHead = car.heading;
  }
  return { yawRot, headRot, endX: car.position.x, endZ: car.position.z, speed: car.speed };
});
info('sim E drive W-only yawOffset=1.2', `yawRot=${e.yawRot.toFixed(2)} headRot=${e.headRot.toFixed(2)} end=(${e.endX.toFixed(1)},${e.endZ.toFixed(1)}) speed=${e.speed.toFixed(1)}`);
check('E: driving W-only, offset 1.2 — car does not spin', e.headRot < 0.5, `headRot=${e.headRot.toFixed(2)} rad`);
check('E: driving W-only, offset 1.2 — car drives away', Math.hypot(e.endX, e.endZ + 8) > 50, `end=(${e.endX.toFixed(1)},${e.endZ.toFixed(1)})`);

// --- Real input: start the game, lock the pointer, mouse-look, then hold W ---
await page.click('#start-button');
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);
await page.mouse.click(640, 360); // engage pointer lock
await page.waitForTimeout(500);
const locked = await page.evaluate(() => window.__game.input.locked === true);
info('real input: pointer locked', String(locked));
// Mouse-look to build a yawOffset (like a real player glancing around).
await page.mouse.move(940, 360);
await page.waitForTimeout(800);
const offBefore = await page.evaluate(() => window.__game.chaseCamera.yawOffset);
info('real input: yawOffset after mouse-look', offBefore.toFixed(2));
const start = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z, yaw: window.__game.chaseCamera.yaw }));
await page.keyboard.down('KeyW');
let yawRot = 0;
let prevYaw = start.yaw;
let path = 0;
let prevX = start.x;
let prevZ = start.z;
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(250);
  const s = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z, yaw: window.__game.chaseCamera.yaw }));
  const wrap = (a) => {
    let w = a;
    while (w > Math.PI) w -= Math.PI * 2;
    while (w < -Math.PI) w += Math.PI * 2;
    return w;
  };
  yawRot += Math.abs(wrap(s.yaw - prevYaw));
  prevYaw = s.yaw;
  path += Math.hypot(s.x - prevX, s.z - prevZ);
  prevX = s.x;
  prevZ = s.z;
}
await page.keyboard.up('KeyW');
const end = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z }));
const disp = Math.hypot(end.x - start.x, end.z - start.z);
info('real input: W 10s after mouse-look', `yawRot=${yawRot.toFixed(2)} path=${path.toFixed(1)}m disp=${disp.toFixed(1)}m offsetWas=${offBefore.toFixed(2)}`);
check('real input: W after mouse-look — camera does not spin', yawRot < 2.0, `yawRot=${yawRot.toFixed(2)} rad`);
check('real input: W after mouse-look — player makes progress', disp > 2 || path < 3, `disp=${disp.toFixed(1)}m path=${path.toFixed(1)}m (headless is slow; path>>disp means circling)`);

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const fails = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
