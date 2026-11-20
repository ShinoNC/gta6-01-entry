// Fix-batch 2 test (20/11): M1 3-stage flow, beacon visibility, save slots,
// save position/time, carjack latch, backpedal, BUSTED copy, empire layout,
// distance display, bullet line-of-sight, camera min distance, police panel,
// scripted-heat MAX, punch timer, headlights, witnessed car theft, officer
// on foot.
// Runs over file:// (localhost is blocked by this Chrome build's Local
// Network Access checks); localStorage persists across reloads within one
// browser instance, which is all the save-slot checks need.
// Run: node tools/fixbatch2-test.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const GAME_URL = 'file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?seed=1';
const SHOTS = '/home/hatch/workspace/makefun/gta6-01/bugcheck-20261119/fixbatch2-shots';
mkdirSync(SHOTS, { recursive: true });

const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policySha = createHash('sha256').update(readFileSync(POLICY_PATH)).digest('hex');
const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-dev-shm-usage',
    '--force-device-scale-factor=1', `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
    `--hatch-webgl-allowed-domains-sha256=${policySha}`],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

const results = [];
let fails = 0;
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) fails += 1;
}
function note(text) { console.log(`NOTE ${text}`); }
const ev = (fn, arg) => page.evaluate(fn, arg);
async function loadGame() {
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
  await page.waitForTimeout(500);
}
async function newGame() {
  // DOM clicks, not Playwright clicks: page.click waits for "scheduled
  // navigations" and can hang 30s on this file:// page under load even
  // though the click itself succeeded (killed rerun2 at §J). Retry up to
  // 3 times; if the slot holds a save, the first click only arms the
  // overwrite confirm, so the next attempt confirms it.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(() => document.getElementById('start-button')?.click());
    await page.waitForTimeout(300);
    if (await ev(() => window.__game.state === 'play')) return true;
  }
  return ev(() => window.__game.state === 'play');
}
async function domClick(sel) {
  await page.evaluate((s) => document.querySelector(s)?.click(), sel);
}

await loadGame();

// ---- A. Title slot UI ----
check('slot button exists, starts at SLOT 1',
  (await page.textContent('#slot-button')) === 'SAVE SLOT: 1 ◀ ▶', await page.textContent('#slot-button'));
await domClick('#slot-button');
check('slot button cycles 1 -> 2', (await page.textContent('#slot-button')) === 'SAVE SLOT: 2 ◀ ▶');
check('summary marks the active slot', (await page.textContent('#continue-summary')).includes('▸2:'));
await domClick('#slot-button');
await domClick('#slot-button');
check('slot button cycles 2 -> 3 -> 1', (await page.textContent('#slot-button')) === 'SAVE SLOT: 1 ◀ ▶');

// ---- B. M1 data + beacon data + beacon screenshots ----
const m1 = await ev(() => window.__game.missions.pendingMission.objectives.map((o) => ({ kind: o.kind, x: o.x, z: o.z })));
check('M1 has 3 objectives', m1.length === 3, JSON.stringify(m1));
check('no M1 objective sits at the marker (52,0)', !m1.some((o) => o.x === 52 && o.z === 0), JSON.stringify(m1));
const beacon = await ev(() => {
  const b = window.__game.missions.beacon;
  return {
    opacity: +b.pillar.material.opacity.toFixed(2),
    fog: b.pillar.material.fog,
    color: b.pillar.material.color.getHex(),
    radius: b.pillar.geometry.parameters.radiusTop,
    ringFog: b.ring.material.fog,
    bizColor: window.__game.businesses.beacons[0].pillar.material.color.getHex(),
  };
});
note(`beacon: ${JSON.stringify(beacon)}`);
check('mission beacon is near-solid (>= 0.75 opacity)', beacon.opacity >= 0.75, `opacity=${beacon.opacity}`);
check('mission beacon ignores fog', beacon.fog === false && beacon.ringFog === false);
check('mission beacon is saturated yellow 0xffe600', beacon.color === 0xffe600, `0x${beacon.color.toString(16)}`);
check('mission beacon pillar radius is 2.5m', beacon.radius === 2.5);
check('business beacon is purple 0xc86bff (distinct from mission gold)', beacon.bizColor === 0xc86bff, `0x${beacon.bizColor.toString(16)}`);

check('NEW GAME starts', await newGame());
// Beacon from 52m: face east from spawn toward the (52,0) marker at sunset.
await ev(() => {
  const g = window.__game;
  g.player.group.position.set(0, 0, 0);
  g.player.heading = Math.PI / 2;
  g.player.group.rotation.y = Math.PI / 2;
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/beacon-52m.png` });
// Beacon from 100m.
await ev(() => {
  const g = window.__game;
  g.player.group.position.set(-48, 0, 0);
  g.player.heading = Math.PI / 2;
  g.player.group.rotation.y = Math.PI / 2;
});
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/beacon-100m.png` });
note('beacon screenshots saved — verify by eye (eyeball check, not automated)');

// ---- C. Save slots: slot 2 new game -> save -> reload -> continue ----
await loadGame();
await domClick('#slot-button'); // select slot 2
check('NEW GAME starts in slot 2', await newGame());
await ev(() => window.__game.setMoney(9999));
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await domClick('#save-button');
await page.waitForTimeout(300);
check('pause SAVE reports SLOT 2', (await page.textContent('#hud-message')).includes('SLOT 2'));
const slotKeys = await ev(() => ({
  s1: localStorage.getItem('solaris-keys-save-1'),
  s2: JSON.parse(localStorage.getItem('solaris-keys-save-2') || 'null'),
}));
check('slot 2 save written with $9,999', slotKeys.s2 && slotKeys.s2.money === 9999, JSON.stringify(slotKeys.s2 && { money: slotKeys.s2.money }));
check('slot 1 untouched (no save written there)', slotKeys.s1 === null);
await loadGame();
check('title summary shows slot 2 save with marker', (await page.textContent('#continue-summary')).includes('▸2: $9,999'),
  await page.textContent('#continue-summary'));
await domClick('#continue-button');
await page.waitForTimeout(500);
check('CONTINUE loads slot 2 ($9,999)', (await ev(() => window.__game.money)) === 9999);
// Overwrite confirm: back on title, NEW GAME on occupied slot 2 asks first.
await loadGame();
check('after reload the active slot is still 2 (latest save)', (await page.textContent('#slot-button')) === 'SAVE SLOT: 2 ◀ ▶');
await domClick('#start-button');
await page.waitForTimeout(300);
check('NEW GAME on an occupied slot asks first (no silent overwrite)',
  (await page.textContent('#start-button')).includes('OVERWRITE SLOT 2?') && (await ev(() => window.__game.state)) === 'title',
  await page.textContent('#start-button'));
await domClick('#start-button');
await page.waitForTimeout(300);
check('second click confirms and starts', (await ev(() => window.__game.state)) === 'play');

// ---- D. Save position + time: on foot, then driving ----
await loadGame();
check('NEW GAME starts (fresh)', await newGame());
await ev(() => {
  const g = window.__game;
  g.player.group.position.set(100, 0, 26);
  g.setGameMinutes(1300);
  g.save.saveGame(1, g.snapshotSave());
});
await loadGame();
await domClick('#continue-button');
await page.waitForTimeout(500);
const restored = await ev(() => ({
  x: +window.__game.player.position.x.toFixed(1),
  z: +window.__game.player.position.z.toFixed(1),
  mins: Math.round(window.__game.gameMinutes),
}));
check('CONTINUE restores on-foot position (100,26)', Math.abs(restored.x - 100) < 1 && Math.abs(restored.z - 26) < 1, JSON.stringify(restored));
check('CONTINUE restores game time (~1300 min)', Math.abs(restored.mins - 1300) <= 5, `mins=${restored.mins}`);
// Driving: enter the starter car, move it, save, reload, continue.
await loadGame();
check('NEW GAME starts (driving test)', await newGame());
await ev(() => { window.__game.player.group.position.set(2, 0, -8); });
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(400);
check('entered the starter car', await ev(() => window.__game.drivenCar?.name === 'SOLSTICE GT'));
await ev(() => {
  const g = window.__game;
  g.drivenCar.group.position.set(80, 0, -52);
  g.drivenCar.speed = 0;
  g.save.saveGame(1, g.snapshotSave());
});
await loadGame();
await domClick('#continue-button');
await page.waitForTimeout(500);
const restoredDrive = await ev(() => ({
  x: +window.__game.player.position.x.toFixed(1),
  z: +window.__game.player.position.z.toFixed(1),
  driving: !!window.__game.drivenCar,
}));
check('CONTINUE after driving restores the CAR (80,-52), still driving',
  Math.abs(restoredDrive.x - 80) < 1 && Math.abs(restoredDrive.z + 52) < 1 && restoredDrive.driving, JSON.stringify(restoredDrive));

// ---- E. Backpedal + diagonal ----
await loadGame();
check('NEW GAME starts (movement test)', await newGame());
// Park every car far away: the starter car sits 8m north of spawn and
// blocked the W hold at 5.4m in rerun4 (the push-out ring), which made
// the forward run look slower than the backpedal. Drop traffic too: an
// NPC hit mid-hold knocks the player down and skews the ratio.
await ev(() => {
  const g = window.__game;
  for (const c of g.cars) c.group.position.set(500, 0, 500);
  g.traffic.cars = [];
});
async function tapRun(code, taps) {
  await ev(() => { window.__game.player.group.position.set(0, 0, 0); });
  await page.waitForTimeout(200);
  for (let i = 0; i < taps; i += 1) {
    await page.keyboard.down(code);
    await page.waitForTimeout(200);
    await page.keyboard.up(code);
    await page.waitForTimeout(100);
  }
  return ev(() => ({
    x: +window.__game.player.position.x.toFixed(2),
    z: +window.__game.player.position.z.toFixed(2),
    heading: +window.__game.player.heading.toFixed(2),
  }));
}
// Warm up the frame rate first: the first movement run after load runs
// slower (JIT/shader settle), which skews same-length comparisons.
await page.waitForTimeout(3000);
const sRun = await tapRun('KeyS', 30);
const sDist = Math.hypot(sRun.x, sRun.z);
note(`S tap run: -> (${sRun.x},${sRun.z}) ${sDist.toFixed(2)}m heading=${sRun.heading}`);
check('S taps walk straight backwards (was ~1m/50 taps with heading flips)',
  sDist >= 2 && sRun.z > 0 && Math.abs(sRun.heading - Math.PI) < 0.6,
  `dist=${sDist.toFixed(2)}m z=${sRun.z} heading=${sRun.heading}`);
// Fixed-duration holds are meaningless when the VM is slow (rerun3: both
// runs covered <2m in 8s, so the ratio was sub-frame noise). Instead hold
// W until the player covers 12m, then hold S for the SAME real duration —
// the ratio then reflects game speeds, not frame counts. Both runs start
// on the clear N-S road at (0,-40) facing north (the §H firing lane).
async function holdStart() {
  await ev(() => {
    const g = window.__game;
    g.player.group.position.set(0, 0, -40);
    g.player.heading = Math.PI;
    g.player.group.rotation.y = Math.PI;
  });
  await page.waitForTimeout(200);
}
const holdDist = () => ev(() => +Math.hypot(window.__game.player.position.x, window.__game.player.position.z + 40).toFixed(2));
async function holdRunTo(codes, targetDist, maxMs = 60000) {
  await holdStart();
  for (const c of codes) await page.keyboard.down(c);
  const t0 = Date.now();
  let d = 0;
  while (Date.now() - t0 < maxMs) {
    await page.waitForTimeout(500);
    d = await holdDist();
    if (d >= targetDist) break;
  }
  const ms = Date.now() - t0;
  for (const c of codes) await page.keyboard.up(c);
  return { dist: d, ms };
}
async function holdRunFor(codes, ms) {
  await holdStart();
  for (const c of codes) await page.keyboard.down(c);
  await page.waitForTimeout(ms);
  for (const c of codes) await page.keyboard.up(c);
  return holdDist();
}
const fwd = await holdRunTo(['KeyW'], 12);
const back = await holdRunFor(['KeyS'], fwd.ms);
note(`hold runs: forward ${fwd.dist}m in ${fwd.ms}ms, backpedal ${back}m in same time (ratio ${(back / fwd.dist).toFixed(2)}, expect ~0.60)`);
check('backpedal speed is ~60% of forward (ratio 0.4–0.8)', back / fwd.dist > 0.4 && back / fwd.dist < 0.8);
// No diagonal check: under tank controls W+D means walk + turn, not
// diagonal movement, so the old B17 ratio is meaningless.

// ---- F. BUSTED / WASTED copy ----
await loadGame();
check('NEW GAME starts (down-screen test)', await newGame());
await ev(() => window.__game.endRun('BUSTED'));
await page.waitForTimeout(300);
const bustedText = await page.textContent('#down-sub');
check('BUSTED screen shows only the fine (no "lost your trail")',
  bustedText.startsWith('Fine $') && !bustedText.includes('lost your trail') && !bustedText.includes('booked'), bustedText);
const downStyle = await page.evaluate(() => {
  const cs = getComputedStyle(document.getElementById('down-sub'));
  return { weight: cs.fontWeight, size: cs.fontSize, shadow: cs.textShadow };
});
note(`down subtitle style: ${JSON.stringify(downStyle)}`);
check('down subtitle is bold 22px with a dark outline',
  +downStyle.weight >= 700 && downStyle.size === '22px' && downStyle.shadow !== 'none', JSON.stringify(downStyle));
await loadGame();
check('NEW GAME starts (wasted test)', await newGame());
await ev(() => window.__game.endRun('WASTED'));
await page.waitForTimeout(300);
const wastedText = await page.textContent('#down-sub');
check('WASTED screen shows only the hospital bill (no "lost your trail")',
  wastedText.startsWith('Hospital bill $') && !wastedText.includes('lost your trail') && !wastedText.includes('woke up'), wastedText);

// ---- G. Empire screen: distance display + narrow layout ----
await loadGame();
check('NEW GAME starts (empire test)', await newGame());
await ev(() => { window.__game.stats.kmDriven = 0.042; });
await page.keyboard.press('KeyB');
await page.waitForTimeout(500);
const empireText1 = await page.textContent('#empire-list');
check('DISTANCE DRIVEN shows metres under 1 km ("42 m")', empireText1.includes('42 m'), empireText1.match(/DISTANCE DRIVEN[^0-9]*[0-9.]+ ?[a-z]+/)?.[0]);
await page.keyboard.press('KeyB');
await ev(() => { window.__game.stats.kmDriven = 12.34; });
await page.keyboard.press('KeyB');
await page.waitForTimeout(500);
const empireText2 = await page.textContent('#empire-list');
check('DISTANCE DRIVEN shows km above 1 km ("12.3 km")', empireText2.includes('12.3 km'));
await page.keyboard.press('KeyB');
// Narrow phone viewport: empire card heads must not glue or overlap.
const narrow = await browser.newPage({ viewport: { width: 390, height: 844 } });
await narrow.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await narrow.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await narrow.waitForTimeout(500);
await narrow.evaluate(() => document.getElementById('start-button')?.click());
await narrow.waitForTimeout(500);
await narrow.keyboard.press('KeyB');
await narrow.waitForTimeout(500);
const headGap = await narrow.evaluate(() => {
  const heads = [...document.querySelectorAll('#empire-list .mission-row .mission-head')].slice(0, 3);
  return heads.map((h) => {
    const [a, b] = h.querySelectorAll('span');
    if (!a || !b) return null;
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return { gap: +(rb.left - ra.right).toFixed(1), overlap: rb.left < ra.right, aText: a.textContent, bText: b.textContent };
  });
});
note(`narrow empire heads: ${JSON.stringify(headGap)}`);
check('empire card heads keep a gap at 390px (no glued text)',
  headGap.every((h) => h && !h.overlap && h.gap >= 4), JSON.stringify(headGap.map((h) => h && h.gap)));
const overflow = await narrow.evaluate(() => document.documentElement.scrollWidth <= 391);
check('no horizontal overflow at 390px', overflow);
await narrow.close();

// ---- H. Bullet line-of-sight: through a building vs clear road ----
await loadGame();
check('NEW GAME starts (LOS test)', await newGame());
const losSetup = await ev(() => {
  const g = window.__game;
  const boxes = g.hud.city.buildingBoxes;
  for (const b of boxes) {
    const cz = (b.minZ + b.maxZ) / 2;
    const px = b.minX - 15, cx = b.maxX + 15;
    const inside = (x, z) => boxes.some((o) => x >= o.minX && x <= o.maxX && z >= o.minZ && z <= o.maxZ);
    if (inside(px, cz) || inside(cx, cz)) continue;
    if (Math.abs(cz) > 140 || Math.abs(px) > 150 || Math.abs(cx) > 150) continue;
    return { box: b, px, pz: cz, cx, cz };
  }
  return null;
});
check('found a building with clear ground on both sides', !!losSetup, JSON.stringify(losSetup && { px: losSetup.px, cx: losSetup.cx, cz: losSetup.cz }));
if (losSetup) {
  const blocked = await ev((s) => {
    const g = window.__game;
    const car = g.cars.find((c) => c.name !== 'SUNSET COUPE' && !c.destroyed);
    car.group.position.set(s.cx, 0, s.cz);
    car.hp = 100;
    g.player.group.position.set(s.px, 0, s.pz);
    g.combat.setOwnedWeapons(['fists', 'pistol']);
    g.combat.selectWeapon(1);
    g.combat.restock();
    g.combat.cooldownTimer = 0;
    const aim = Math.atan2(-(s.cx - s.px), -(s.cz - s.pz));
    const before = car.hp;
    const result = g.combat.tryShoot(g.player.position, aim, [{ x: car.position.x, z: car.position.z, radius: 2.2, kind: 'car', ref: car }]);
    return { result, before, after: car.hp, carName: car.name };
  }, losSetup);
  note(`blocked shot: ${JSON.stringify(blocked)}`);
  check('bullet through a building does NOT damage the car', blocked.after === blocked.before, `hp ${blocked.before} -> ${blocked.after}`);
  const clear = await ev(() => {
    const g = window.__game;
    const car = g.cars.find((c) => c.name !== 'SUNSET COUPE' && !c.destroyed);
    car.group.position.set(0, 0, -80);
    car.hp = 100;
    g.player.group.position.set(0, 0, -40);
    g.combat.restock();
    g.combat.cooldownTimer = 0;
    const aim = Math.atan2(-(0 - 0), -(-80 - -40));
    const before = car.hp;
    const result = g.combat.tryShoot(g.player.position, aim, [{ x: car.position.x, z: car.position.z, radius: 2.2, kind: 'car', ref: car }]);
    return { result, before, after: car.hp };
  });
  note(`clear shot: ${JSON.stringify(clear)}`);
  check('bullet with clear line of sight DOES damage the car', clear.after === clear.before - 12, `hp ${clear.before} -> ${clear.after}`);
}

// ---- I. Camera against a wall: no top-down crush, stays out of the building ----
// A minimum distance is geometrically impossible here (the wall is 1.2m
// behind the player, so 2.5m would put the camera INSIDE the building —
// the camera-obstacle suite caught that). The fix is the look-down angle:
// the camera height scales with the pull so the view stays a chase view.
await loadGame();
check('NEW GAME starts (camera test)', await newGame());
const cam = await ev(() => {
  const g = window.__game;
  const boxes = g.hud.city.buildingBoxes;
  const inside = (x, z) => boxes.some((o) => x >= o.minX && x <= o.maxX && z >= o.minZ && z <= o.maxZ);
  for (const b of boxes) {
    const cz = (b.minZ + b.maxZ) / 2;
    const px = b.maxX + 1.2;
    if (inside(px, cz)) continue;
    if (Math.abs(cz) > 140 || Math.abs(px) > 150) continue;
    g.player.group.position.set(px, 0, cz);
    g.player.heading = Math.PI / 2;
    g.player.group.rotation.y = Math.PI / 2;
    return { wall: b.maxX, px, cz };
  }
  return null;
});
check('found a clear wall face for the camera test', !!cam, JSON.stringify(cam));
await page.waitForTimeout(10000); // let the camera fully settle (headless lerp is slow)
const camAfter = cam ? await ev(() => {
  const g = window.__game;
  const dx = g.camera.position.x - g.player.position.x;
  const dz = g.camera.position.z - g.player.position.z;
  const horiz = Math.hypot(dx, dz);
  const cx = g.camera.position.x, cz = g.camera.position.z;
  const boxes = g.hud.city.buildingBoxes;
  return {
    horiz: +horiz.toFixed(2),
    y: +g.camera.position.y.toFixed(2),
    inside: boxes.some((b) => cx > b.minX && cx < b.maxX && cz > b.minZ && cz < b.maxZ),
    angle: +(Math.atan2(g.camera.position.y - 1.6, horiz) * 180 / Math.PI).toFixed(1),
  };
}) : { horiz: 0, y: 99, inside: true, angle: 99 };
note(`camera vs wall ${JSON.stringify(cam)} -> ${JSON.stringify(camAfter)} (old bug: horiz ~0.6m, y 3.4m, ~80° top-down)`);
check('camera stays out of the building when pulled in', !camAfter.inside);
check('camera keeps a chase angle (look-down <= 35°, was ~80°)', camAfter.angle <= 35, `angle=${camAfter.angle}°`);
check('camera does not sit on the player (horiz >= 0.5m)', camAfter.horiz >= 0.5, `horiz=${camAfter.horiz}m`);

// ---- J. Police panel (B4), scripted heat MAX (B8), punch timer ----
await loadGame();
check('NEW GAME starts (panel/heat test)', await newGame());
await ev(() => window.__game.wanted.setStars(1));
let unitsUp = false;
for (let i = 0; i < 10 && !unitsUp; i += 1) {
  await page.waitForTimeout(500);
  unitsUp = await ev(() => window.__game.police.units(window.__game.player.position).length > 0);
}
if (unitsUp) {
  check('police panel shows with 1 star', !(await page.getAttribute('#hud-police', 'class')).includes('hidden'));
  await ev(() => window.__game.wanted.setStars(0));
  await page.waitForTimeout(800);
  check('police panel hides promptly at 0 stars (no 3s linger)',
    (await page.getAttribute('#hud-police', 'class')).includes('hidden'));
} else {
  note('SKIP police-panel checks: no units spawned in 5s');
}
await ev(() => window.__game.wanted.setStars(5));
await ev(() => window.__game.missions.forceStart(2));
const heatStars = await ev(() => window.__game.wanted.stars);
check('scripted heat does not LOWER 5 stars to 2 (MAX applies)', heatStars === 5, `stars=${heatStars}`);
const punchTimer = await ev(() => { window.__game.player.punch(); return +window.__game.player.punchTimer.toFixed(2); });
check('punch swing lasts 0.45s (visible in a still)', punchTimer === 0.45, `punchTimer=${punchTimer}`);

// ---- K. Headlights: on at night while driving, off by day / on foot ----
await loadGame();
check('NEW GAME starts (headlight test)', await newGame());
const lamp = await ev(() => {
  const h = window.__game.headlight;
  return { exists: !!h, spot: h.isSpotLight, intensity: h.intensity, angle: h.angle, distance: h.distance, shadow: h.castShadow, visible: h.visible };
});
note(`headlight: ${JSON.stringify(lamp)}`);
check('headlight is a real SpotLight (intensity 1200, angle 0.55, range 35m, no shadow)',
  lamp.exists && lamp.spot && lamp.intensity === 1200 && lamp.angle === 0.55 && lamp.distance === 35 && lamp.shadow === false, JSON.stringify(lamp));
await ev(() => {
  const g = window.__game;
  g.pedestrians.peds.forEach((p) => { p.knockedTimer = 999; });
  g.setGameMinutes(720); // noon
  g.player.group.position.set(2, 0, -8);
});
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(400);
check('entered the starter car (day)', await ev(() => window.__game.drivenCar?.name === 'SOLSTICE GT'));
await page.waitForTimeout(800);
const dayLamp = await ev(() => ({ visible: window.__game.headlight.visible, lampHex: window.__game.drivenCar.lampMat.color.getHex() }));
check('headlight OFF by day while driving', dayLamp.visible === false, JSON.stringify(dayLamp));
check('lamps stay dim by day (0xfff2a8)', dayLamp.lampHex === 0xfff2a8, `0x${dayLamp.lampHex.toString(16)}`);
await ev(() => window.__game.setGameMinutes(0)); // midnight
await page.waitForTimeout(1200);
const nightLamp = await ev(() => {
  const g = window.__game;
  const car = g.drivenCar;
  const h = g.headlight;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  return {
    visible: h.visible,
    lampHex: car.lampMat.color.getHex(),
    posAhead: +((h.position.x - car.position.x) * fx + (h.position.z - car.position.z) * fz).toFixed(1),
    posY: +h.position.y.toFixed(1),
    tgtAhead: +((h.target.position.x - car.position.x) * fx + (h.target.position.z - car.position.z) * fz).toFixed(1),
    tgtY: +h.target.position.y.toFixed(1),
  };
});
note(`night headlight: ${JSON.stringify(nightLamp)}`);
check('headlight ON at night while driving', nightLamp.visible === true);
check('headlight sits 2m ahead of the car, 1.2m up', nightLamp.posAhead === 2 && nightLamp.posY === 1.2, JSON.stringify(nightLamp));
check('headlight target is 20m ahead at ground level', nightLamp.tgtAhead === 20 && nightLamp.tgtY === 0, JSON.stringify(nightLamp));
check('lamps brighten at night (0xffffff)', nightLamp.lampHex === 0xffffff, `0x${nightLamp.lampHex.toString(16)}`);
await ev(() => { window.__game.drivenCar.heading += Math.PI / 2; window.__game.drivenCar.group.rotation.y = window.__game.drivenCar.heading; });
await page.waitForTimeout(800);
const turnedLamp = await ev(() => {
  const g = window.__game;
  const car = g.drivenCar;
  const h = g.headlight;
  const fx = Math.sin(car.heading), fz = Math.cos(car.heading);
  return +((h.target.position.x - car.position.x) * fx + (h.target.position.z - car.position.z) * fz).toFixed(1);
});
check('headlight target follows the car heading when turning', turnedLamp === 20, `targetAhead=${turnedLamp}`);
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
const footLamp = await ev(() => ({ visible: window.__game.headlight.visible, driving: !!window.__game.drivenCar }));
check('headlight OFF on foot at night', footLamp.visible === false && !footLamp.driving, JSON.stringify(footLamp));

// ---- L. Witnessed car theft: unseen = free, seen = 1 star ----
async function knockAllPeds() {
  await ev(() => window.__game.pedestrians.peds.forEach((p) => { p.knockedTimer = 999; }));
}
// Nearest car within the 5m F range (same sets main.js nearestCar checks).
const nearestCarInfo = () => ev(() => {
  const g = window.__game;
  let best = null, bestDist = 5;
  const consider = (car, isPolice) => {
    if (car.destroyed) return;
    const d = Math.hypot(car.position.x - g.player.position.x, car.position.z - g.player.position.z);
    if (d < bestDist) { bestDist = d; best = { name: car.name, isPolice, dist: +d.toFixed(1) }; }
  };
  for (const c of g.cars) consider(c, false);
  for (const n of g.traffic.cars) consider(n.car, false);
  for (const u of [...g.police.pursuit, ...g.police.roadblock]) consider(u.car, true);
  return best;
});
// Wait until the intended car is the nearest (a passing traffic car may
// briefly be closer), then press F.
async function stealWhenNearest(pred, maxMs = 10000) {
  const t0 = Date.now();
  for (;;) {
    const n = await nearestCarInfo();
    if (n && pred(n)) break;
    if (Date.now() - t0 > maxMs) break;
    await page.waitForTimeout(500);
  }
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
}
// Stage an UNOWNED parked car next to the player (the starter SOLSTICE GT
// is cars[0] with owned=true, so stealing it never runs the steal branch).
// Other parked cars are moved away so the target is the nearest car.
async function stageStealTarget() {
  return ev(() => {
    const g = window.__game;
    const target = g.cars.find((c) => !c.owned && c.name !== 'SUNSET COUPE' && !c.destroyed);
    for (const c of g.cars) if (c !== target) c.group.position.set(500, 0, 500);
    target.group.position.set(4, 0, -8);
    g.player.group.position.set(2, 0, -8);
    return { name: target.name, owned: !!target.owned };
  });
}
// Record every toast the game EMITS (hook on hud.showMessage). Display
// timing under a slow VM is unreliable — the probe proved the steal
// message displays for ~3.7s before the queued achievement — so the
// content assertions use the emission log, which is timing-proof. One
// visible check in L1 (generous 10s window) still proves it displays.
async function hookMessages() {
  await ev(() => {
    window.__messages = [];
    const g = window.__game;
    const orig = g.hud.showMessage.bind(g.hud);
    g.hud.showMessage = (t, s, st) => { window.__messages.push(t); return orig(t, s, st); };
  });
}
async function waitForEmitted(substr, maxMs = 10000) {
  const t0 = Date.now();
  for (;;) {
    const found = await ev((s) => window.__messages.some((m) => m.includes(s)), substr);
    if (found || Date.now() - t0 > maxMs) return found;
    await page.waitForTimeout(300);
  }
}
const emittedMessages = () => ev(() => window.__messages.slice());
// Poll for a toast containing `substr` (toasts queue behind each other now,
// so the steal message can arrive up to ~0.6s late behind the carjack
// prompt). Returns the matching text, or the last text seen on timeout.
async function waitForMessage(substr, maxMs = 10000) {
  const t0 = Date.now();
  let msg = '';
  for (;;) {
    msg = await page.textContent('#hud-message');
    if (msg.includes(substr) || Date.now() - t0 > maxMs) return msg;
    await page.waitForTimeout(200);
  }
}
// L1: unseen steal — no star, plain message.
await loadGame();
check('NEW GAME starts (unseen steal)', await newGame());
await hookMessages();
await knockAllPeds();
const targetL1 = await stageStealTarget();
check('steal target is an unowned parked car', targetL1.owned === false, JSON.stringify(targetL1));
await page.waitForTimeout(400);
// Observe the toast IN the page: the 3.5s real-time toast window is
// shorter than one CDP round-trip under the full-suite load, so polling
// from Node (drivenCar wait, then waitForMessage) misses it — the steal
// frame can be 3s old before the first message read lands. An in-page
// setInterval resolves the moment the text appears, with no round-trip
// latency. Started BEFORE the F press so it cannot miss the toast.
const msgPromise = page.evaluate(() => new Promise((resolve) => {
  const iv = setInterval(() => {
    const el = document.getElementById('hud-message');
    if (el && el.textContent.includes('VEHICLE STOLEN')) {
      clearInterval(iv);
      resolve(el.textContent);
    }
  }, 100);
  setTimeout(() => { clearInterval(iv); resolve(''); }, 25000);
}));
await stealWhenNearest((n) => n.name === targetL1.name);
// Wait for the steal frame to actually run (drivenCar set) BEFORE checking
// the toast: the F press is processed on the next game frame, which under
// headless slowness can land seconds after the press — and the 3s toast
// window opens only then. Polling the message first races the frame (the
// debug-steal-msg probe showed the toast displaying at t=3.5s after the F
// press, with FIRST WHEELS following at t=6.8s).
let droveL1 = false;
for (let i = 0; i < 60 && !droveL1; i += 1) {
  droveL1 = await ev(() => window.__game.drivenCar !== null);
  if (!droveL1) await page.waitForTimeout(500);
}
// Check the DISPLAY first: the toast shows for 3.5s of real time, and the
// evaluate round-trips below can eat that window under the 12x12 load.
// The emitted-log checks after this are timing-independent (the log persists).
// The toast text was captured in-page (msgPromise, started before the F
// press) — awaiting it here costs nothing: it resolved when the toast
// appeared, or after 25s with '' if it never did.
const unseenDisplayed = await msgPromise;
const unseen = await ev(() => ({ stars: window.__game.wanted.stars, car: window.__game.drivenCar?.name }));
check('unseen steal: entered the car, 0 stars', unseen.car === targetL1.name && unseen.stars === 0, JSON.stringify(unseen));
check('unseen steal: message actually displays', unseenDisplayed.includes('VEHICLE STOLEN'));
const unseenEmitted = await waitForEmitted(`VEHICLE STOLEN: ${targetL1.name}`);
const unseenLog = await emittedMessages();
check('unseen steal: plain message emitted, no witness note',
  unseenEmitted && !unseenLog.some((m) => m.includes('witness called it in')), JSON.stringify(unseenLog));
check('queued FIRST WHEELS achievement still emitted after the steal message',
  await waitForEmitted('FIRST WHEELS'), JSON.stringify(await emittedMessages()));
// L2: ped within 20m witnesses — 1 star + witness note.
await loadGame();
check('NEW GAME starts (ped witness)', await newGame());
await hookMessages();
const targetL2 = await stageStealTarget();
const witnessSetup = await ev(() => {
  const g = window.__game;
  g.pedestrians.peds.forEach((p) => { p.knockedTimer = 999; });
  const ped = g.pedestrians.peds[0];
  ped.knockedTimer = 0;
  ped.fleeTimer = 0;
  ped.walkSpeed = 0;
  const lines = g.pedestrians.lines.filter((l) => l.axis === 'z');
  lines.sort((a, b) => Math.abs(a.at - 2) - Math.abs(b.at - 2));
  ped.line = lines[0];
  ped.along = -8;
  ped.side = 2 >= lines[0].at ? 1 : -1;
  return { lineAt: lines[0].at, side: ped.side };
});
await page.waitForTimeout(1000); // let placeOnSidewalk put the ped down
const witnessDist = await ev(() => {
  const g = window.__game;
  const p = g.pedestrians.peds[0].mesh.group.position;
  return +Math.hypot(p.x - g.player.position.x, p.z - g.player.position.z).toFixed(1);
});
note(`witness ped: ${JSON.stringify(witnessSetup)} dist=${witnessDist}m`);
check('witness ped is within 20m of the player', witnessDist < 20, `dist=${witnessDist}m`);
await stealWhenNearest((n) => n.name === targetL2.name);
const seen = await ev(() => ({ stars: window.__game.wanted.stars, car: window.__game.drivenCar?.name }));
check('ped-witnessed steal: 1 star', seen.car === targetL2.name && seen.stars === 1, JSON.stringify(seen));
check('ped-witnessed steal: message says witness called it in',
  await waitForEmitted('witness called it in'), JSON.stringify(await emittedMessages()));
// L3: police see the theft — 1 star -> 2 stars + witness note.
await loadGame();
check('NEW GAME starts (police witness)', await newGame());
await hookMessages();
await knockAllPeds();
const targetL3 = await stageStealTarget();
await ev(() => window.__game.wanted.setStars(1));
// Headless game-time is ~6-20x slower than real time, so the pursuit car
// may never drive to the player within the poll (12x12 city made it
// worse). This check is about police WITNESSING the theft, not pursuit
// navigation (the drive-in is covered by live play + fixbatch5): spawn a
// unit and park it 10m away with a clear line of sight.
await ev(() => {
  const g = window.__game;
  // Teleport the EXISTING pursuit unit: spawning a second one gets trimmed
  // by police.update (pursuit is capped at wantedPursuit — 1 at 1 star —
  // and pop() removes the last unit, i.e. the one just spawned). Only spawn
  // when the pursuit list is empty (then it is the only unit, no trim).
  let unit = g.police.pursuit[0];
  if (!unit) unit = g.police.spawnPursuitCar(g.player.position, 12);
  const p = g.player.position;
  // Park with a clear line of sight: the player is next to a parked car
  // (not at spawn), so a fixed +10m offset can land behind a building.
  // Try offsets until one has LOS (all are < 45m SEE_RANGE).
  const offsets = [[10, 0], [-10, 0], [0, 10], [0, -10], [6, 0], [-6, 0], [0, 6], [0, -6]];
  let placed = false;
  for (const [dx, dz] of offsets) {
    const x = p.x + dx;
    const z = p.z + dz;
    if (g.police.hasLineOfSight({ x, z }, { x: p.x, z: p.z })) {
      unit.car.group.position.set(x, 0, z);
      placed = true;
      break;
    }
  }
  if (!placed) unit.car.group.position.set(p.x + 10, 0, p.z);
  unit.car.speed = 0;
  unit.mode = 'direct';
});
let policeSees = false;
for (let i = 0; i < 60 && !policeSees; i += 1) {
  await page.waitForTimeout(500);
  policeSees = await ev(() => window.__game.police.canSeePlayer(window.__game.player.position));
}
check('police arrive within sight (canSeePlayer)', policeSees);
if (policeSees) {
  await stealWhenNearest((n) => n.name === targetL3.name);
  const copSeen = await ev(() => ({ stars: window.__game.wanted.stars, car: window.__game.drivenCar?.name }));
  check('police-witnessed steal: 1 star -> 2 stars', copSeen.car === targetL3.name && copSeen.stars === 2, JSON.stringify(copSeen));
  check('police-witnessed steal: message says witness called it in',
    await waitForEmitted('witness called it in'), JSON.stringify(await emittedMessages()));
}
// L4: stealing a police car is always known — and its officer must not leak.
await loadGame();
check('NEW GAME starts (police-car steal)', await newGame());
await hookMessages();
await knockAllPeds();
await ev(() => {
  const g = window.__game;
  for (const c of g.cars) c.group.position.set(500, 0, 500);
  g.wanted.setStars(1);
});
let officerOutL4 = false;
for (let i = 0; i < 300 && !officerOutL4; i += 1) {
  await page.waitForTimeout(500);
  officerOutL4 = await ev(() => window.__game.police.pursuit.some((u) => u.officer !== null));
}
check('an officer exits before the police-car steal', officerOutL4);
if (officerOutL4) {
  await ev(() => {
    const g = window.__game;
    const unit = g.police.pursuit.find((u) => u.officer !== null);
    window.__policeCar = unit.car;
    window.__officerUuid = unit.officer.group.uuid;
    g.player.group.position.set(unit.car.position.x + 2, 0, unit.car.position.z);
  });
  // Time-based retry (60s): a passing traffic car can knock the player
  // down (F is ignored while downTimer > 0), and a knockdown lasts much
  // longer in real time when the VM is slow. Bail out if BUSTED.
  let stolePoliceCar = false;
  const stealT0 = Date.now();
  while (Date.now() - stealT0 < 60000 && !stolePoliceCar) {
    if ((await ev(() => window.__game.state)) !== 'play') break;
    const down = await ev(() => window.__game.player.downTimer > 0);
    if (down) { await page.waitForTimeout(3000); continue; }
    const n = await nearestCarInfo();
    if (!n || !n.isPolice) {
      await ev(() => {
        const car = window.__policeCar;
        if (car) window.__game.player.group.position.set(car.position.x + 2, 0, car.position.z);
      });
      await page.waitForTimeout(500);
      continue;
    }
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(400);
    stolePoliceCar = await ev(() => window.__game.drivenCar === window.__policeCar);
  }
  const copCar = await ev(() => ({
    stars: window.__game.wanted.stars,
    isPoliceCar: window.__game.drivenCar === window.__policeCar,
    officerGone: window.__game.scene.getObjectByProperty('uuid', window.__officerUuid) === undefined,
  }));
  const copCarLog = await emittedMessages();
  note(`police-car steal: ${JSON.stringify(copCar)} emitted=${JSON.stringify(copCarLog)}`);
  check('police-car steal: driving the police car, 1 star -> 2 stars', copCar.isPoliceCar && copCar.stars === 2, JSON.stringify(copCar));
  check('police-car steal: no "witness called it in" (always known)',
    copCarLog.some((m) => m.includes('VEHICLE STOLEN')) && !copCarLog.some((m) => m.includes('witness called it in')), JSON.stringify(copCarLog));
  check('police-car steal: the officer mesh is removed (no leak)', copCar.officerGone);
}
// L5: M4 keeps its scripted heat (1 star on accept).
await loadGame();
check('NEW GAME starts (M4 heat)', await newGame());
await ev(() => window.__game.missions.forceStart(3));
const m4Stars = await ev(() => window.__game.wanted.stars);
check('M4 accept still sets 1 star via scriptedHeat', m4Stars === 1, `stars=${m4Stars}`);

// ---- M. Officer on foot: exits, arrests, returns, shoots ----
async function waitForOfficer(maxMs = 150000) {
  // Headless game-time is ~6-20x slower than real time, so the pursuit car
  // may never drive to the player within the poll (12x12 city made it
  // worse). This section tests the OFFICER, not pursuit navigation (the
  // drive-in is covered by live play + fixbatch5): spawn a unit and park
  // it next to the player, stopped, and the officer exits on the next frame.
  await ev(() => {
    const g = window.__game;
    // Trim-proof: police.update caps pursuit at wantedPursuit (1 at 1 star)
    // and pop() removes the LAST unit. If a frame runs between setStars(1)
    // and this evaluate, the system has already spawned its unit, and
    // spawning a second one gets OURS removed on the next frame — the
    // officer then never exits (flaky: won the race in run 3, lost it in
    // run 4). Teleport the existing unit when there is one; only spawn
    // when the list is empty (then it is the only unit, no trim).
    let unit = g.police.pursuit[0];
    if (!unit) unit = g.police.spawnPursuitCar(g.player.position, 12);
    const p = g.player.position;
    unit.car.group.position.set(p.x + 2, 0, p.z);
    unit.car.speed = 0;
    unit.mode = 'direct';
  });
  const t0 = Date.now();
  for (;;) {
    const found = await ev(() => window.__game.police.pursuit.some((u) => u.officer !== null));
    if (found || Date.now() - t0 > maxMs) return found;
    await page.waitForTimeout(500);
  }
}
await loadGame();
check('NEW GAME starts (officer test)', await newGame());
await knockAllPeds();
await ev(() => window.__game.wanted.setStars(1));
const officerOut = await waitForOfficer();
check('officer exits when the pursuit car stops near the on-foot player', officerOut);
const officerInfo = officerOut ? await ev(() => {
  const g = window.__game;
  const unit = g.police.pursuit.find((u) => u.officer !== null);
  if (!unit) return null;
  const o = unit.officer.group;
  return {
    shirt: o.children[0].material.color.getHex(),
    inScene: g.scene.children.includes(o),
    dist: +Math.hypot(o.position.x - g.player.position.x, o.position.z - g.player.position.z).toFixed(1),
  };
}) : null;
note(`officer: ${JSON.stringify(officerInfo)}`);
check('officer wears the navy uniform (0x24457e)', officerInfo && officerInfo.shirt === 0x24457e, officerInfo ? `0x${officerInfo.shirt.toString(16)}` : 'no officer');
check('officer mesh is in the scene', Boolean(officerInfo && officerInfo.inScene));
const d0 = officerInfo ? officerInfo.dist : -1;
await page.waitForTimeout(3000);
const d1 = await ev(() => {
  const g = window.__game;
  const unit = g.police.pursuit.find((u) => u.officer !== null);
  if (!unit) return -1;
  const o = unit.officer.group.position;
  return +Math.hypot(o.x - g.player.position.x, o.z - g.player.position.z).toFixed(1);
});
check('officer closes in on the standing player', d0 >= 0 && d1 >= 0 && (d1 < d0 - 0.2 || d1 < 1.0), `dist ${d0}m -> ${d1}m`);
// Arrest range counts from the OFFICER, not just the car: move the car away.
const officerRange = await ev(() => {
  const g = window.__game;
  const unit = g.police.pursuit.find((u) => u.officer !== null);
  if (!unit) return -1;
  unit.car.group.position.set(unit.car.position.x + 20, 0, unit.car.position.z + 20);
  return +g.police.nearestDistance(g.player.position).toFixed(1);
});
check('nearestDistance still < 3.5m with the car moved away (officer counts)', officerRange >= 0 && officerRange < 3.5, `nearest=${officerRange}m`);
let busted = false;
for (let i = 0; i < 180 && !busted; i += 1) {
  await page.waitForTimeout(500);
  busted = await ev(() => window.__game.state === 'down');
}
const downTitle = busted ? await page.textContent('#down-title') : '';
check('standing still with the officer adjacent ends BUSTED', busted && downTitle === 'BUSTED', `state=${busted ? 'down' : 'play'} title=${downTitle}`);
// Escape: teleport far away — the officer returns and despawns.
await loadGame();
check('NEW GAME starts (officer return)', await newGame());
await knockAllPeds();
await ev(() => window.__game.wanted.setStars(1));
check('officer exits (return test)', await waitForOfficer());
// Move the pursuit car 20m from the officer BEFORE the player escapes:
// the officer spawns ~1.8m from the (teleported) car, so with the car next
// to him the returning walk is ~1 frame and the poll misses the returning
// state — and the despawn (tdist < 1.5) fires almost at once. 20m along
// the z=0 road keeps the car drivable; once the player teleports away the
// car drives off and the officer despawns via tdist > 25 within ~1s of
// game-time.
await ev(() => {
  const g = window.__game;
  const unit = g.police.pursuit.find((u) => u.officer);
  if (unit && unit.officer) {
    const o = unit.officer.group.position;
    unit.car.group.position.set(o.x + 20, 0, o.z);
    unit.car.speed = 0;
  }
});
const farSpot = await ev(() => {
  const g = window.__game;
  const boxes = g.hud.city.buildingBoxes;
  const inside = (x, z) => boxes.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  for (const [x, z] of [[140, 0], [0, 140], [-140, 0], [0, -140]]) {
    if (!inside(x, z)) return { x, z };
  }
  return { x: 140, z: 0 };
});
await ev((s) => window.__game.player.group.position.set(s.x, 0, s.z), farSpot);
let returningSeen = false;
let officerGone = false;
for (let i = 0; i < 180 && !officerGone; i += 1) {
  await page.waitForTimeout(500);
  const s = await ev(() => {
    const units = window.__game.police.pursuit;
    return { any: units.some((u) => u.officer !== null), returning: units.some((u) => u.officer && u.officer.returning) };
  });
  if (s.returning) returningSeen = true;
  if (!s.any) officerGone = true;
}
check('officer switches to returning when the player escapes', returningSeen);
check('officer despawns after returning (no orphan cop)', officerGone);
// 3+ stars: the officer shoots from his own position, not the car.
await loadGame();
check('NEW GAME starts (officer shooting)', await newGame());
await knockAllPeds();
await ev(() => window.__game.wanted.setStars(3));
check('officer exits at 3 stars', await waitForOfficer());
const shot = await ev(() => {
  const g = window.__game;
  const unit = g.police.pursuit.find((u) => u.officer !== null);
  for (const u of g.police.pursuit) u.shootCooldown = 999;
  unit.shootCooldown = 0;
  window.__shotFrom = null;
  g.police.update(0.1, {
    playerPos: g.player.position,
    playerHeading: g.player.heading,
    driving: false,
    drivenCar: null,
    wantedStars: 3,
    onPoliceShot: (from) => { window.__shotFrom = { x: from.x, z: from.z }; },
  });
  const op = unit.officer.group.position;
  const cp = unit.car.position;
  const s = window.__shotFrom;
  return {
    fired: !!s,
    shotFrom: s,
    dOfficer: s ? +Math.hypot(s.x - op.x, s.z - op.z).toFixed(2) : -1,
    dCar: s ? +Math.hypot(s.x - cp.x, s.z - cp.z).toFixed(2) : -1,
    los: g.police.hasLineOfSight(op, g.player.position),
  };
});
note(`officer shot: ${JSON.stringify(shot)}`);
check('officer fires a shot at 3 stars', shot.fired, JSON.stringify(shot));
check('shot originates at the officer, not the car', shot.fired && shot.dOfficer < shot.dCar, `dOfficer=${shot.dOfficer}m dCar=${shot.dCar}m`);
// Driving: no officer exits, pursuit/roadblock/heli still work.
await loadGame();
check('NEW GAME starts (driving, no officer)', await newGame());
await knockAllPeds();
await ev(() => window.__game.player.group.position.set(2, 0, -8));
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(400);
check('entered the starter car (driving test)', await ev(() => window.__game.drivenCar?.name === 'SOLSTICE GT'));
await ev(() => window.__game.wanted.setStars(3));
await page.waitForTimeout(15000);
const driveState = await ev(() => ({
  units: window.__game.police.pursuit.length,
  officers: window.__game.police.pursuit.filter((u) => u.officer !== null).length,
  moving: window.__game.police.pursuit.filter((u) => Math.abs(u.car.speed) > 1).length,
  roadblock: window.__game.police.roadblock.length,
  heli: window.__game.police.helicopter !== null,
}));
note(`driving at 3 stars: ${JSON.stringify(driveState)}`);
check('no officer exits while the player is driving', driveState.officers === 0, JSON.stringify(driveState));
check('pursuit still chases while driving', driveState.units >= 2 && driveState.moving >= 1, JSON.stringify(driveState));
check('roadblock + helicopter still deploy at 3 stars', driveState.roadblock > 0 && driveState.heli, JSON.stringify(driveState));

check('zero console/page errors', errors.length === 0, errors.slice(0, 5).join(' | '));
console.log(`\n${fails} FAILURES`);
await browser.close();
process.exit(fails ? 1 : 0);
