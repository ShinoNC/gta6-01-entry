// Car-hit test for SOLARIS KEYS (bug 3: traffic cars pushed the on-foot
// player out but dealt no damage). Covers: traffic brakes for a player
// standing ahead (no damage when it stops in time); a fast car too close to
// stop deals speed-based damage + knockdown + message; a slow car pushes
// without damage; the same car does not damage twice in quick succession.
// Run: node tools/car-hit-test.mjs
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
function note(name, detail = '') {
  console.log(`INFO ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => { window.__game.missions.snoozeBriefing(600); });

// Pick the traffic NPC with the most road ahead (so it does not respawn
// mid-test), force it to a known cruise speed, and return its state.
const pickNpc = (speed) => page.evaluate((s) => {
  const g = window.__game;
  let best = null; let bestIdx = -1; let bestRoom = -1;
  for (let i = 0; i < g.traffic.cars.length; i += 1) {
    const npc = g.traffic.cars[i];
    const room = npc.direction > 0 ? npc.line.to - npc.along : npc.along - npc.line.from;
    if (room > bestRoom) { bestRoom = room; best = npc; bestIdx = i; }
  }
  best.cruiseSpeed = s;
  best.speed = s;
  best.stoppedTimer = 0;
  const p = best.car.position;
  const fx = Math.sin(best.car.heading); const fz = Math.cos(best.car.heading);
  return { idx: bestIdx, x: p.x, z: p.z, fx, fz, speed: best.speed, room: bestRoom };
}, speed);
const health = () => page.evaluate(() => window.__game.health);

// --- 1. BRAKING: player stands 7m ahead of a car at 12 m/s. The car brakes
// (30 m/s^2, stopping distance 2.4m) and stops short — no damage.
const npc1 = await pickNpc(12);
note('brake test car', `at (${npc1.x.toFixed(1)},${npc1.z.toFixed(1)}) heading (${npc1.fx.toFixed(2)},${npc1.fz.toFixed(2)}) room ${npc1.room.toFixed(0)}m`);
await page.evaluate((n) => {
  window.__game.player.group.position.set(n.x + n.fx * 7, 0, n.z + n.fz * 7);
}, npc1);
let stoppedSpeed = 99;
for (let i = 0; i < 30 && stoppedSpeed > 2; i += 1) {
  await page.waitForTimeout(1000);
  stoppedSpeed = await page.evaluate((idx) => window.__game.traffic.cars[idx].speed, npc1.idx);
}
const hAfterBrake = await health();
const gapAfterBrake = await page.evaluate((idx) => {
  const npc = window.__game.traffic.cars[idx];
  return +Math.hypot(npc.car.position.x - window.__game.player.position.x, npc.car.position.z - window.__game.player.position.z).toFixed(1);
}, npc1.idx);
check('traffic brakes to a stop for a player ahead', stoppedSpeed < 2, `nearest car speed ${stoppedSpeed.toFixed(1)} m/s`);
check('no damage when the car stops in time', hAfterBrake === 100, `health ${hAfterBrake}, nearest car ${gapAfterBrake}m away`);

// --- 2. HIT: player appears 1m ahead of a car at 15 m/s — too close to
// stop. Expect damage + knockdown + message.
const npc2 = await pickNpc(15);
note('hit test car', `at (${npc2.x.toFixed(1)},${npc2.z.toFixed(1)}) speed ${npc2.speed}`);
await page.evaluate((n) => {
  window.__game.player.group.position.set(n.x + n.fx * 1, 0, n.z + n.fz * 1);
}, npc2);
let maxRotX = 0; let sawDown = false; let sawMsg = false; let hAfterHit = 100;
for (let i = 0; i < 20; i += 1) {
  await page.waitForTimeout(1000);
  const s = await page.evaluate(() => ({
    h: window.__game.health,
    rotX: window.__game.player.group.rotation.x,
    down: window.__game.player.downTimer,
    msg: document.getElementById('hud-message').textContent,
  }));
  maxRotX = Math.max(maxRotX, s.rotX);
  if (s.down > 0) sawDown = true;
  if (s.msg.includes('HIT BY A CAR')) sawMsg = true;
  hAfterHit = s.h;
  if (hAfterHit < 100 && sawDown) break;
}
const damage = 100 - hAfterHit;
check('fast car too close to stop deals damage', damage >= 5 && damage <= 25, `health 100 -> ${hAfterHit} (damage ${damage})`);
check('player is knocked down (lying flat)', sawDown && maxRotX > 1.2, `downTimer seen=${sawDown} max rotation.x=${maxRotX.toFixed(2)}`);
check('HIT BY A CAR message shows', sawMsg);

// --- 3. COOLDOWN: health stays flat afterwards (no repeat damage).
await page.waitForTimeout(10000);
const hLater = await health();
check('no repeat damage from the same car', hLater === hAfterHit, `health ${hAfterHit} -> ${hLater}`);

// --- 4. SLOW PUSH: a car at 1 m/s pushes the player out without damage.
const npc3 = await pickNpc(1);
await page.evaluate((n) => {
  // 1.5m to the side of the car (inside the 2.6m push-out range).
  window.__game.player.group.position.set(n.x - n.fz * 1.5, 0, n.z + n.fx * 1.5);
}, npc3);
await page.waitForTimeout(5000);
const slow = await page.evaluate(() => {
  let min = 99;
  for (const npc of window.__game.traffic.cars) {
    min = Math.min(min, Math.hypot(npc.car.position.x - window.__game.player.position.x, npc.car.position.z - window.__game.player.position.z));
  }
  return { h: window.__game.health, min: +min.toFixed(1) };
});
check('slow car pushes out without damage', slow.h === hLater && slow.min >= 2.5, `health ${slow.h}, nearest car ${slow.min}m`);

// --- 5. STUN BLOCKS MOVEMENT: knock the player down directly, hold W, and
// confirm the player does not move while down.
const stun = await page.evaluate(async () => {
  const g = window.__game;
  g.player.knockDown(5);
  const before = { x: g.player.position.x, z: g.player.position.z };
  return before;
});
await page.keyboard.down('KeyW');
await page.waitForTimeout(3000);
await page.keyboard.up('KeyW');
const stunAfter = await page.evaluate(() => ({
  x: +window.__game.player.position.x.toFixed(2),
  z: +window.__game.player.position.z.toFixed(2),
  down: +window.__game.player.downTimer.toFixed(1),
}));
const moved = Math.hypot(stunAfter.x - stun.x, stunAfter.z - stun.z);
check('knocked-down player cannot move', moved < 0.1, `moved ${moved.toFixed(2)}m while down (downTimer ${stunAfter.down}s left)`);
await page.evaluate(() => { window.__game.player.downTimer = 0; window.__game.player.group.rotation.x = 0; });

check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(fails === 0 ? `ALL ${results.length} CHECKS PASSED` : `${fails} FAILURES`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
