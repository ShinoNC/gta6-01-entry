// Mission-target reachability test: can a player ON FOOT reach every
// mission objective by walking/driving normally (no teleporting)?
// Focus: mission 1 pickup — the browser player walked to the old spot
// (52,26) 3x and it never triggered (wedged between two buildings;
// N/S faces 18.1m away, trigger was 10m). Fixed: target moved to the
// open intersection (52,0), trigger radius 10 -> 15m.
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
const results = [];
function out(line) { results.push(line); console.log(line); }
function check(name, ok, detail = '') { out(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); }
function note(text) { out(`NOTE ${text}`); }

const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.waitForTimeout(500);

// 1. What buildings are near the mission 1 target (52,0)?
const cityInfo = await page.evaluate(() => {
  // buildingBoxes live on the city object; reach it via the HUD's city ref
  const hud = window.__game.hud;
  const boxes = hud.city.buildingBoxes;
  const target = { x: 52, z: 0 };
  const near = boxes
    .map((b) => {
      const nx = Math.max(b.minX, Math.min(target.x, b.maxX));
      const nz = Math.max(b.minZ, Math.min(target.z, b.maxZ));
      const d = Math.hypot(target.x - nx, target.z - nz);
      return { box: b, edgeDist: d };
    })
    .filter((e) => e.edgeDist < 25)
    .sort((a, b) => a.edgeDist - b.edgeDist);
  const inside = boxes.some((b) => target.x >= b.minX && target.x <= b.maxX && target.z >= b.minZ && target.z <= b.maxZ);
  return { inside, near: near.map((e) => ({ box: e.box, edgeDist: +e.edgeDist.toFixed(1) })) };
});
check('M1: pickup (52,0) is NOT inside a building', !cityInfo.inside, `inside=${cityInfo.inside}`);
note(`M1: nearest building edges to (52,0): ${cityInfo.near.map((e) => `box[${e.box.minX}..${e.box.maxX}, ${e.box.minZ}..${e.box.maxZ}] edge ${e.edgeDist}m`).join(' | ')}`);

// 2. Minimum distance a walking player can achieve from each approach.
// The player walks from spawn (0,0) toward (52,26). The direct path crosses
// the block centred (26,26). Compute closest approach from each side.
const approach = await page.evaluate(() => {
  const hud = window.__game.hud;
  const boxes = hud.city.buildingBoxes;
  const target = { x: 52, z: 0 };
  // For each nearby box, the closest a player standing against its faces can get:
  const faces = [];
  for (const b of boxes) {
    if (Math.hypot((b.minX + b.maxX) / 2 - target.x, (b.minZ + b.maxZ) / 2 - target.z) > 40) continue;
    // East face (x = maxX, z clamped to box z-range): player stands at maxX + 0.7
    const ex = b.maxX + 0.7;
    const ez = Math.max(b.minZ, Math.min(target.z, b.maxZ));
    faces.push({ side: `E face of [${b.minX}..${b.maxX},${b.minZ}..${b.maxZ}]`, at: [ex, ez], dist: +Math.hypot(ex - target.x, ez - target.z).toFixed(1) });
    // North face (z = minZ)
    const nx = Math.max(b.minX, Math.min(target.x, b.maxX));
    const nz = b.minZ - 0.7;
    faces.push({ side: `N face of [${b.minX}..${b.maxX},${b.minZ}..${b.maxZ}]`, at: [nx, nz], dist: +Math.hypot(nx - target.x, nz - target.z).toFixed(1) });
    // South face (z = maxZ)
    const sx = Math.max(b.minX, Math.min(target.x, b.maxX));
    const sz = b.maxZ + 0.7;
    faces.push({ side: `S face of [${b.minX}..${b.maxX},${b.minZ}..${b.maxZ}]`, at: [sx, sz], dist: +Math.hypot(sx - target.x, sz - target.z).toFixed(1) });
  }
  faces.sort((a, b) => a.dist - b.dist);
  return faces.slice(0, 6);
});
for (const f of approach) note(`M1 approach: ${f.side} at (${f.at[0]},${f.at[1]}) -> ${f.dist}m from target (trigger needs < 15m)`);
const closest = approach[0]?.dist ?? 99;
check('M1: a player hugging the nearest building face can get within trigger range', closest < 15, `closest approach ${closest}m vs trigger 15m`);

// 3. REAL WALK: accept mission 1, walk on foot from spawn toward the target
// along the direct line (like the browser player did). Does it trigger?
await page.click('#start-button');
await page.waitForTimeout(400);
// Poll for the phone (snooze is 8 game-seconds; headless runs ~0.14x, so
// this can take ~60s+; waitForSelector proved flaky under slow headless).
let phoneUp = false;
for (let i = 0; i < 60 && !phoneUp; i += 1) {
  await page.waitForTimeout(5000);
  phoneUp = await page.evaluate(() => !document.getElementById('phone-panel').classList.contains('hidden'));
}
check('M1: phone briefing appears after the 8s snooze', phoneUp);
if (!phoneUp) { await browser.close(); process.exit(1); }
await page.click('#phone-accept');
await page.waitForTimeout(400);
const missionActive = await page.evaluate(() => window.__game.missions.currentMission()?.name);
note(`M1 walk test: mission active = ${missionActive}, target = ${JSON.stringify(await page.evaluate(() => window.__game.missions.target))}`);
// Run east along the z=0 road — the target (52,0) is ON this road, the
// natural route from spawn. Hold Shift+D (strafe right = +x when facing -z).
// 37m to the trigger edge at ~0.6 m/s headless run speed needs ~62s; allow 80s.
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('KeyD');
await page.waitForTimeout(80000);
await page.keyboard.up('KeyD');
await page.keyboard.up('ShiftLeft');
const leg1 = await page.evaluate(() => ({
  x: +window.__game.player.position.x.toFixed(1), z: +window.__game.player.position.z.toFixed(1),
  done: window.__game.missions.doneCount(),
  dist: +Math.hypot(window.__game.player.position.x - 52, window.__game.player.position.z - 0).toFixed(1),
}));
note(`M1 walk: after running east 80s -> (${leg1.x}, ${leg1.z}), ${leg1.dist}m from target, missions done=${leg1.done}`);
check('M1: running the road route on foot triggers the pickup', leg1.done === 1, `ended ${leg1.dist}m from target, done=${leg1.done}`);
const leg2 = leg1;

// 4. Stand exactly at the closest building-face approach point and check the trigger.
if (leg2.done !== 1) {
  const face = approach[0];
  await page.evaluate((at) => {
    window.__game.player.group.position.set(at[0], 0, at[1]);
  }, face.at);
  await page.waitForTimeout(2000);
  const faceDone = await page.evaluate(() => window.__game.missions.doneCount());
  check('M1: standing at the closest building-face point triggers the pickup', faceDone === 1, `stood at (${face.at[0]},${face.at[1]}), ${face.dist}m from target, done=${faceDone}`);
}

// 5. All mission targets: is each within trigger range of a road/beach point?
const allTargets = await page.evaluate(() => {
  const hud = window.__game.hud;
  const boxes = hud.city.buildingBoxes;
  const targets = [
    ['M1', 52, 0], ['M2a', -52, 70], ['M2b', 104, 70], ['M3b', -104, -104],
    ['M5a', 130, 70], ['M5c', 52, 0], ['M6b', 104, -104], ['M7a', 104, -104],
    ['M7b', -52, -104], ['M7c', -104, 26], ['M8a', -52, 70], ['M8c', 130, 52],
  ];
  return targets.map(([name, x, z]) => {
    const inside = boxes.some((b) => x >= b.minX && x <= b.maxX && z >= b.minZ && z <= b.maxZ);
    // closest reachable point: sample the roads (x in road centres or z in road centres) and beach (z>=58)
    let best = 99;
    const roadX = [-156, -104, -52, 0, 52, 104, 156];
    const roadZ = [-156, -104, -52, 0, 52];
    for (const rx of roadX) {
      const d = Math.hypot(rx - x, 0);
      if (z >= -162 && z <= 52) best = Math.min(best, Math.abs(rx - x));
    }
    for (const rz of roadZ) {
      if (x >= -162 && x <= 162) best = Math.min(best, Math.abs(rz - z));
    }
    if (z >= 58) best = 0; // on the beach, open ground
    if (z >= 52 && z < 58) best = Math.min(best, 58 - z); // beach road edge
    return { name, x, z, inside, closestRoad: +best.toFixed(1) };
  });
});
for (const t of allTargets) {
  check(`${t.name} target (${t.x},${t.z}) reachable within 15m`, !t.inside && t.closestRoad < 15, `inside building=${t.inside}, closest road/beach ${t.closestRoad}m`);
}

check('zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ') : '');
console.log(`\n${results.filter((r) => r.startsWith('FAIL')).length} FAILURES`);
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
