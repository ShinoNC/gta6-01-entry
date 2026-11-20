// No-spin regression test for VICE ROYALE (mouse-look deleted 20/11: the
// yawOffset feedback loop that used to spin W-only walks is gone by design
// — the camera always chases heading + PI and the player never snaps
// heading to the camera).
//
// The direct simulations below call the MINIFIED game code (player.update +
// ChaseCamera.update) in a tight loop with fake input, 600 frames at
// dt=1/60 = 10s of game time. The real-input scenario then confirms the
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

// Direct simulation: fake input with fixed forward/strafe, player on foot.
// Returns total unwrapped camera/heading rotation, path length and net
// displacement, plus the final camera-behind-heading error (after extra
// settle frames with no input, so a lagging camera can catch up).
async function simWalk(forward, strafe, frames = 600, dt = 1 / 60) {
  return page.evaluate(({ fwd, str, frames: n, dt: step }) => {
    const g = window.__game;
    const p = g.player;
    const cam = g.chaseCamera;
    p.group.position.set(0, 0, 0);
    p.heading = Math.PI;
    p.group.rotation.y = Math.PI;
    p.jumpY = 0;
    p.jumpV = 0;
    cam.yaw = 0;
    cam.currentPosition.set(0, 3.4, 7.5);
    const fake = {
      moveAxes: () => ({ forward: fwd, strafe: str }),
      isDown: () => false,
      pressed: () => false,
    };
    const fakeCity = {
      resolveCircle: () => {},
      waterDepthAt: () => 0, // dry land: no wading/swimming in the spin sim
      shoreOutward: () => ({ x: 0, z: 1 }),
    }; // collision is orthogonal to the heading/yaw loop
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
    for (let i = 0; i < n; i += 1) {
      p.update(step, fake, fakeCity);
      cam.update(step, p.position, p.heading, false, 0, 0);
      yawRot += Math.abs(wrap(cam.yaw - prevYaw));
      headRot += Math.abs(wrap(p.heading - prevHead));
      prevYaw = cam.yaw;
      prevHead = p.heading;
      const { x, z } = p.position;
      path += Math.hypot(x - prevX, z - prevZ);
      prevX = x;
      prevZ = z;
    }
    // Settle: no input, camera catches up to the final heading.
    const idle = { moveAxes: () => ({ forward: 0, strafe: 0 }), isDown: () => false, pressed: () => false };
    for (let i = 0; i < 120; i += 1) {
      p.update(step, idle, fakeCity);
      cam.update(step, p.position, p.heading, false, 0, 0);
    }
    const disp = Math.hypot(p.position.x, p.position.z);
    return {
      yawRot, headRot, path, disp,
      endX: p.position.x, endZ: p.position.z,
      endYaw: cam.yaw, endHeading: p.heading,
      yawErr: Math.abs(wrap(cam.yaw - (p.heading + Math.PI))),
    };
  }, { fwd: forward, str: strafe, frames, dt });
}

// --- Sim A: W-only (control) — straight line, camera still ---
const a = await simWalk(1, 0);
info('sim A W-only', `yawRot=${a.yawRot.toFixed(2)} headRot=${a.headRot.toFixed(2)} path=${a.path.toFixed(1)}m disp=${a.disp.toFixed(1)}m end=(${a.endX.toFixed(1)},${a.endZ.toFixed(1)}) yawErr=${a.yawErr.toFixed(2)}`);
check('A: W-only — camera does not rotate', a.yawRot < 0.1, `yawRot=${a.yawRot.toFixed(2)} rad`);
check('A: W-only — player walks straight', a.disp > 40 && a.path / Math.max(0.1, a.disp) < 1.2, `path=${a.path.toFixed(1)}m disp=${a.disp.toFixed(1)}m`);
check('A: W-only — camera ends behind the heading', a.yawErr < 0.15, `yawErr=${a.yawErr.toFixed(2)}`);

// --- Sim B: W+D — turning while walking curves (tank steering), camera follows ---
const b = await simWalk(1, 1);
info('sim B W+D', `yawRot=${b.yawRot.toFixed(2)} headRot=${b.headRot.toFixed(2)} path=${b.path.toFixed(1)}m disp=${b.disp.toFixed(1)}m yawErr=${b.yawErr.toFixed(2)}`);
check('B: W+D — heading turns ~2.5 rad/s (25 rad over 10s)', b.headRot > 20 && b.headRot < 30, `headRot=${b.headRot.toFixed(2)} rad`);
check('B: W+D — walking while turning curves, not a straight line', b.disp < 12 && b.path > 40, `path=${b.path.toFixed(1)}m disp=${b.disp.toFixed(1)}m`);
check('B: W+D — camera ends behind the heading', b.yawErr < 0.15, `yawErr=${b.yawErr.toFixed(2)}`);

// --- Sim C: D-only, standing — turn in place, no movement ---
const c = await simWalk(0, 1);
info('sim C D-only', `headRot=${c.headRot.toFixed(2)} path=${c.path.toFixed(2)}m disp=${c.disp.toFixed(2)}m yawErr=${c.yawErr.toFixed(2)}`);
check('C: D-only — heading turns in place', c.headRot > 20 && c.headRot < 30, `headRot=${c.headRot.toFixed(2)} rad`);
check('C: D-only — standing turn does not move the player', c.disp < 0.1 && c.path < 0.1, `disp=${c.disp.toFixed(2)}m`);
check('C: D-only — camera ends behind the heading', c.yawErr < 0.15, `yawErr=${c.yawErr.toFixed(2)}`);

// --- Sim D: W-only at low FPS (dt capped at 0.05) ---
const d = await simWalk(1, 0, 200, 0.05);
info('sim D W-only dt=0.05', `yawRot=${d.yawRot.toFixed(2)} path=${d.path.toFixed(1)}m disp=${d.disp.toFixed(1)}m yawErr=${d.yawErr.toFixed(2)}`);
check('D: low FPS — camera does not spin', d.yawRot < 0.1, `yawRot=${d.yawRot.toFixed(2)} rad over 10s`);
check('D: low FPS — player walks straight', d.disp > 40, `disp=${d.disp.toFixed(1)}m`);

// --- Sim E: driving W-only (car heading does not snap — expect no spin) ---
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
  cam.currentPosition.set(0, 3.2, -0.5);
  const fake = {
    moveAxes: () => ({ forward: 1, strafe: 0 }),
    isDown: () => false,
    pressed: () => false,
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
  const fakeCity = { resolveCircle: () => {}, waterDepthAt: () => 0, shoreOutward: () => ({ x: 0, z: 1 }) };
  for (let i = 0; i < 600; i += 1) {
    car.update(1 / 60, fake, fakeCity, 1);
    cam.update(1 / 60, car.position, car.heading, true, 0, 0);
    yawRot += Math.abs(wrap(cam.yaw - prevYaw));
    headRot += Math.abs(wrap(car.heading - prevHead));
    prevYaw = cam.yaw;
    prevHead = car.heading;
  }
  return { yawRot, headRot, endX: car.position.x, endZ: car.position.z, speed: car.speed };
});
info('sim E drive W-only', `yawRot=${e.yawRot.toFixed(2)} headRot=${e.headRot.toFixed(2)} end=(${e.endX.toFixed(1)},${e.endZ.toFixed(1)}) speed=${e.speed.toFixed(1)}`);
check('E: driving W-only — car does not spin', e.headRot < 0.5, `headRot=${e.headRot.toFixed(2)} rad`);
check('E: driving W-only — car drives away', Math.hypot(e.endX, e.endZ + 8) > 50, `end=(${e.endX.toFixed(1)},${e.endZ.toFixed(1)})`);

// --- Real input: start the game, hold W while wiggling the mouse ---
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);
const start = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z, yaw: window.__game.chaseCamera.yaw, heading: window.__game.player.heading }));
await page.keyboard.down('KeyW');
let yawRot = 0;
let prevYaw = start.yaw;
let path = 0;
let prevX = start.x;
let prevZ = start.z;
for (let i = 0; i < 40; i += 1) {
  await page.waitForTimeout(250);
  // Wiggle the mouse mid-walk: with no mouse-look it must not steer anything.
  if (i % 2 === 0) await page.mouse.move(940, 360);
  else await page.mouse.move(340, 360);
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
const end = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z, heading: window.__game.player.heading }));
const disp = Math.hypot(end.x - start.x, end.z - start.z);
info('real input: W 10s + mouse wiggle', `yawRot=${yawRot.toFixed(2)} path=${path.toFixed(1)}m disp=${disp.toFixed(1)}m dHeading=${Math.abs(end.heading - start.heading).toFixed(2)}`);
check('real input: W + mouse wiggle — camera does not spin', yawRot < 2.0, `yawRot=${yawRot.toFixed(2)} rad`);
check('real input: W + mouse wiggle — player makes progress', disp > 2 || path < 3, `disp=${disp.toFixed(1)}m path=${path.toFixed(1)}m (headless is slow; path>>disp means circling)`);
check('real input: mouse wiggle does not change the heading', Math.abs(end.heading - start.heading) < 0.1, `dHeading=${Math.abs(end.heading - start.heading).toFixed(2)}`);

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const fails = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
