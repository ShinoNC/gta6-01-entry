// Player playtest (user: "đứng trên phương diện game thủ check").
// Walks the 6 user-specified checks in ONE session and screenshots the
// moments not yet seen by eye: mid-punch arm swing, car-hit knockdown,
// driving. Map + briefing + HUD already verified in ui-shots.
// Run AFTER the full suite (headless is load-sensitive):
//   node tools/player-playtest.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const OUT = '/tmp/ui-shots';
mkdirSync(OUT, { recursive: true });
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
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`PASS ${name} ${detail || ''}`); }
  else { fail += 1; console.log(`FAIL ${name} ${detail || ''}`); }
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(1500);
await page.evaluate(() => window.__game.missions.snoozeBriefing(600));

// 1. Walk W 8s real time: must move forward, no spin. (Headless game time
// runs ~0.05x real time, so the distance bar is low — the spin sim already
// proves full-speed walking in game time (60m in 10s game). The point here
// is straight-line movement + zero heading drift.)
const before = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z, h: window.__game.player.heading }));
await page.keyboard.down('KeyW');
await page.waitForTimeout(8000);
await page.keyboard.up('KeyW');
const after = await page.evaluate(() => ({ x: window.__game.player.position.x, z: window.__game.player.position.z, h: window.__game.player.heading, cam: window.__game.chaseCamera.yaw }));
const dist = Math.hypot(after.x - before.x, after.z - before.z);
const headingChange = Math.abs(((after.h - before.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
check('walk-W moves', dist > 0.5, `moved ${dist.toFixed(1)}m`);
check('walk-W no spin', headingChange < 0.5, `heading change ${headingChange.toFixed(2)} rad`);
await page.screenshot({ path: `${OUT}/9-walking.png` });
console.log('9-walking.png');

// 2. Punch: click (lock first), verify the lock is engaged, then click to
// punch — same sequence as punch-test. The second click only punches if the
// lock is already engaged; if the lock lands between its mousedown and
// mouseup the click is swallowed as the lock click (input.js lockClick).
await page.mouse.click(640, 360); // engages pointer lock, no punch
await page.waitForTimeout(600);
let locked = await page.evaluate(() => window.__game.input.locked === true);
if (!locked) { await page.mouse.click(640, 360); await page.waitForTimeout(600); locked = await page.evaluate(() => window.__game.input.locked === true); }
check('pointer locked before punch', locked);
await page.mouse.click(640, 360); // the punch
await page.waitForTimeout(600);
const cd = await page.evaluate(() => window.__game.combat.cooldownTimer);
const pt = await page.evaluate(() => window.__game.player.punchTimer);
check('punch fires on click', cd > 0, `cooldown ${cd.toFixed(2)} punchTimer ${pt.toFixed(2)}`);
let armMin = 0;
for (let i = 0; i < 20; i += 1) {
  const arm = await page.evaluate(() => window.__game.player.group.children[4].rotation.x);
  armMin = Math.min(armMin, arm);
  if (armMin < -1) break;
  await page.waitForTimeout(200);
}
check('punch arm swings', pt > 0 && armMin < -1, `min armRightX ${armMin.toFixed(2)}`);
await page.evaluate(() => window.__game.player.punch());
await page.waitForTimeout(80);
await page.screenshot({ path: `${OUT}/10-punch.png` });
console.log('10-punch.png');

// 3. Car hit: teleport player 1m ahead of the fastest NPC.
const hitResult = await page.evaluate(() => {
  const g = window.__game;
  let best = null;
  for (const n of g.traffic.cars) if (!best || n.speed > best.speed) best = n;
  const car = best.car;
  // Put the player 1.5m ahead of the car's direction of travel.
  const dir = { x: Math.sin(car.heading), z: Math.cos(car.heading) };
  g.player.group.position.set(car.position.x + dir.x * 1.5, 0, car.position.z + dir.z * 1.5);
  return { speed: best.speed, carPos: [car.position.x.toFixed(1), car.position.z.toFixed(1)] };
});
console.log('hit target:', JSON.stringify(hitResult));
let knocked = false, hpAfter = 100;
for (let i = 0; i < 20; i += 1) {
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({ hp: window.__game.health, down: window.__game.player.downTimer, rot: window.__game.player.group.rotation.x }));
  hpAfter = s.hp;
  if (s.down > 0 || Math.abs(s.rot) > 1) { knocked = true; break; }
}
check('car hit damages player', hpAfter < 100, `health ${hpAfter}`);
check('car hit knocks player down', knocked, knocked ? 'lying down seen' : 'never down');
await page.screenshot({ path: `${OUT}/11-knocked.png` });
console.log('11-knocked.png');
await page.evaluate(() => { window.__game.player.downTimer = 0; window.__game.player.group.rotation.x = 0; });
await page.waitForTimeout(500);

// 5. Quest marker: walk to M1 marker (52,0) — briefing must appear.
await page.evaluate(() => { window.__game.missions.snooze = 0; window.__game.player.group.position.set(52, 0, 0); });
let briefUp = false;
for (let i = 0; i < 12 && !briefUp; i += 1) {
  await page.waitForTimeout(2000);
  briefUp = await page.evaluate(() => !document.getElementById('phone-panel').classList.contains('hidden'));
}
check('briefing at marker', briefUp, briefUp ? 'phone shown' : 'no phone');
await page.evaluate(() => document.getElementById('phone-accept')?.click());
await page.waitForTimeout(1000);
const m1 = await page.evaluate(() => ({ cur: window.__game.missions.currentMission()?.name || null, done: window.__game.missions.doneCount() }));
check('mission 1 starts on ACCEPT', m1.cur === 'FIRST FARE' || m1.done >= 1, JSON.stringify(m1));

// 6. Drive: enter the nearest car, W 5s, check it moves + turns right with D.
await page.evaluate(() => {
  const g = window.__game;
  const car = g.cars.find((c) => !c.destroyed) || g.traffic.cars[0].car;
  g.player.group.position.set(car.position.x + 1, 0, car.position.z);
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(1000);
const driving = await page.evaluate(() => window.__game.drivenCar !== null);
check('enter car with F', driving, driving ? 'driving' : 'not driving');
if (driving) {
  const d0 = await page.evaluate(() => ({ x: window.__game.drivenCar.position.x, z: window.__game.drivenCar.position.z, h: window.__game.drivenCar.heading }));
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(8000);
  await page.keyboard.up('KeyW');
  const d1 = await page.evaluate(() => ({ x: window.__game.drivenCar.position.x, z: window.__game.drivenCar.position.z, h: window.__game.drivenCar.heading, sp: window.__game.drivenCar.speed }));
  const dDist = Math.hypot(d1.x - d0.x, d1.z - d0.z);
  const dHead = Math.abs(((d1.h - d0.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
  check('drive W moves straight', dDist > 0.5 && dHead < 0.5, `moved ${dDist.toFixed(1)}m, heading change ${dHead.toFixed(2)}, speed ${d1.sp.toFixed(1)}`);
  // Turn right with D while moving.
  await page.keyboard.down('KeyW');
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(5000);
  await page.keyboard.up('KeyD');
  await page.keyboard.up('KeyW');
  const d2 = await page.evaluate(() => ({ h: window.__game.drivenCar.heading }));
  const turn = ((d2.h - d1.h + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  check('drive D turns right', turn < -0.05, `heading delta ${turn.toFixed(2)} rad (negative = right in three.js)`);
  await page.screenshot({ path: `${OUT}/12-driving.png` });
  console.log('12-driving.png');
}

console.log(`\nPLAYTEST: ${pass} PASS / ${fail} FAIL`);
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : '0 console/page errors');
await browser.close();
process.exit(fail ? 1 : 0);
