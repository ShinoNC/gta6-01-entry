// Camera-obstacle test (task 11: the chase camera clipped through buildings
// like #1 Karimbu / #3 Tangerine Mile — a roof/wall filled the screen).
// The camera must pull in when a building blocks the player->camera segment,
// and stay at full distance in open space. Cars need no handling: the tallest
// is ~1.8m, the segment never drops below the player's head (1.6m).
// Run: node tools/camera-obstacle-test.mjs
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
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass += 1; console.log(`PASS ${name} ${detail || ''}`); }
  else { fail += 1; console.log(`FAIL ${name} ${detail || ''}`); }
}

// 2D slab test, mirroring the game's own (police.hasLineOfSight / camera).
// A wall exactly AT the camera lens (intersection starting within 0.1% of
// the segment end) does not block the view — the wall is behind the lens.
function segmentBlocked(fx, fz, tx, tz, boxes) {
  const dx = tx - fx, dz = tz - fz;
  for (const box of boxes) {
    let t0 = 0, t1 = 1;
    for (const [p, d, lo, hi] of [[fx, dx, box.minX, box.maxX], [fz, dz, box.minZ, box.maxZ]]) {
      if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t0 = 1; t1 = 0; break; } }
      else {
        let a = (lo - p) / d, b = (hi - p) / d;
        if (a > b) { const t = a; a = b; b = t; }
        t0 = Math.max(t0, a); t1 = Math.min(t1, b);
        if (t0 > t1) break;
      }
    }
    if (t0 <= t1 && t0 < 0.999) return true;
  }
  return false;
}
function insideBox(x, z, boxes) {
  return boxes.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(1500);
await page.evaluate(() => window.__game.missions.snoozeBriefing(600));

const camState = () => page.evaluate(() => {
  const g = window.__game;
  const p = g.player.position, c = g.camera.position;
  return {
    px: p.x, pz: p.z,
    cx: c.x, cy: c.y, cz: c.z,
    dist: Math.hypot(c.x - p.x, c.z - p.z),
    boxes: g.hud.city.buildingBoxes,
  };
});
async function waitForSettle() {
  // Headless runs ~0.1x game speed; the camera lerps at stiffness 4.5, so
  // settling takes seconds of real time. Poll until the distance is stable.
  let last = -1;
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(500);
    const s = await camState();
    if (last >= 0 && Math.abs(s.dist - last) < 0.05) return s;
    last = s.dist;
  }
  return camState();
}

// 1. Open space (spawn intersection): full 7.5m, nothing between.
let s = await waitForSettle();
check('open space keeps full camera distance', s.dist > 7.0, `dist ${s.dist.toFixed(2)}m`);
check('open space segment unobstructed', !segmentBlocked(s.px, s.pz, s.cx, s.cz, s.boxes));

// 2. Against a building wall: player 1m outside the west face, facing west
// (heading -PI/2) so the camera wants to sit 7.5m east, inside the building.
const wall = await page.evaluate(() => {
  const boxes = window.__game.hud.city.buildingBoxes;
  const box = boxes.find((b) => b.maxX - b.minX >= 30) || boxes[0];
  const zc = (box.minZ + box.maxZ) / 2;
  window.__game.player.group.position.set(box.minX - 1, 0, zc);
  window.__game.player.heading = -Math.PI / 2;
  window.__game.player.group.rotation.y = -Math.PI / 2;
  return { minX: box.minX, zc };
});
console.log(`wall test: box west face x=${wall.minX.toFixed(1)}, player z=${wall.zc.toFixed(1)}`);
s = await waitForSettle();
check('camera pulls in against a wall', s.dist < 5.0, `dist ${s.dist.toFixed(2)}m (full is 7.5m)`);
check('camera stays out of the building', !insideBox(s.cx, s.cz, s.boxes) || Math.abs(s.cx - wall.minX) < 0.6,
  `cam at (${s.cx.toFixed(1)},${s.cz.toFixed(1)}), wall at x=${wall.minX.toFixed(1)}`);
check('pulled-in segment unobstructed', !segmentBlocked(s.px, s.pz, s.cx, s.cz, s.boxes));
await page.screenshot({ path: '/tmp/ui-shots/13-camera-wall.png' });
console.log('13-camera-wall.png');

// 3. Step back into the open: the camera pushes back out to full distance.
await page.evaluate(() => {
  window.__game.player.group.position.set(0, 0, 0);
  window.__game.player.heading = Math.PI;
  window.__game.player.group.rotation.y = Math.PI;
});
s = await waitForSettle();
check('camera pushes back out in the open', s.dist > 7.0, `dist ${s.dist.toFixed(2)}m`);

// 4. Driving near a building: same pull-in while driving.
const drove = await page.evaluate(() => {
  const g = window.__game;
  const car = g.cars.find((c) => !c.destroyed);
  if (!car) return false;
  const boxes = g.hud.city.buildingBoxes;
  const box = boxes.find((b) => b.maxX - b.minX >= 30) || boxes[0];
  const zc = (box.minZ + box.maxZ) / 2;
  car.position.set(box.minX - 1, 0, zc);
  car.heading = -Math.PI / 2;
  car.group.rotation.y = car.heading;
  g.player.group.position.set(box.minX - 1, 0, zc + 2);
  return true;
});
if (drove) {
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__game.drivenCar !== null, null, { timeout: 10000 }).catch(() => {});
  const driving = await page.evaluate(() => window.__game.drivenCar !== null);
  if (driving) {
    // Camera target is the car now; measure car->camera distance.
    let ds = await page.evaluate(() => {
      const g = window.__game;
      if (!g.drivenCar) return null;
      const p = g.drivenCar.position, c = g.camera.position;
      return { dist: Math.hypot(c.x - p.x, c.z - p.z), px: p.x, pz: p.z, cx: c.x, cz: c.z, boxes: g.hud.city.buildingBoxes };
    });
    for (let i = 0; i < 40 && ds; i += 1) {
      await page.waitForTimeout(500);
      const n = await page.evaluate(() => {
        const g = window.__game;
        if (!g.drivenCar) return null;
        const p = g.drivenCar.position, c = g.camera.position;
        return { dist: Math.hypot(c.x - p.x, c.z - p.z), px: p.x, pz: p.z, cx: c.x, cz: c.z, boxes: g.hud.city.buildingBoxes };
      });
      if (!n) { ds = null; break; }
      if (Math.abs(n.dist - ds.dist) < 0.05) { ds = n; break; }
      ds = n;
    }
    check('driving camera pulls in near a wall', ds !== null && ds.dist < 5.0, ds ? `dist ${ds.dist.toFixed(2)}m` : 'lost the car');
    check('driving segment unobstructed', ds !== null && !segmentBlocked(ds.px, ds.pz, ds.cx, ds.cz, ds.boxes), ds ? '' : 'lost the car');
  } else {
    check('driving camera pulls in near a wall', false, 'could not enter car');
    check('driving segment unobstructed', false, 'could not enter car');
  }
} else {
  check('driving camera pulls in near a wall', false, 'no car found');
  check('driving segment unobstructed', false, 'no car found');
}

console.log(`\nCAMERA-OBSTACLE: ${pass} PASS / ${fail} FAIL`);
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : '0 console/page errors');
await browser.close();
process.exit(fail ? 1 : 0);
