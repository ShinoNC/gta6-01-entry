// Carjack test for SOLARIS KEYS (bug 7: moving traffic cars were
// uncatchable, so carjacking them was impossible in practice). Covers:
// pressing F as a fast traffic car passes yanks it to a stop and the player
// gets in; the brake-then-walk-up flow works; parked cars still work;
// police pursuit cars are carjackable and the unit is cleanly removed (a
// replacement spawns, no stuck AI); the robbery getaway car stays excluded.
// Run: node tools/carjack-test.mjs
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
await page.click('#start-button');
await page.waitForTimeout(500);
await page.evaluate(() => { window.__game.missions.snoozeBriefing(600); });

// Get the player on foot and out of any knockdown stun before an F press
// (a stunned player cannot press F, and F while driving exits the car).
async function ensureOnFoot() {
  if (await page.evaluate(() => window.__game.drivenCar !== null)) {
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(500);
  }
  for (let i = 0; i < 20; i += 1) {
    const down = await page.evaluate(() => window.__game.player.downTimer);
    if (down <= 0) break;
    await page.waitForTimeout(1000);
  }
  await page.evaluate(() => { window.__game.wanted.setStars(0); });
  await page.waitForTimeout(500);
}

// Pick the traffic NPC with the most road ahead, force a cruise speed, mark
// its car object, and return its index/position/heading for the teleport.
const pickNpc = (speed, mark) => page.evaluate(([s, m]) => {
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
  best.car.__mark = m;
  const p = best.car.position;
  return { idx: bestIdx, x: p.x, z: p.z, fx: Math.sin(best.car.heading), fz: Math.cos(best.car.heading), speed: best.speed };
}, [speed, mark]);

// --- 1. YANK: a car at 15 m/s passes the player; F within 5m stops it dead
// and the player gets in.
const npc1 = await pickNpc(15, 'yank');
note('yank test car', `at (${npc1.x.toFixed(1)},${npc1.z.toFixed(1)}) speed ${npc1.speed} m/s`);
// GTA rule: the yank only earns a star when witnessed — stage a pedestrian
// on the nearest sidewalk to the yank point BEFORE the player teleports
// there. The witness only needs to be within 20m of the steal, so the
// pick-time position is fine even though the car keeps moving.
await page.evaluate((n) => {
  const g = window.__game;
  const peds = g.pedestrians;
  const ped = peds.peds.find((p) => p.knockedTimer <= 0);
  const px = n.x + n.fx * 4;
  const pz = n.z + n.fz * 4;
  let best = null;
  let bestD = Infinity;
  for (const line of peds.lines) {
    const lat = line.axis === 'z' ? px : pz;
    const d = Math.abs(lat - line.at);
    if (d < bestD) {
      bestD = d;
      best = line;
    }
  }
  ped.line = best;
  ped.along = best.axis === 'z' ? pz : px;
  ped.along = Math.max(best.from, Math.min(best.to, ped.along));
  ped.side = (best.axis === 'z' ? px : pz) >= best.at ? 1 : -1;
  ped.knockedTimer = 0;
  ped.fleeTimer = 0;
  ped.walkSpeed = 0;
}, npc1);
// Read the car's LIVE position and teleport the player 4m ahead of it in
// ONE evaluate, then press F at once: at 15 m/s the car covers the 4m in
// ~0.27s of game time, so any evaluate between the teleport and F lets it
// hit the player — and a press while downTimer > 0 is swallowed.
await page.evaluate((idx) => {
  const g = window.__game;
  const npc = g.traffic.cars[idx];
  const p = npc.car.position;
  const fx = Math.sin(npc.car.heading);
  const fz = Math.cos(npc.car.heading);
  g.player.group.position.set(p.x + fx * 4, 0, p.z + fz * 4);
}, npc1.idx);
await page.keyboard.press('KeyF');
// The steal message can be overwritten within a second by the FIRST WHEELS
// achievement toast, so poll for either.
let sawStealMsg = false;
for (let i = 0; i < 5 && !sawStealMsg; i += 1) {
  await page.waitForTimeout(200);
  sawStealMsg = await page.evaluate(() => {
    const m = document.getElementById('hud-message').textContent;
    return m.includes('VEHICLE STOLEN') || m.includes('FIRST WHEELS');
  });
}
await page.waitForTimeout(500);
const yank = await page.evaluate(() => ({
  driven: window.__game.drivenCar?.__mark === 'yank',
  name: window.__game.drivenCar?.name,
  speed: window.__game.drivenCar?.speed,
  trafficCount: window.__game.traffic.cars.length,
  inCars: window.__game.cars.some((c) => c.__mark === 'yank'),
  stars: window.__game.wanted.stars,
}));
note('yank result', JSON.stringify(yank));
check('F on a moving traffic car carjacks it', yank.driven === true, `driving ${yank.name}`);
check('carjacked car is yanked to a stop', yank.speed === 0, `speed ${yank.speed} m/s`);
check('traffic spawns a replacement NPC', yank.trafficCount === 10, `${yank.trafficCount} NPCs`);
check('stolen car joins the owned cars', yank.inCars === true);
check('carjack adds a wanted star', yank.stars === 1, `${yank.stars} stars`);
check('VEHICLE STOLEN message shows', sawStealMsg === true);

// --- 2. BRAKED FLOW: stand in the road ahead of a car at 12 m/s, let it
// brake to a stop, walk up and press F.
await ensureOnFoot();
const npc2 = await pickNpc(12, 'braked');
await page.evaluate((n) => {
  window.__game.player.group.position.set(n.x + n.fx * 7, 0, n.z + n.fz * 7);
}, npc2);
let stoppedSpeed = 99;
for (let i = 0; i < 30 && stoppedSpeed > 2; i += 1) {
  await page.waitForTimeout(1000);
  stoppedSpeed = await page.evaluate((idx) => window.__game.traffic.cars[idx].speed, npc2.idx);
}
note('braked flow', `car speed ${stoppedSpeed.toFixed(1)} m/s`);
check('traffic brakes to a stop for a player ahead', stoppedSpeed < 2, `speed ${stoppedSpeed.toFixed(1)} m/s`);
// Walk up to the stopped car: try road-relative offsets from the car's live
// heading (ahead first — the player ahead keeps the car stopped). A blind
// +2 in x can land inside a building, and the push-out then shoves the
// player out of F range.
let brakedInRange = false;
for (const [along, side] of [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
  await page.evaluate(([idx, a, s]) => {
    const g = window.__game;
    const car = g.traffic.cars[idx].car;
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    g.player.group.position.set(car.position.x + fx * a + fz * s, 0, car.position.z + fz * a - fx * s);
  }, [npc2.idx, along, side]);
  await page.waitForTimeout(300);
  brakedInRange = await page.evaluate((idx) => {
    const g = window.__game;
    const car = g.traffic.cars[idx].car;
    return Math.hypot(g.player.position.x - car.position.x, g.player.position.z - car.position.z) < 4;
  }, npc2.idx);
  if (brakedInRange) break;
}
await page.keyboard.press('KeyF');
await page.waitForTimeout(1000);
const braked = await page.evaluate(() => ({
  driven: window.__game.drivenCar?.__mark === 'braked',
  name: window.__game.drivenCar?.name,
}));
check('braked car can be walked up to and carjacked', braked.driven === true, `driving ${braked.name}`);

// --- 3. PARKED: the nearest parked car still works as before.
await ensureOnFoot();
await page.evaluate(() => {
  const g = window.__game;
  let best = null; let bestD = 99;
  for (const car of g.cars) {
    if (car.driven || car.destroyed || car.__mark) continue;
    const d = Math.hypot(car.position.x - g.player.position.x, car.position.z - g.player.position.z);
    if (d < bestD) { bestD = d; best = car; }
  }
  best.__mark = 'parked';
  const p = best.position;
  g.player.group.position.set(p.x + 2, 0, p.z);
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(1000);
const parked = await page.evaluate(() => window.__game.drivenCar?.__mark === 'parked');
check('parked car still carjackable', parked === true);

// --- 4. POLICE: 2 stars spawns pursuit cars; F next to one steals it, the
// unit is removed, and a replacement spawns (police AI not stuck).
await ensureOnFoot();
await page.evaluate(() => { window.__game.wanted.setStars(2); });
let pursuit = 0;
for (let i = 0; i < 20 && pursuit === 0; i += 1) {
  await page.waitForTimeout(1000);
  pursuit = await page.evaluate(() => window.__game.police.pursuit.length);
}
note('police spawned', `${pursuit} pursuit cars`);
const cop = await page.evaluate(() => {
  const g = window.__game;
  const unit = g.police.pursuit[0];
  unit.car.__mark = 'cop';
  const p = unit.car.position;
  return { x: p.x, z: p.z, speed: unit.car.speed, before: g.police.pursuit.length };
});
note('police car', `at (${cop.x.toFixed(1)},${cop.z.toFixed(1)}) speed ${cop.speed.toFixed(1)} m/s, pursuit=${cop.before}`);
// The pursuit car runs at up to 38 m/s, so a single teleport + F is a
// race: the car leaves the 5m range (or hits the player, stunning them
// and blocking F) before the keypress lands. Glue the player 4m BESIDE
// the moving car (perpendicular to its heading, so it never runs the
// player down), re-placing every 100ms, then press F at once; retry if
// the first attempt misses.
let stolen = null;
for (let attempt = 0; attempt < 3 && !(stolen && stolen.driven); attempt += 1) {
  for (let i = 0; i < 5; i += 1) {
    await page.evaluate(() => {
      const g = window.__game;
      const unit = g.police.pursuit.find((u) => u.car.__mark === 'cop');
      if (unit && !g.drivenCar) {
        const p = unit.car.position;
        const h = unit.car.heading;
        g.player.group.position.set(p.x + Math.cos(h) * 4, 0, p.z - Math.sin(h) * 4);
      }
    });
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1000);
  stolen = await page.evaluate(() => ({
    driven: window.__game.drivenCar?.__mark === 'cop',
    name: window.__game.drivenCar?.name,
    speed: window.__game.drivenCar?.speed,
    unitGone: !window.__game.police.pursuit.some((u) => u.car.__mark === 'cop') && !window.__game.police.roadblock.some((u) => u.car.__mark === 'cop'),
    inCars: window.__game.cars.some((c) => c.__mark === 'cop'),
    pursuitNow: window.__game.police.pursuit.length,
    stars: window.__game.wanted.stars,
  }));
}
note('police steal', JSON.stringify(stolen));
check('police pursuit car is carjackable', stolen.driven === true, `driving ${stolen.name}`);
check('stolen police car is yanked to a stop', stolen.speed === 0, `speed ${stolen.speed} m/s`);
check('stolen unit is removed from pursuit/roadblock', stolen.unitGone === true);
check('stolen police car joins the owned cars', stolen.inCars === true);
// The force tops pursuit back up to the count for the current stars
// (2 set + 1 steal crime = 3 stars -> 4 cars). Poll briefly.
let toppedUp = false;
for (let i = 0; i < 15 && !toppedUp; i += 1) {
  await page.waitForTimeout(1000);
  toppedUp = await page.evaluate(() => {
    const s = window.__game.wanted.stars;
    const want = s <= 0 ? 0 : s === 1 ? 1 : s === 2 ? 2 : s === 3 ? 4 : s === 4 ? 5 : 6;
    return window.__game.police.pursuit.length >= want;
  });
}
const pursuitAfter = await page.evaluate(() => ({ n: window.__game.police.pursuit.length, stars: window.__game.wanted.stars }));
check('police spawns a replacement unit (AI not stuck)', toppedUp === true, `pursuit=${pursuitAfter.n} stars=${pursuitAfter.stars}`);
// The replacement units still move (AI alive).
const posBefore = await page.evaluate(() => window.__game.police.pursuit.map((u) => [u.car.position.x, u.car.position.z]));
await page.waitForTimeout(5000);
const posAfter = await page.evaluate(() => window.__game.police.pursuit.map((u) => [u.car.position.x, u.car.position.z]));
const movedUnits = posAfter.filter((p, i) => posBefore[i] && Math.hypot(p[0] - posBefore[i][0], p[1] - posBefore[i][1]) > 1).length;
check('replacement police units still drive', movedUnits > 0, `${movedUnits}/${posAfter.length} units moved`);

// --- 5. GETAWAY: the robbery getaway car stays excluded from carjacking.
await ensureOnFoot();
await page.evaluate(() => { window.__game.robbery.forceStart(); });
let getawayUp = false;
for (let i = 0; i < 20 && !getawayUp; i += 1) {
  await page.waitForTimeout(1000);
  getawayUp = await page.evaluate(() => window.__game.robbery.active && window.__game.robbery.getaway !== null);
}
note('robbery active', getawayUp);
if (getawayUp) {
  await page.evaluate(() => {
    const g = window.__game;
    const p = g.robbery.getaway.car.position;
    g.player.group.position.set(p.x + 2, 0, p.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1000);
  const gw = await page.evaluate(() => window.__game.drivenCar?.name);
  check('getaway car cannot be carjacked', gw !== 'GETAWAY', `driving ${gw ?? 'nothing'}`);
  if (gw) { await page.keyboard.press('KeyF'); await page.waitForTimeout(300); }
} else {
  check('getaway car cannot be carjacked', false, 'robbery did not start');
}

check('0 console/page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const fails = results.filter((r) => r.startsWith('FAIL')).length;
console.log(fails === 0 ? `ALL ${results.length} CHECKS PASSED` : `${fails} FAILURES`);
await browser.close();
process.exit(fails === 0 ? 0 : 1);
