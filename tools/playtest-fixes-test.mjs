// Tests for the 31-minute browser playtest fixes + contrast pass:
// 1. mission beacon bright + floating diamond + HUD guidance (distance + arrow)
// 2. F prompt when a car is in range + measured F range (centre + door side)
// 3. traffic overtakes a blocked player instead of queuing forever
// 4. police panel cleared after BUSTED (no stale PURSUIT rows)
// 5. title controls strip: key+label never split across lines (1280 + 1024 wide)
// 6. contrast: HUD clusters have dark backing, title lines are white
// 7. minimap: mission marker white, business gold (pixel check on the big map)
// Run: node tools/playtest-fixes-test.mjs
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
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

const results = [];
let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(results[results.length - 1]);
}
function note(name, detail = '') {
  console.log(`INFO ${name}${detail ? ` — ${detail}` : ''}`);
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.waitForTimeout(1500);

// --- 5+6. Title checks (before starting the game) ---
// The title screen is clean now: no controls bar, no judge note — the
// controls list lives in the CONTROLS tab of the settings panel.
async function titleChecks(width) {
  await page.setViewportSize({ width, height: 720 });
  await page.waitForTimeout(800);
  const r = await page.evaluate(() => ({
    hasControlsBar: [...document.querySelectorAll('#title-screen .controls')].some((el) => el.textContent.includes('W/S')),
    hasJudgeNote: Boolean(document.querySelector('.judge-note')),
    settingsButton: document.getElementById('settings-button')?.textContent || '',
    featureColor: getComputedStyle(document.querySelector('.feature-line')).color,
    savesColor: getComputedStyle(document.querySelector('#continue-summary')).color,
    savesBg: getComputedStyle(document.querySelector('#continue-summary')).backgroundColor,
  }));
  check(`title has no controls bar at ${width}px`, !r.hasControlsBar);
  check(`title has no judge note at ${width}px`, !r.hasJudgeNote);
  if (width === 1280) {
    check('SETTINGS button on the title menu', r.settingsButton === 'SETTINGS', r.settingsButton);
    check('feature line is white', r.featureColor === 'rgb(255, 255, 255)', r.featureColor);
    check('SAVES line is white', r.savesColor === 'rgb(255, 255, 255)', r.savesColor);
    check('SAVES bar has dark backing', r.savesBg === 'rgba(26, 16, 48, 0.6)', r.savesBg);
  }
}
await titleChecks(1280);
await titleChecks(1024);
await page.setViewportSize({ width: 1280, height: 720 });
await page.waitForTimeout(500);
// The controls list now lives in the CONTROLS tab: every row must render
// on one line with no horizontal overflow.
await page.evaluate(() => document.getElementById('settings-button').click());
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector('.settings-tab[data-tab="controls"]').click());
await page.waitForTimeout(300);
const controlsRows = await page.evaluate(() => {
  const panel = document.getElementById('controls-tab-panel');
  const rows = [...panel.querySelectorAll('.controls-row')].map((row) => {
    const label = row.children[0].getBoundingClientRect();
    const chip = row.children[1].getBoundingClientRect();
    // Compare vertical CENTRES, not tops: the row is flex with
    // align-items:center, and the chip is taller than the label (padding +
    // border), so centred children have different tops on the same line.
    const labelCy = label.top + label.height / 2;
    const chipCy = chip.top + chip.height / 2;
    return { label: row.children[0].textContent, sameLine: Math.abs(labelCy - chipCy) <= 2 };
  });
  return { rows, overflow: panel.scrollWidth > panel.clientWidth + 1 };
});
const splitRows = controlsRows.rows.filter((r) => !r.sameLine);
check('controls tab rows render on one line', splitRows.length === 0 && controlsRows.rows.length >= 12, splitRows.length ? `split: ${splitRows.map((r) => r.label).join(',')}` : `${controlsRows.rows.length} rows`);
check('controls tab has no horizontal overflow', !controlsRows.overflow);
await page.evaluate(() => document.getElementById('settings-back').click());
await page.waitForTimeout(300);

await page.evaluate(() => document.getElementById('start-button').click());
await page.waitForTimeout(1000);
await page.evaluate(() => { window.__game.missions.snoozeBriefing(600); });

// --- 6. HUD cluster backing ---
const hudBg = await page.evaluate(() => {
  const cs = (id) => getComputedStyle(document.getElementById(id)).backgroundColor;
  return { topLeft: cs('hud-top-left'), topRight: cs('hud-top-right'), speedo: cs('hud-speedo') };
});
check('HUD top-left has dark backing', hudBg.topLeft === 'rgba(26, 16, 48, 0.85)', hudBg.topLeft);
check('HUD top-right has dark backing', hudBg.topRight === 'rgba(26, 16, 48, 0.85)', hudBg.topRight);
check('HUD speedo has dark backing', hudBg.speedo === 'rgba(26, 16, 48, 0.62)', hudBg.speedo);

// --- 1. Beacon: bright pillar + floating diamond ---
const beacon = await page.evaluate(() => {
  const b = window.__game.missions.beacon;
  return {
    visible: b.group.visible,
    pillarOpacity: b.pillar.material.opacity,
    pillarH: b.pillar.geometry.parameters.height,
    pillarR: b.pillar.geometry.parameters.radiusTop,
    hasDiamond: Boolean(b.diamond) && b.diamond.geometry.type === 'OctahedronGeometry',
    diamondY: b.diamond ? b.diamond.position.y : null,
    ringInner: b.ring.geometry.parameters.innerRadius,
    blending: b.pillar.material.blending,
  };
});
note('beacon', JSON.stringify(beacon));
check('beacon visible in free roam', beacon.visible);
check('beacon pillar opacity is near-solid (0.75-0.95)', beacon.pillarOpacity >= 0.75 && beacon.pillarOpacity <= 0.95, `opacity ${beacon.pillarOpacity.toFixed(2)}`);
check('beacon pillar is tall + wide (45m x r2.5)', beacon.pillarH === 45 && beacon.pillarR === 2.5, `${beacon.pillarH}m r${beacon.pillarR}`);
check('beacon has floating diamond', beacon.hasDiamond, `diamond y=${beacon.diamondY}`);

// Beacon visible from spawn: project the marker to screen space and shoot it.
const beaconShot = await page.evaluate(() => {
  const g = window.__game;
  g.player.group.position.set(0, 0, -8);
  g.player.heading = Math.atan2(52 - 0, 0 - -8);
  g.player.group.rotation.y = g.player.heading;
  return { marker: g.missions.target };
});
note('marker target', JSON.stringify(beaconShot.marker));
// Wait for the camera to settle behind the player (yaw -> heading + PI).
for (let i = 0; i < 30; i += 1) {
  const settled = await page.evaluate(() => {
    const g = window.__game;
    const want = g.player.heading + Math.PI;
    let d = Math.abs(g.chaseCamera.yaw - want) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d < 0.15;
  });
  if (settled) break;
  await page.waitForTimeout(1000);
}
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/1-beacon-from-spawn.png` });
console.log('shot 1-beacon-from-spawn.png (eyeball: gold pillar + diamond must be visible)');

// --- 1b. HUD guidance: distance + arrow, geometrically correct ---
async function guidanceArrow() {
  return page.evaluate(() => document.getElementById('hud-objective').textContent);
}
const objText = await guidanceArrow();
note('objective text', objText);
check('objective shows distance + arrow', /\d+m [↑→↓←]/.test(objText), objText);
// Face the marker -> arrow must be UP; face away -> DOWN; marker on the
// right -> RIGHT. Player stands west of the marker (12,0), marker at (52,0).
async function faceHeading(heading) {
  await page.evaluate((h) => {
    const g = window.__game;
    g.player.group.position.set(12, 0, 0);
    g.player.heading = h;
    g.player.group.rotation.y = h;
  }, heading);
  for (let i = 0; i < 30; i += 1) {
    const settled = await page.evaluate((h) => {
      const g = window.__game;
      let d = Math.abs(g.chaseCamera.yaw - (h + Math.PI)) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      return d < 0.15;
    }, heading);
    if (settled) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(800);
  return guidanceArrow();
}
// Marker is due east (+x) of the player: face east (heading atan2(40,0)=PI/2).
const facingMarker = await faceHeading(Math.PI / 2);
check('arrow UP when facing the marker', /↑/.test(facingMarker), facingMarker);
const facingAway = await faceHeading(-Math.PI / 2);
check('arrow DOWN when facing away', /↓/.test(facingAway), facingAway);
// Face +z (heading 0): forward=(0,0,1), screen-right is -x, so the marker
// due east (+x) is on the LEFT. Face -z (heading PI): east is on the right.
const facingPlusZ = await faceHeading(0);
check('arrow LEFT when marker is on the left', /←/.test(facingPlusZ), facingPlusZ);
const facingMinusZ = await faceHeading(Math.PI);
check('arrow RIGHT when marker is on the right', /→/.test(facingMinusZ), facingMinusZ);
const distCheck = await page.evaluate(() => {
  const g = window.__game;
  const p = g.player.position;
  const t = g.missions.target;
  const actual = Math.round(Math.hypot(t.x - p.x, t.z - p.z));
  const shown = document.getElementById('hud-objective').textContent.match(/(\d+)m/);
  return { actual, shown: shown ? Number(shown[1]) : null };
});
check('distance matches actual player-to-marker distance', distCheck.shown !== null && Math.abs(distCheck.shown - distCheck.actual) <= 1, `shown ${distCheck.shown}m, actual ${distCheck.actual}m`);

// --- 2. F prompt + measured F range ---
// Pick a parked car the sweep can measure cleanly: no other car within 12m,
// open ground east of it, and no traffic line crossing the sweep. Traffic
// only drives on roads, so the sweep line (z = car.z) must clear every
// E-W road corridor, and the car must face along a N-S road (heading ~0
// or ~PI) so its door side points off-road too. (The cruiser at (104,0)
// failed both: E-W traffic on z=0 crossed the sweep and N-S traffic on
// x=104 crossed the door side.)
const parked = await page.evaluate(() => {
  const g = window.__game;
  const boxes = g.hud.city.buildingBoxes;
  const ewRoadZ = g.traffic.lines.filter((l) => l.axis === 'x').map((l) => l.at);
  let best = null;
  let bestGap = -1;
  let fallback = null;
  let fallbackGap = -1;
  for (const car of g.cars) {
    if (car.destroyed || car.driven) continue;
    let gap = Infinity;
    for (const other of g.cars) {
      if (other === car) continue;
      gap = Math.min(gap, Math.hypot(other.position.x - car.position.x, other.position.z - car.position.z));
    }
    for (const npc of g.traffic.cars) gap = Math.min(gap, Math.hypot(npc.car.position.x - car.position.x, npc.car.position.z - car.position.z));
    if (gap > fallbackGap) { fallbackGap = gap; fallback = car; }
    // The +x range sweep needs genuinely open ground east of the car: if
    // the 9m point is inside a building, resolveCircle pushes the player
    // back toward the car (the roadster at the map edge pushed 9m -> 6.3m,
    // inside the 8m latch range) and the sweep measures nothing.
    const clearEast = [3, 6, 9].every((d) => !boxes.some((b) =>
      car.position.x + d > b.minX && car.position.x + d < b.maxX &&
      car.position.z > b.minZ && car.position.z < b.maxZ));
    const clearOfTraffic = ewRoadZ.every((z) => Math.abs(car.position.z - z) > 6);
    const facesNorthSouth = Math.abs(Math.sin(car.heading)) < 0.2;
    if (!clearEast || !clearOfTraffic || !facesNorthSouth || car.position.x + 10 > 156) continue;
    if (gap > bestGap) { bestGap = gap; best = car; }
  }
  const pick = best || fallback;
  return { x: pick.position.x, z: pick.position.z, name: pick.name, heading: pick.heading, gap: best ? bestGap : fallbackGap, ideal: Boolean(best) };
});
note('parked car for F test', `${parked.name} at (${parked.x.toFixed(1)},${parked.z.toFixed(1)}) heading ${parked.heading.toFixed(2)}, nearest neighbour ${parked.gap.toFixed(1)}m${parked.ideal ? '' : ' (no ideal car — sweep may be noisy)'}`);
async function ensureOnFoot() {
  if (await page.evaluate(() => window.__game.drivenCar !== null)) {
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(800);
  }
  await page.evaluate(() => { window.__game.wanted.setStars(0); window.__game.police.clearAll(); });
  await page.waitForTimeout(300);
}
async function tryFAt(x, z) {
  await ensureOnFoot();
  await page.evaluate(([px, pz]) => { window.__game.player.group.position.set(px, 0, pz); }, [x, z]);
  await page.waitForTimeout(1200);
  // The prompt refreshes on a 0.6s cycle with a 1-frame gap each cycle; in
  // headless (slow frames) that gap is ~25% of the time, so poll instead of
  // sampling once. A real player sees at most a 16ms shimmer per cycle.
  let prompt = { visible: false, text: '' };
  for (let i = 0; i < 5; i += 1) {
    prompt = await page.evaluate(() => {
      const el = document.getElementById('hud-message');
      return { visible: el.classList.contains('visible'), text: el.textContent };
    });
    if (prompt.visible && /Press F to (drive|steal)/.test(prompt.text)) break;
    await page.waitForTimeout(500);
  }
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(1200);
  const entered = await page.evaluate(([tx, tz]) => {
    const d = window.__game.drivenCar;
    if (!d) return null;
    // Only counts if the player entered the TARGET car (another car nearby
    // would be a false positive for the range measurement).
    return Math.hypot(d.position.x - tx, d.position.z - tz) < 1 ? d.name : `WRONG CAR ${d.name}`;
  }, [parked.x, parked.z]);
  return { prompt, entered };
}
// Prompt visible 2m from the car centre.
const near = await tryFAt(parked.x + 2, parked.z);
check('F prompt shows near a car', near.prompt.visible && /Press F to (drive|steal)/.test(near.prompt.text), `${near.prompt.visible ? near.prompt.text : '(hidden)'}`);
check('F enters the car at 2m from centre', Boolean(near.entered) && !near.entered.startsWith('WRONG'), near.entered || 'not entered');
// Range sweep from the car CENTRE along +x (behind the car — it faces -x,
// so the bumper is 2.1m out and the edge distance is d-2.1m). F measures
// to the car's nearest point (fix batch 5): base range 5m, latch 8m for
// 1.5s after the prompt showed. So 5.1m/6m succeed on the base range
// (edges 3.0m/3.9m), and 11m (edge 8.9m) is past the latch range.
const sweep = [];
for (const d of [3, 4, 4.9, 5.1, 6, 11]) {
  const r = await tryFAt(parked.x + d, parked.z);
  sweep.push(`${d}m:${!r.entered ? 'no' : r.entered.startsWith('WRONG') ? 'WRONG' : 'IN'}`);
}
note('F range from centre (+x)', sweep.join(' '));
// Door-side sweep: perpendicular to the car's heading (the door is ~1m out).
const doorFx = Math.cos(parked.heading);
const doorFz = -Math.sin(parked.heading);
const doorSweep = [];
for (const d of [1.5, 2.5, 3.5, 4.5]) {
  const r = await tryFAt(parked.x + doorFx * d, parked.z + doorFz * d);
  doorSweep.push(`${d}m:${!r.entered ? 'no' : r.entered.startsWith('WRONG') ? 'WRONG' : 'IN'}`);
}
note('F range from door side', doorSweep.join(' '));
check('F works at 4m from centre', sweep[1].endsWith('IN'), sweep.join(' '));
check('F latch: a car that just showed its prompt stays grabbable at 6m', sweep[4].endsWith('IN'), sweep.join(' '));
check('F fails past the 8m latch range (11m from centre = 8.9m from the bumper)', sweep[5].endsWith('no'), sweep.join(' '));
// The door sweep's last step (4.5m) SUCCEEDS, so the player is still IN the
// car here. Exit it first: while driving, the traffic obstacles list holds
// the driven car instead of the player, so a teleported player group would
// be invisible to traffic (both earlier runs tested nothing for this reason).
await ensureOnFoot();
const onFoot = await page.evaluate(() => window.__game.drivenCar === null);
check('player is on foot before the no-car check', onFoot);
// Prompt hidden when no car is near: teleport to a spot far from every car.
const farSpot = await page.evaluate(() => {
  const g = window.__game;
  const spots = [[-140, 40], [140, 40], [-140, -140], [140, -140], [0, 80]];
  let bestSpot = spots[0];
  let bestGap = -1;
  for (const [x, z] of spots) {
    let gap = Infinity;
    for (const car of g.cars) gap = Math.min(gap, Math.hypot(car.position.x - x, car.position.z - z));
    if (gap > bestGap) { bestGap = gap; bestSpot = [x, z]; }
  }
  g.player.group.position.set(bestSpot[0], 0, bestSpot[1]);
  return { spot: bestSpot, gap: bestGap };
});
await page.waitForTimeout(2000);
const farPrompt = await page.evaluate(() => {
  const el = document.getElementById('hud-message');
  return { visible: el.classList.contains('visible'), text: el.textContent };
});
check('F prompt hidden when no car is near', !farPrompt.visible || !/Press F to/.test(farPrompt.text), `gap ${farSpot.gap.toFixed(1)}m, msg: ${farPrompt.visible ? farPrompt.text : '(hidden)'}`);

// --- 3. Traffic overtake: player stands in the road, car must pass ---
const npc = await page.evaluate(() => {
  const g = window.__game;
  let best = null;
  let bestRoom = -1;
  for (const c of g.traffic.cars) {
    const room = c.direction > 0 ? c.line.to - c.along : c.along - c.line.from;
    if (room > bestRoom) { bestRoom = room; best = c; }
  }
  best.cruiseSpeed = 12;
  best.speed = 12;
  best.stoppedTimer = 0;
  best.car.__mark = 'overtake';
  const p = best.car.position;
  return { x: p.x, z: p.z, line: best.line, direction: best.direction, along: best.along, speed: best.speed };
});
note('overtake test car', `at (${npc.x.toFixed(1)},${npc.z.toFixed(1)}) along=${npc.along.toFixed(1)} dir=${npc.direction} axis=${npc.line.axis} at=${npc.line.at}`);
// Stand IN the car's own lane 20m ahead of it. laneOffsetFor is
// axis-dependent: axis=x, dir>0 -> +2.5; axis=z, dir>0 -> -2.5 (the mirror
// of what a first reading of placeOnRoad suggests — both earlier runs got
// this wrong in opposite directions).
const standAlong = npc.along + npc.direction * 20;
const lane = npc.line.axis === 'z'
  ? (npc.direction > 0 ? -2.5 : 2.5)
  : (npc.direction > 0 ? 2.5 : -2.5);
const standPos = npc.line.axis === 'z'
  ? { x: npc.line.at + lane, z: standAlong }
  : { x: standAlong, z: npc.line.at + lane };
await page.evaluate(([x, z]) => {
  const g = window.__game;
  g.player.group.position.set(x, 0, z);
  g.wanted.setStars(0);
  g.police.clearAll();
}, [standPos.x, standPos.z]);
note('player stands in the road', `at (${standPos.x.toFixed(1)},${standPos.z.toFixed(1)}), car 20m behind`);
await page.waitForTimeout(1500);
const standCheck = await page.evaluate(([x, z]) => {
  const g = window.__game;
  const p = g.player.position;
  return { onFoot: g.drivenCar === null, dx: p.x - x, dz: p.z - z };
}, [standPos.x, standPos.z]);
check('player on foot at the stand spot (setup)', standCheck.onFoot && Math.abs(standCheck.dx) < 1 && Math.abs(standCheck.dz) < 1, `onFoot=${standCheck.onFoot} offset=(${standCheck.dx.toFixed(1)},${standCheck.dz.toFixed(1)})`);
let passedAt = null;
let maxBlocked = 0;
let maxOvertake = 0;
const overtakeStart = Date.now();
for (let waited = 0; waited < 180000; waited += 2000) {
  await page.waitForTimeout(2000);
  const st = await page.evaluate(([along0, dir]) => {
    const g = window.__game;
    const best = g.traffic.cars.find((c) => c.car.__mark === 'overtake');
    if (!best) return null;
    return { along: best.along, speed: best.speed, overtake: best.overtake, overtakeTimer: best.overtakeTimer, blockedTimer: best.blockedTimer, relAlong: (best.along - along0) * dir };
  }, [standAlong, npc.direction]);
  if (!st) break;
  maxBlocked = Math.max(maxBlocked, st.blockedTimer);
  maxOvertake = Math.max(maxOvertake, st.overtake);
  if (st.relAlong > 2) { passedAt = (Date.now() - overtakeStart) / 1000; note('car passed the player', `after ${passedAt.toFixed(0)}s real time, overtake=${st.overtake.toFixed(2)} speed=${st.speed.toFixed(1)}`); break; }
  if (waited % 20000 === 0) note('overtake wait', `${waited / 1000}s: relAlong=${st.relAlong.toFixed(1)} speed=${st.speed.toFixed(1)} overtake=${st.overtake.toFixed(2)} blocked=${st.blockedTimer.toFixed(1)}s`);
}
check('traffic car overtakes and passes a standing player', passedAt !== null, passedAt ? `passed after ${passedAt.toFixed(0)}s real time` : 'STILL STUCK after 180s');
check('overtake mechanism actually engaged (lane shift)', maxOvertake > 0.5, `max overtake=${maxOvertake.toFixed(2)}, max blocked=${maxBlocked.toFixed(1)}s game time`);
await page.screenshot({ path: `${OUT}/2-traffic-overtake.png` });

// --- 4. Police panel cleared after BUSTED ---
await page.evaluate(() => {
  const g = window.__game;
  g.player.group.position.set(0, 0, -8);
  g.wanted.setStars(1);
});
let pursuitSeen = false;
for (let i = 0; i < 30; i += 1) {
  pursuitSeen = await page.evaluate(() => window.__game.police.pursuit.length > 0);
  if (pursuitSeen) break;
  await page.waitForTimeout(1000);
}
check('pursuit spawns at 1 star (setup)', pursuitSeen);
await page.evaluate(() => { window.__game.endRun('BUSTED'); });
await page.waitForTimeout(1000);
const afterBusted = await page.evaluate(() => ({
  title: document.getElementById('down-title').textContent,
  pursuit: window.__game.police.pursuit.length,
  roadblock: window.__game.police.roadblock.length,
  heli: window.__game.police.helicopter !== null,
  panelHidden: document.getElementById('hud-police').classList.contains('hidden'),
  units: window.__game.police.units(window.__game.player.position).length,
}));
check('BUSTED screen shows', afterBusted.title === 'BUSTED', afterBusted.title);
check('BUSTED clears all pursuit units', afterBusted.pursuit === 0 && afterBusted.roadblock === 0 && !afterBusted.heli, `pursuit=${afterBusted.pursuit} roadblock=${afterBusted.roadblock} heli=${afterBusted.heli}`);
check('BUSTED clears the police panel', afterBusted.panelHidden && afterBusted.units === 0, `hidden=${afterBusted.panelHidden} units=${afterBusted.units}`);
await page.evaluate(() => document.getElementById('down-button').click());
await page.waitForTimeout(3000);
const afterContinue = await page.evaluate(() => ({
  state: window.__game.state,
  panelHidden: document.getElementById('hud-police').classList.contains('hidden'),
  units: window.__game.police.units(window.__game.player.position).length,
  stars: window.__game.wanted.stars,
}));
check('police panel stays clear after CONTINUE', afterContinue.state === 'play' && afterContinue.panelHidden && afterContinue.units === 0, JSON.stringify(afterContinue));
await page.screenshot({ path: `${OUT}/3-after-busted.png` });

// --- 7. Minimap pixels: mission white, business gold ---
await page.keyboard.press('KeyN');
await page.waitForTimeout(1000);
const mapPixels = await page.evaluate(() => {
  const canvas = document.getElementById('bigmap');
  const ctx = canvas.getContext('2d');
  const g = window.__game;
  // Use the game's own projection: the map bounds/canvas changed with the
  // 12x12 island (old hardcoded 1024x816 / ±162 geometry is stale).
  const toMap = (x, z) => g.hud.toMap(x, z, canvas.width, canvas.height, g.hud.mapView);
  const sample = (x, z) => {
    const p = toMap(x, z);
    const d = ctx.getImageData(Math.round(p.x), Math.round(p.y), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const mission = g.missions.target;
  const biz = g.businesses.defs[0];
  return {
    missionPos: mission,
    missionPx: mission ? sample(mission.x, mission.z) : null,
    bizPos: { x: biz.x, z: biz.z },
    bizPx: sample(biz.x, biz.z),
  };
});
note('map pixels', JSON.stringify(mapPixels));
const isWhite = (px) => px && px[0] > 240 && px[1] > 240 && px[2] > 240;
const isGold = (px) => px && px[0] > 240 && px[1] > 200 && px[1] < 230 && px[2] > 100 && px[2] < 140;
check('mission marker on the map is WHITE', isWhite(mapPixels.missionPx), `px=${JSON.stringify(mapPixels.missionPx)} at ${JSON.stringify(mapPixels.missionPos)}`);
check('business marker on the map is GOLD', isGold(mapPixels.bizPx), `px=${JSON.stringify(mapPixels.bizPx)} at ${JSON.stringify(mapPixels.bizPos)}`);
await page.screenshot({ path: `${OUT}/4-bigmap.png` });
await page.keyboard.press('KeyN');
await page.waitForTimeout(400);

// --- Arrival: guidance + beacon lead to a real briefing ---
await page.evaluate(() => { window.__game.missions.snoozeBriefing(0); });
await page.evaluate(() => { window.__game.player.group.position.set(52, 0, 0); });
let briefingShown = false;
for (let i = 0; i < 20; i += 1) {
  briefingShown = await page.evaluate(() => !document.getElementById('phone-panel').classList.contains('hidden'));
  if (briefingShown) break;
  await page.waitForTimeout(1000);
}
check('briefing appears on arrival at the marker', briefingShown);
await page.screenshot({ path: `${OUT}/5-briefing.png` });

console.log(`\n${results.filter((r) => r.startsWith('PASS')).length} passed, ${failures} failed. Console errors: ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 10).join('\n'));
await browser.close();
process.exit(failures > 0 || errors.length > 0 ? 1 : 0);
