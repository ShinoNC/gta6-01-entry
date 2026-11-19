// Standalone shot: capture a traffic car MID-OVERTAKE (going around the
// player in the opposite lane). Reuses the playtest-fixes-test setup but
// shoots the moment overtake > 0.5 while the car is alongside the player.
// Run: node tools/overtake-shot.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const OUT = '/tmp/playtest-fixes';
mkdirSync(OUT, { recursive: true });
const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policySha = createHash('sha256').update(readFileSync(POLICY_PATH)).digest('hex');

const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-dev-shm-usage',
    '--force-device-scale-factor=1', `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
    `--hatch-webgl-allowed-domains-sha256=${policySha}`],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.evaluate(() => document.getElementById('start-button').click());
await page.waitForTimeout(1000);
await page.evaluate(() => { window.__game.missions.snoozeBriefing(600); });

// Pick the NPC with the most room ahead, on a line far from the map edge so
// the camera has a good view (avoid the southern edge road).
const npc = await page.evaluate(() => {
  const g = window.__game;
  let best = null;
  let bestRoom = -1;
  for (const c of g.traffic.cars) {
    if (Math.abs(c.line.at) > 100) continue;
    const room = c.direction > 0 ? c.line.to - c.along : c.along - c.line.from;
    if (room > bestRoom) { bestRoom = room; best = c; }
  }
  best.cruiseSpeed = 12;
  best.speed = 12;
  best.car.__mark = 'overtake';
  const p = best.car.position;
  return { x: p.x, z: p.z, line: best.line, direction: best.direction, along: best.along };
});
console.log('car', JSON.stringify(npc));
// Stand in the car's own lane 20m ahead (laneOffsetFor is axis-dependent).
const standAlong = npc.along + npc.direction * 20;
const lane = npc.line.axis === 'z'
  ? (npc.direction > 0 ? -2.5 : 2.5)
  : (npc.direction > 0 ? 2.5 : -2.5);
const standPos = npc.line.axis === 'z'
  ? { x: npc.line.at + lane, z: standAlong }
  : { x: standAlong, z: npc.line.at + lane };
await page.evaluate(([x, z, cx, cz]) => {
  const g = window.__game;
  g.player.group.position.set(x, 0, z);
  // Face the oncoming car so the camera looks down the road at it.
  g.player.heading = Math.atan2(cx - x, cz - z);
  g.player.group.rotation.y = g.player.heading;
  g.wanted.setStars(0);
  g.police.clearAll();
}, [standPos.x, standPos.z, npc.x, npc.z]);
console.log('player stands at', JSON.stringify(standPos), 'facing the car');
let shot = false;
for (let waited = 0; waited < 180000 && !shot; waited += 1000) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(([along0, dir]) => {
    const g = window.__game;
    const best = g.traffic.cars.find((c) => c.car.__mark === 'overtake');
    if (!best) return null;
    return { overtake: best.overtake, speed: best.speed, relAlong: (best.along - along0) * dir, blocked: best.blockedTimer };
  }, [standAlong, npc.direction]);
  if (!st) break;
  if (waited % 10000 === 0) console.log(`${waited / 1000}s relAlong=${st.relAlong.toFixed(1)} speed=${st.speed.toFixed(1)} overtake=${st.overtake.toFixed(2)} blocked=${st.blocked.toFixed(1)}s`);
  if (st.overtake > 0.5 && Math.abs(st.relAlong) < 6) {
    await page.screenshot({ path: `${OUT}/2b-overtake-mid.png` });
    console.log('MID-OVERTAKE SHOT at', `relAlong=${st.relAlong.toFixed(1)} overtake=${st.overtake.toFixed(2)} speed=${st.speed.toFixed(1)}`);
    shot = true;
  }
}
if (!shot) {
  await page.screenshot({ path: `${OUT}/2b-overtake-mid.png` });
  console.log('WARNING: no mid-overtake moment caught in 180s; shot the final frame instead');
}
await browser.close();
