// Fix-batch 5 test (20/11): live check #6 found 4 items on the fix-round-4
// build — (A) the dispatch banner STILL overlapped the objective line
// (round 4 moved #hud-message to top:120px, but the HUD block's bottom edge
// is 132-190px with a wrapped objective); (B) F said "No car nearby" at
// the M1 pickup with cars visibly next to the player (F measured to the
// car's centre — 2.1m past the bumper — not to its nearest point);
// (C) the camera clipped into walls in narrow alleys (the lerp path to a
// collision-safe target still crossed buildings during turns); (D) the
// full-map legend omits the yellow parked-car and grey traffic squares.
// Plus the user's playtest feedback: (E) crosshair on the head, (F) police
// uniforms, (G) trees in the road, (H) uneven menu buttons, (I) confusing
// SAVE SLOT button, (J) no drive-by, (K) fake headlights for traffic and
// police, (L) gunfire witness rule, (M) night density scaling, (N) the
// VICE CUTS barbershop, (O) the tabbed settings panel + clean title, and
// (P) windows that glow at night.
// Run: node tools/fixbatch5-test.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const GAME_URL = 'file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?seed=1';
const SHOTS = '/home/hatch/workspace/makefun/gta6-01/bugcheck-20261119/fixbatch5-shots';
mkdirSync(SHOTS, { recursive: true });

const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policySha = createHash('sha256').update(readFileSync(POLICY_PATH)).digest('hex');
const LAUNCH_ARGS = ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-dev-shm-usage',
  '--force-device-scale-factor=1', `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
  `--hatch-webgl-allowed-domains-sha256=${policySha}`];
let browser;
let page;
const errors = [];
async function launchBrowser() {
  browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: LAUNCH_ARGS });
  page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
}
await launchBrowser();

const results = [];
let fails = 0;
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(results[results.length - 1]);
  if (!ok) fails += 1;
}
function note(text) { console.log(`NOTE ${text}`); }
// Screenshots are evidence, not assertions: a stalled renderer (ReadPixels
// stall under 12x12 load) must not kill the suite. Retry once, then continue.
async function shot(pg, path) {
  try { await pg.screenshot({ path, timeout: 60000 }); }
  catch (e) {
    note(`screenshot ${path.split('/').pop()} timed out — retrying`);
    try { await pg.screenshot({ path, timeout: 60000 }); }
    catch (e2) { note(`screenshot ${path.split('/').pop()} failed twice, continuing`); }
  }
}
const ev = (fn, arg) => page.evaluate(fn, arg);
async function loadGame() {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
      await page.waitForTimeout(500);
      return;
    } catch (e) {
      if (attempt === 1) throw e;
      note(`loadGame failed (${e.message.slice(0, 80)}) — relaunching the browser`);
      try { await browser.close(); } catch { /* already dead */ }
      await launchBrowser();
    }
  }
}
async function newGame() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(() => document.getElementById('start-button')?.click());
    await page.waitForTimeout(300);
    if (await ev(() => window.__game.state === 'play')) return true;
  }
  return ev(() => window.__game.state === 'play');
}
async function startM1() {
  await ev(() => { window.__game.player.group.position.set(52, 0, 0); });
  await page.waitForTimeout(800);
  await page.evaluate(() => document.getElementById('phone-accept')?.click());
  await page.waitForTimeout(500);
  return ev(() => window.__game.missions.currentMission()?.name === 'FIRST FARE');
}
async function ensureOnFoot() {
  if (await ev(() => window.__game.drivenCar !== null)) {
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(800);
  }
}

// ---- A. Dispatch banner clears the objective line at every viewport ----
async function bannerAt(width, height, label, expectedTop) {
  const p = await browser.newPage({ viewport: { width, height } });
  p.on('pageerror', (e) => errors.push(`PAGEERROR(${label}): ${e.message}`));
  await p.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('start-button')?.click());
  await p.waitForTimeout(500);
  await p.evaluate(() => { window.__game.player.group.position.set(52, 0, 0); });
  await p.waitForTimeout(800);
  await p.evaluate(() => document.getElementById('phone-accept')?.click());
  await p.waitForTimeout(500);
  await p.evaluate(() => { window.__game.hud.showMessage('BANK ROBBERY — Stop the getaway car! $500 REWARD', 30, true); });
  await p.waitForTimeout(400);
  const boxes = await p.evaluate(() => {
    const r = (id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), h: Math.round(b.height) };
    };
    return {
      top: getComputedStyle(document.getElementById('hud-message')).top,
      block: r('hud-top-left'),
      msg: r('hud-message'),
      visible: document.getElementById('hud-message').classList.contains('visible'),
    };
  });
  note(`${label}: block bottom=${boxes.block.bottom}, banner top=${boxes.msg.top} bottom=${boxes.msg.bottom} h=${boxes.msg.h}, computed top=${boxes.top}`);
  await shot(p, `${SHOTS}/banner-${label}.png`);
  await p.close();
  check(`${label}: banner pinned to top:${expectedTop}`, boxes.top === expectedTop, `top=${boxes.top}`);
  check(`${label}: banner clears the HUD block (no overlap with the objective line)`,
    boxes.msg.top >= boxes.block.bottom + 4, `bannerTop=${boxes.msg.top} blockBottom=${boxes.block.bottom}`);
  check(`${label}: banner stays in the upper half (top < 50% viewport height)`,
    boxes.msg.top < height * 0.5, `bannerTop=${boxes.msg.top} viewportH=${height}`);
  check(`${label}: banner is a slim strip, not a centre box (height <= 80px)`,
    boxes.msg.h <= 80, `h=${boxes.msg.h}`);
  return boxes;
}
await bannerAt(1280, 720, '1280x720', '150px');
await bannerAt(768, 768, '768x768', '180px');
await bannerAt(768, 432, '768x432', '180px');
await bannerAt(480, 800, '480x800', '270px');

// ---- B. F at the M1 pickup (live check #6 regression) ----
await loadGame();
check('NEW GAME starts (F-at-pickup test)', await newGame());
check('M1 starts (F-at-pickup test)', await startM1());
// B1: on the pickup point, the CORAL CRUISER is right there.
await ev(() => { window.__game.player.group.position.set(104, 0, 0); });
await page.waitForTimeout(600);
await page.keyboard.press('KeyF');
await page.waitForTimeout(500);
check('F at the pickup enters the CORAL CRUISER (was: "No car nearby" live)',
  await ev(() => window.__game.drivenCar?.name === 'CORAL CRUISER'),
  `driving ${await ev(() => window.__game.drivenCar?.name ?? 'nothing')}`);
await ensureOnFoot();
// B2: cruiser driven away; two queued traffic cars are all that is left.
await ev(() => {
  const g = window.__game;
  g.cars.find((c) => c.name === 'CORAL CRUISER').group.position.set(0, 0, 0);
  const road = g.traffic.lines.find((l) => l.axis === 'z' && l.at === 104);
  const [n1, n2] = g.traffic.cars;
  n1.line = road; n1.along = 3; n1.direction = -1; n1.speed = 0;
  n2.line = road; n2.along = -3; n2.direction = 1; n2.speed = 0;
  g.player.group.position.set(104, 0, 0);
});
await page.waitForTimeout(1500);
const queued = await ev(() => {
  const g = window.__game;
  const p = g.player.group.position;
  return g.traffic.cars.slice(0, 2).map((n) => ({ name: n.car.name, dist: +Math.hypot(n.car.position.x - p.x, n.car.position.z - p.z).toFixed(1) }));
});
note(`queued traffic at the pickup: ${JSON.stringify(queued)}`);
await page.keyboard.press('KeyF');
await page.waitForTimeout(500);
check('F at the pickup enters a queued traffic car when the cruiser is gone',
  await ev(() => window.__game.drivenCar !== null),
  `driving ${await ev(() => window.__game.drivenCar?.name ?? 'nothing')}`);
await ensureOnFoot();
// B3: edge distance — 6m from the centre along the car's long axis is
// 3.9m from the bumper, so F must work (the old centre metric failed
// here: 6m > 5m base range with a stale latch).
await ev(() => {
  const g = window.__game;
  g.cars.find((c) => c.name === 'CORAL CRUISER').group.position.set(104, 0, 0);
  g.traffic.cars = [];
  g.player.group.position.set(110, 0, 0);
});
await page.waitForTimeout(2000);
const prompt6 = await ev(() => {
  const el = document.getElementById('hud-message');
  return { visible: el.classList.contains('visible'), text: el.textContent };
});
note(`prompt at 6m from centre (3.9m from bumper): ${JSON.stringify(prompt6)}`);
check('carjack prompt shows at 6m from centre (edge 3.9m)',
  prompt6.visible && /Press F to (drive|steal)/.test(prompt6.text), prompt6.text || '(hidden)');
await page.keyboard.press('KeyF');
await page.waitForTimeout(500);
check('F works 6m from the car centre along its axis (edge distance 3.9m)',
  await ev(() => window.__game.drivenCar?.name === 'CORAL CRUISER'),
  `driving ${await ev(() => window.__game.drivenCar?.name ?? 'nothing')}`);
await ensureOnFoot();
// B4: negative — 11m from the centre along the axis is 8.9m from the
// bumper, past the 8m latch, so F must still fail.
await ev(() => { window.__game.player.group.position.set(115, 0, 0); });
await page.waitForTimeout(2000);
await page.keyboard.press('KeyF');
// The "No car nearby" text may queue behind the exit message (3.5s), so
// poll for it instead of sampling once; the driven check is the real one.
let neg = { driven: null, msg: '' };
for (let i = 0; i < 10; i += 1) {
  neg = await ev(() => ({
    driven: window.__game.drivenCar?.name ?? null,
    msg: document.getElementById('hud-message').textContent,
  }));
  if (/No car nearby/.test(neg.msg)) break;
  await page.waitForTimeout(500);
}
check('F still fails 11m from the centre (edge 8.9m, past the 8m latch)',
  neg.driven === null && /No car nearby/.test(neg.msg), JSON.stringify(neg));

// ---- C. Camera never enters a building during an alley turn ----
// The 2m alley at (78,-26) on seed 1 (two-building block, gap x 77-79).
await loadGame();
check('NEW GAME starts (camera alley test)', await newGame());
await ev(() => {
  const g = window.__game;
  g.traffic.cars = [];
  g.player.group.position.set(78, 0, -26);
  g.player.heading = Math.PI;
  g.player.group.rotation.y = Math.PI;
});
await page.waitForTimeout(2500);
// Sample the camera every animation frame inside the page (round-trips
// are too slow headless): turn 180 degrees, then record for 3s.
const turn = await ev(() => new Promise((resolve) => {
  const g = window.__game;
  g.player.heading = 0;
  g.player.group.rotation.y = 0;
  const boxes = g.chaseCamera.city.buildingBoxes;
  const inside = (x, z) => boxes.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
  const blocked = (px, pz, cx, cz) => {
    for (const b of boxes) {
      let t0 = 0, t1 = 1;
      const dx = cx - px, dz = cz - pz;
      let hit = true;
      for (const [p, d, lo, hi] of [[px, dx, b.minX, b.maxX], [pz, dz, b.minZ, b.maxZ]]) {
        if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { hit = false; break; } }
        else {
          let a = (lo - p) / d, c = (hi - p) / d;
          if (a > c) { const t = a; a = c; c = t; }
          t0 = Math.max(t0, a); t1 = Math.min(t1, c);
          if (t0 > t1) { hit = false; break; }
        }
      }
      if (hit && t0 <= t1 && t0 < 1) return true;
    }
    return false;
  };
  let frames = 0, insideFrames = 0, blockedFrames = 0, minDist = 99;
  const t0 = performance.now();
  const sample = () => {
    const c = g.chaseCamera.camera.position;
    const p = g.player.group.position;
    frames += 1;
    if (inside(c.x, c.z)) insideFrames += 1;
    if (blocked(p.x, p.z, c.x, c.z)) blockedFrames += 1;
    minDist = Math.min(minDist, Math.hypot(c.x - p.x, c.z - p.z));
    if (performance.now() - t0 < 3000) requestAnimationFrame(sample);
    else resolve({ frames, insideFrames, blockedFrames, minDist: +minDist.toFixed(2) });
  };
  requestAnimationFrame(sample);
}));
note(`alley 180-degree turn: ${JSON.stringify(turn)}`);
check('camera never enters a building box during the alley turn (was: solid wall-colour screen live)',
  turn.insideFrames === 0, `${turn.insideFrames}/${turn.frames} frames inside`);
check('player-to-camera segment never crosses a building during the turn',
  turn.blockedFrames === 0, `${turn.blockedFrames}/${turn.frames} frames blocked`);
check('camera stays a sensible distance from the player in the alley (0.3-8m)',
  turn.minDist >= 0.3 && turn.minDist <= 8, `minDist=${turn.minDist}m`);
await shot(page, `${SHOTS}/camera-alley-after-turn.png`);
// Walking down the alley: teleport in steps, camera behind, same invariant.
await ev(() => {
  const g = window.__game;
  g.player.group.position.set(78, 0, -40);
  g.player.heading = 0;
  g.player.group.rotation.y = 0;
});
await page.waitForTimeout(1500);
let walkInside = 0, walkBlocked = 0, walkFrames = 0;
for (let z = -38; z <= -12; z += 2) {
  await ev((pz) => { window.__game.player.group.position.set(78, 0, pz); }, z);
  await page.waitForTimeout(400);
  const s = await ev(() => {
    const g = window.__game;
    const c = g.chaseCamera.camera.position;
    const p = g.player.group.position;
    const boxes = g.chaseCamera.city.buildingBoxes;
    const inside = boxes.some((b) => c.x > b.minX && c.x < b.maxX && c.z > b.minZ && c.z < b.maxZ);
    return { inside, cx: +c.x.toFixed(1), cz: +c.z.toFixed(1) };
  });
  walkFrames += 1;
  if (s.inside) walkInside += 1;
}
note(`alley walk: ${walkInside}/${walkFrames} samples inside a building`);
check('camera never enters a building while walking the alley', walkInside === 0, `${walkInside}/${walkFrames} samples inside`);
await shot(page, `${SHOTS}/camera-alley-walk.png`);

// ---- D. Map legend names the yellow/grey squares ----
await loadGame();
check('NEW GAME starts (map legend test)', await newGame());
await page.keyboard.press('KeyN');
await page.waitForTimeout(600);
const legend = await ev(() => [...document.querySelectorAll('#map-legend .legend-grid span')].map((s) => {
  const sw = s.querySelector('i');
  return `${s.textContent.trim()}|${sw ? getComputedStyle(sw).backgroundColor : ''}`;
}));
note(`map legend: ${legend.join(' ; ')}`);
const legendText = legend.join(' ');
check('legend names parked cars (yellow squares)', legend.some((l) => l.startsWith('Parked car|rgb(255, 217, 120)')), legendText);
check('legend names traffic (grey squares)', legend.some((l) => l.startsWith('Traffic|rgb(196, 188, 208)')), legendText);
check('legend keeps the existing entries', /Mission/.test(legendText) && /Business/.test(legendText) && /Pay'n'Spray/.test(legendText) && /Police/.test(legendText) && /Waypoint/.test(legendText), legendText);
await page.keyboard.press('KeyN');
await page.waitForTimeout(300);
// Pixel-measure the dots: paint a controlled map with cars + traffic and
// confirm the yellow squares (~10px) and grey squares (~7px) are what the
// legend now describes. Business blips are omitted here so the gold
// matcher only sees parked cars (same #ffd978).
const dots = await ev(() => {
  const hud = window.__game.hud;
  const canvas = document.getElementById('bigmap');
  const ctx = canvas.getContext('2d');
  hud.paintMap(ctx, 1024, 816, {
    playerPos: { x: -150, z: -150 }, playerHeading: 0,
    cars: [
      { position: { x: 52, z: 52 }, driven: false, destroyed: false },
      { position: { x: -52, z: -52 }, driven: false, destroyed: false },
    ],
    driving: false, missionTarget: null, policeBlips: [], timeSeconds: 0,
    trafficBlips: [{ x: 26, z: -78 }, { x: -78, z: 26 }],
    ammoCrates: [], sideJobTarget: null, eventBlip: null, businessBlips: [],
    sprayPos: null, labels: false,
  });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const cluster = (wx, wz, test) => {
    const p = hud.toMap(wx, wz, width, height);
    const cx = Math.round(p.x), cy = Math.round(p.y);
    let minX = 999, maxX = -1, minY = 999, maxY = -1, n = 0;
    for (let y = Math.max(0, cy - 20); y <= Math.min(height - 1, cy + 20); y += 1) {
      for (let x = Math.max(0, cx - 20); x <= Math.min(width - 1, cx + 20); x += 1) {
        const i = (y * width + x) * 4;
        if (test(data[i], data[i + 1], data[i + 2])) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          n += 1;
        }
      }
    }
    return n === 0 ? null : { w: maxX - minX + 1, h: maxY - minY + 1, n };
  };
  const yellow = (r, g, b) => r > 250 && g > 200 && g < 230 && b > 100 && b < 140;
  const grey = (r, g, b) => r > 180 && r < 215 && g > 175 && g < 205 && b > 195 && b < 220;
  return {
    car1: cluster(52, 52, yellow),
    car2: cluster(-52, -52, yellow),
    traf1: cluster(26, -78, grey),
    traf2: cluster(-78, 26, grey),
  };
});
note(`map dots (bigmap px): ${JSON.stringify(dots)}`);
check('parked cars draw as ~10px yellow squares on the full map',
  dots.car1 && dots.car1.w >= 8 && dots.car1.w <= 12 && dots.car2 && dots.car2.w >= 8 && dots.car2.w <= 12,
  JSON.stringify({ car1: dots.car1, car2: dots.car2 }));
check('traffic draws as ~7px grey squares on the full map',
  dots.traf1 && dots.traf1.w >= 6 && dots.traf1.w <= 9 && dots.traf2 && dots.traf2.w >= 6 && dots.traf2.w <= 9,
  JSON.stringify({ traf1: dots.traf1, traf2: dots.traf2 }));

// ---- E. Crosshair hides for fists; aiming drops the head below centre ----
await loadGame();
check('NEW GAME starts (crosshair test)', await newGame());
await page.waitForTimeout(1000);
check('crosshair hidden with fists equipped', await ev(() => document.getElementById('crosshair').classList.contains('hidden')));
await shot(page, `${SHOTS}/e-fists-no-reticle.png`);
await ev(() => window.__game.combat.unlockWeapon('pistol'));
await page.keyboard.press('Digit2');
await page.waitForTimeout(5000); // aim blend converges (~4/s of slow headless game-time)
check('crosshair visible with pistol equipped', await ev(() => !document.getElementById('crosshair').classList.contains('hidden')));
await shot(page, `${SHOTS}/e-pistol-reticle.png`);
// Project the head top to screen space via the camera matrices: with the
// aim offset it must sit clearly below screen centre (360 at 720px).
const headScreen = await ev(() => {
  const camera = window.__game.camera;
  const p = window.__game.player.position;
  const v = [p.x, 2.12, p.z, 1];
  const mul = (m, x) => [
    m[0] * x[0] + m[4] * x[1] + m[8] * x[2] + m[12] * x[3],
    m[1] * x[0] + m[5] * x[1] + m[9] * x[2] + m[13] * x[3],
    m[2] * x[0] + m[6] * x[1] + m[10] * x[2] + m[14] * x[3],
    m[3] * x[0] + m[7] * x[1] + m[11] * x[2] + m[15] * x[3],
  ];
  const clip = mul(camera.projectionMatrix.elements, mul(camera.matrixWorldInverse.elements, v));
  return { y: ((1 - clip[1] / clip[3]) / 2) * window.innerHeight, behind: clip[3] <= 0 };
});
note(`head top on screen while aiming: y=${Math.round(headScreen.y)}px of 720 (centre 360)`);
check('head sits below screen centre while aiming', !headScreen.behind && headScreen.y > 378, `y=${Math.round(headScreen.y)}`);

// ---- F. Officers read as police (cap + badge + belt; cars get stripes) ----
await loadGame();
check('NEW GAME starts (police uniform test)', await newGame());
await ev(() => {
  window.__game.wanted.setStars(1);
  const unit = window.__game.police.spawnPursuitCar(window.__game.player.position, 12);
  // This section tests the uniform, not pursuit navigation (headless
  // game-time is ~20x slower than real time, so the drive-in alone
  // would eat the whole poll): park the car next to the player, stopped,
  // and the officer exits on the next frame.
  const p = window.__game.player.position;
  unit.car.group.position.set(p.x + 2, 0, p.z);
  unit.car.speed = 0;
  unit.mode = 'direct';
});
let officerSeen = false;
for (let i = 0; i < 10 && !officerSeen; i += 1) {
  await page.waitForTimeout(1000);
  officerSeen = await ev(() => window.__game.police.pursuit.some((u) => u.officer));
}
check('officer exits the stopped pursuit car', officerSeen);
const uniform = await ev(() => {
  const unit = window.__game.police.pursuit.find((u) => u.officer);
  if (!unit) return null;
  const colours = new Set();
  unit.officer.group.traverse((child) => {
    if (child.isMesh && child.material && child.material.color) colours.add(`#${child.material.color.getHexString()}`);
  });
  let stripes = 0;
  unit.car.group.traverse((child) => {
    const gp = child.isMesh && child.geometry && child.geometry.parameters;
    if (gp && gp.width === 0.04 && gp.height === 0.3 && gp.depth === 4.0) stripes += 1;
  });
  return { colours: [...colours], stripes };
});
note(`officer colours: ${uniform ? uniform.colours.join(' ') : 'none'}; stripes: ${uniform ? uniform.stripes : '?'}`);
check('officer wears a navy police cap', uniform && uniform.colours.includes('#1a2a6b'));
check('officer cap has a light-blue band', uniform && uniform.colours.includes('#7ac4ff'));
check('officer wears a gold badge', uniform && uniform.colours.includes('#ffd978'));
check('officer wears the navy uniform shirt', uniform && uniform.colours.includes('#24457e'));
check('police car has two white side stripes', uniform && uniform.stripes === 2, `stripes=${uniform ? uniform.stripes : '?'}`);
await shot(page, `${SHOTS}/f-officer.png`);
await ev(() => window.__game.wanted.setStars(0));

// ---- G. No tree stands on a road ----
await loadGame();
check('NEW GAME starts (trees test)', await newGame());
const treeCheck = await ev(() => {
  const city = window.__game.hud.city;
  const roads = [-312, -260, -208, -156, -104, -52, 0, 52, 104, 156, 208, 260, 312];
  const onRoad = [];
  const inBuilding = [];
  for (const t of city.trees) {
    // Beach palms (outside CITY_EDGE 318) are not on roads by definition.
    if (Math.abs(t.x) > 318 || Math.abs(t.z) > 318) continue;
    for (const x of roads) {
      if (Math.abs(t.x - x) < 7 && t.z >= -318 && t.z <= 318) { onRoad.push({ ...t, road: `z-road x=${x}` }); break; }
    }
    for (const z of roads) {
      if (Math.abs(t.z - z) < 7 && t.x >= -318 && t.x <= 318) { onRoad.push({ ...t, road: `x-road z=${z}` }); break; }
    }
    for (const b of city.buildingBoxes) {
      if (t.x > b.minX - 1 && t.x < b.maxX + 1 && t.z > b.minZ - 1 && t.z < b.maxZ + 1) { inBuilding.push(t); break; }
    }
  }
  return { count: city.trees.length, onRoad, inBuilding };
});
note(`trees planted: ${treeCheck.count}`);
check('no tree within 7m of a road centreline', treeCheck.onRoad.length === 0, JSON.stringify(treeCheck.onRoad.slice(0, 3)));
check('no tree inside a building footprint', treeCheck.inBuilding.length === 0, JSON.stringify(treeCheck.inBuilding.slice(0, 3)));

// ---- H. Every menu button is one fixed width ----
await loadGame();
const titleWidths = await ev(() => [...document.querySelectorAll('#title-screen .menu-button:not(.hidden)')].map((b) => ({ id: b.id, w: Math.round(b.getBoundingClientRect().width) })));
note(`title buttons: ${JSON.stringify(titleWidths)}`);
check('title menu buttons share one width (340px)', titleWidths.length >= 3 && titleWidths.every((b) => b.w === 340), JSON.stringify(titleWidths));
await shot(page, `${SHOTS}/h-title-menu.png`);
check('NEW GAME starts (menu width test)', await newGame());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
const pauseWidths = await ev(() => [...document.querySelectorAll('#pause-screen .menu-button')].map((b) => ({ id: b.id, w: Math.round(b.getBoundingClientRect().width) })));
check('pause menu buttons share one width (340px)', pauseWidths.length === 6 && pauseWidths.every((b) => b.w === 340), JSON.stringify(pauseWidths));
await shot(page, `${SHOTS}/h-pause-menu.png`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.keyboard.press('KeyM');
await page.waitForTimeout(400);
const missionClose = await ev(() => Math.round(document.getElementById('mission-close-button').getBoundingClientRect().width));
check('mission CLOSE button is 340px', missionClose === 340, `close=${missionClose}`);
await shot(page, `${SHOTS}/h-missions-menu.png`);
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);
// BUY buttons only render for businesses the player can afford (fresh
// game: $1,000 vs $2,000+ prices renders none) — fund the test wallet.
await ev(() => { window.__game.setMoney(50000); window.__game.setRep(1000); });
await page.keyboard.press('KeyB');
await page.waitForTimeout(400);
const empireWidths = await ev(() => ({
  close: Math.round(document.getElementById('empire-close-button').getBoundingClientRect().width),
  buy: [...document.querySelectorAll('#empire-screen .empire-buy')].map((b) => Math.round(b.getBoundingClientRect().width)),
}));
check('empire CLOSE button is 340px', empireWidths.close === 340, `close=${empireWidths.close}`);
check('empire BUY buttons stay auto-width (not 340)', empireWidths.buy.length > 0 && empireWidths.buy.every((w) => w !== 340), JSON.stringify(empireWidths.buy));
await shot(page, `${SHOTS}/h-empire-menu.png`);
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);
await page.keyboard.press('KeyN');
await page.waitForTimeout(400);
const mapClose = await ev(() => Math.round(document.getElementById('map-close-button').getBoundingClientRect().width));
check('map CLOSE button is 340px', mapClose === 340, `close=${mapClose}`);
await page.keyboard.press('KeyN');
await page.waitForTimeout(300);

// ---- I. Title slot button is a distinct selector ----
await loadGame();
const slot = await ev(() => {
  const btn = document.getElementById('slot-button');
  const cs = getComputedStyle(btn);
  return { text: btn.textContent, w: Math.round(btn.getBoundingClientRect().width), bg: cs.backgroundColor };
});
note(`slot button: ${JSON.stringify(slot)}`);
check('slot button reads SAVE SLOT: 1 ◀ ▶', slot.text === 'SAVE SLOT: 1 ◀ ▶', slot.text);
check('slot button is the same 340px width', slot.w === 340, `w=${slot.w}`);
check('slot button is visually distinct (dark purple)', slot.bg === 'rgb(42, 35, 64)', slot.bg);
await page.evaluate(() => document.getElementById('slot-button').click());
await page.waitForTimeout(200);
check('clicking the slot button cycles to slot 2', await ev(() => document.getElementById('slot-button').textContent === 'SAVE SLOT: 2 ◀ ▶'));
check('SAVES bar still shows all three slots', await ev(() => {
  const t = document.getElementById('continue-summary').textContent;
  return t.includes('1:') && t.includes('2:') && t.includes('3:');
}));

// ---- J. No firing from inside a car; firing works after exiting ----
await loadGame();
check('NEW GAME starts (no drive-by test)', await newGame());
await ev(() => {
  window.__game.combat.unlockWeapon('pistol');
  const car = window.__game.cars[0];
  window.__game.player.group.position.set(car.position.x + 3, 0, car.position.z);
});
await page.waitForTimeout(800);
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
check('player is driving the owned car', await ev(() => Boolean(window.__game.drivenCar)));
await page.keyboard.press('Digit2');
await page.waitForTimeout(500);
const jMagBefore = await ev(() => window.__game.combat.ammoForHud()[1].mag);
const jCrosshairDriving = await ev(() => document.getElementById('crosshair').classList.contains('hidden'));
await page.mouse.click(640, 360);
await page.waitForTimeout(1000);
const jMagAfter = await ev(() => window.__game.combat.ammoForHud()[1].mag);
check('clicking while driving spends no ammo', jMagAfter === jMagBefore, `mag ${jMagBefore} -> ${jMagAfter}`);
check('crosshair hidden while driving', jCrosshairDriving);
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
check('player exited the car', await ev(() => !window.__game.drivenCar));
const jMagBefore2 = await ev(() => window.__game.combat.ammoForHud()[1].mag);
await page.mouse.click(640, 360);
await page.waitForTimeout(1000);
const jMagAfter2 = await ev(() => window.__game.combat.ammoForHud()[1].mag);
check('firing works again after exiting the car', jMagAfter2 === jMagBefore2 - 1, `mag ${jMagBefore2} -> ${jMagAfter2}`);
check('crosshair visible on foot with pistol', await ev(() => !document.getElementById('crosshair').classList.contains('hidden')));

// ---- K. Traffic + police cars have (fake) headlights at night ----
await page.goto('file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?shot=combat&seed=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.waitForTimeout(500);
check('NEW GAME starts (headlights test)', await newGame());
await page.waitForTimeout(3000);
const headlights = await ev(() => {
  const traffic = window.__game.traffic.cars.map((npc) => ({
    cone: npc.car.headlightCone.visible, pool: npc.car.headlightPool.visible,
    lamp: `#${npc.car.lampMat.color.getHexString()}`,
  }));
  const parked = window.__game.cars.map((car) => ({ cone: car.headlightCone.visible, pool: car.headlightPool.visible }));
  return {
    trafficOn: traffic.filter((t) => t.cone && t.pool).length,
    trafficWhite: traffic.filter((t) => t.lamp === '#ffffff').length,
    parkedOn: parked.filter((p) => p.cone || p.pool).length,
    spotOn: window.__game.headlight.visible,
  };
});
note(`headlights: ${JSON.stringify(headlights)}`);
check('several traffic cars show fake headlights at night', headlights.trafficOn >= 2, `trafficOn=${headlights.trafficOn}`);
check('traffic lamps glow white at night', headlights.trafficWhite >= 2, `white=${headlights.trafficWhite}`);
check('parked cars stay dark (no fake headlights)', headlights.parkedOn === 0, `parkedOn=${headlights.parkedOn}`);
check('player SpotLight stays off on foot', headlights.spotOn === false);
await ev(() => {
  window.__game.wanted.setStars(1);
  window.__game.police.spawnPursuitCar(window.__game.player.position, 20);
});
await page.waitForTimeout(1500);
const policeLights = await ev(() => {
  const unit = window.__game.police.pursuit[0];
  return unit ? { cone: unit.car.headlightCone.visible, pool: unit.car.headlightPool.visible } : null;
});
check('police cars get fake headlights too', Boolean(policeLights && policeLights.cone && policeLights.pool), JSON.stringify(policeLights));
await shot(page, `${SHOTS}/k-night-headlights.png`);

// ---- L. Firing alone in the open earns no star ----
await loadGame();
check('NEW GAME starts (gunfire witness test)', await newGame());
await ev(() => {
  window.__game.combat.unlockWeapon('pistol');
  window.__game.wanted.setStars(0);
  window.__game.wanted.lastShootStarAt = -99;
  // Park every ped dormant with a long retry timer so none can witness.
  for (const ped of window.__game.pedestrians.peds) {
    ped.dormant = true;
    ped.retryTimer = 999;
    ped.mesh.group.visible = false;
    ped.mesh.group.position.set(10000, 0, 10000);
  }
  window.__game.player.group.position.set(-150, 0, -150);
});
await page.keyboard.press('Digit2');
await page.waitForTimeout(500);
const lMagBefore = await ev(() => window.__game.combat.ammoForHud()[1].mag);
await page.mouse.click(640, 360);
await page.waitForTimeout(1500);
const lMagAfter = await ev(() => window.__game.combat.ammoForHud()[1].mag);
const lStars = await ev(() => window.__game.wanted.stars);
check('the shot was actually fired', lMagAfter === lMagBefore - 1, `mag ${lMagBefore} -> ${lMagAfter}`);
check('firing with no witness earns no star', lStars === 0, `stars=${lStars}`);

// ---- M. Night density: streets empty at 03:00, nightlife stays busier ----
await loadGame();
check('NEW GAME starts (density test)', await newGame());
const forceLineEnds = () => ev(() => {
  // Push past the arrival trigger itself (ped: beyond line.to/from;
  // traffic: beyond to+2/from-2) so the arrival fires on the next frame
  // instead of after a walk headless game-time cannot afford.
  for (const ped of window.__game.pedestrians.peds) {
    if (ped.dormant) continue;
    ped.along = ped.direction > 0 ? ped.line.to + 1 : ped.line.from - 1;
  }
  for (const npc of window.__game.traffic.cars) {
    if (npc.dormant) continue;
    npc.along = npc.direction > 0 ? npc.line.to + 3 : npc.line.from - 3;
  }
});
const forceRetries = () => ev(() => {
  for (const ped of window.__game.pedestrians.peds) if (ped.dormant) ped.retryTimer = 0;
  for (const npc of window.__game.traffic.cars) if (npc.dormant) npc.retryTimer = 0;
});
const counts = () => ev(() => ({
  pedTarget: window.__game.pedestrians.target,
  pedActive: window.__game.pedestrians.activeCount,
  trafTarget: window.__game.traffic.target,
  trafActive: window.__game.traffic.activeCount,
}));
const bias = await ev(() => {
  const peds = window.__game.pedestrians;
  peds.setDensity(180);
  let night = 0;
  for (let i = 0; i < 100; i += 1) {
    const line = peds.pickLine();
    if (line.axis === 'x' && line.at === 0) night += 1;
  }
  peds.setDensity(720);
  let day = 0;
  for (let i = 0; i < 100; i += 1) {
    const line = peds.pickLine();
    if (line.axis === 'x' && line.at === 0) day += 1;
  }
  return { night, day };
});
note(`pickLine nightlife share: night ${bias.night}/100, day ${bias.day}/100`);
check('respawn line pick favours the nightlife strip at night', bias.night >= 45 && bias.night <= 75, `${bias.night}/100`);
check('respawn line pick is uniform by day', bias.day <= 25, `${bias.day}/100`);
await ev(() => window.__game.setGameMinutes(180));
await page.waitForTimeout(1000);
await forceLineEnds();
await page.waitForTimeout(5000);
const night1 = await counts();
note(`03:00 after one cycle: ${JSON.stringify(night1)}`);
check('ped target drops to ~27 at 03:00', night1.pedTarget === 27, `target=${night1.pedTarget}`);
check('traffic target drops to ~8 at 03:00', night1.trafTarget === 8, `target=${night1.trafTarget}`);
check('ped count thins clearly at 03:00', night1.pedActive >= 24 && night1.pedActive <= 30, `active=${night1.pedActive}`);
check('traffic thins at 03:00', night1.trafActive >= 12 && night1.trafActive <= 22, `active=${night1.trafActive}`);
for (let cycle = 0; cycle < 3; cycle += 1) {
  await forceRetries();
  await page.waitForTimeout(1500);
  await forceLineEnds();
  await page.waitForTimeout(4000);
}
const districts = await ev(() => {
  let nightlife = 0, residential = 0;
  for (const ped of window.__game.pedestrians.peds) {
    if (ped.dormant) continue;
    const pos = ped.mesh.group.position;
    if (pos.z > -52 && pos.z < 26) nightlife += 1;
    else residential += 1;
  }
  return { nightlife, residential };
});
note(`03:00 active peds by district: ${JSON.stringify(districts)}`);
check('nightlife stays busier than residential at 03:00', districts.nightlife > districts.residential, JSON.stringify(districts));
await ev(() => window.__game.setGameMinutes(720));
await page.waitForTimeout(1000);
await forceRetries();
await page.waitForTimeout(3000);
const noon = await counts();
note(`12:00: ${JSON.stringify(noon)}`);
check('ped count recovers at noon', noon.pedActive >= 85, `active=${noon.pedActive}`);
check('traffic recovers at noon', noon.trafActive >= 26, `active=${noon.trafActive}`);

// ---- N. VICE CUTS barbershop: E opens the same customization UI ----
await loadGame();
check('NEW GAME starts (barbershop test)', await newGame());
await ev(() => window.__game.player.group.position.set(10, 0, 4));
let shopPromptSeen = false;
for (let i = 0; i < 10 && !shopPromptSeen; i += 1) {
  await page.waitForTimeout(500);
  shopPromptSeen = await ev(() => document.getElementById('hud-message').textContent.includes('VICE CUTS'));
}
check('VICE CUTS prompt appears at the shop', shopPromptSeen);
await page.keyboard.press('KeyE');
await page.waitForTimeout(500);
check('E opens the style screen', await ev(() => !document.getElementById('style-screen').classList.contains('hidden')));
const swatches = await ev(() => ({
  hair: document.getElementById('hair-swatches').children.length,
  shirt: document.getElementById('shirt-swatches').children.length,
  skin: document.getElementById('skin-swatches').children.length,
}));
check('style screen has the same 5/4/4 swatches', swatches.hair === 5 && swatches.shirt === 4 && swatches.skin === 4, JSON.stringify(swatches));
await shot(page, `${SHOTS}/n-style-screen.png`);
await page.evaluate(() => document.getElementById('hair-swatches').children[2].click());
await page.waitForTimeout(300);
const lookAfter = await ev(() => ({
  stored: JSON.parse(localStorage.getItem('solaris-keys-look') || '{}'),
  saved: window.__game.snapshotSave().look,
  selected: document.getElementById('hair-swatches').children[2].classList.contains('sel'),
}));
check('changing hair persists to localStorage + the save file', lookAfter.stored.hair === 2 && lookAfter.saved.hair === 2 && lookAfter.selected, JSON.stringify(lookAfter));
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check('Escape closes the style screen', await ev(() => document.getElementById('style-screen').classList.contains('hidden')));
check('settings no longer contains customization', await ev(() => !document.querySelector('#settings-screen .swatches') && !document.querySelector('#settings-screen .custom-row')));
// The look survives a reload (loadLook applies it at init).
await loadGame();
await page.waitForTimeout(500);
check('look persists after reload', await ev(() => {
  const stored = JSON.parse(localStorage.getItem('solaris-keys-look') || '{}');
  return stored.hair === 2 && document.getElementById('hair-swatches').children[2].classList.contains('sel');
}));
// Pink diamond on the map + legend entry.
const shopDot = await ev(() => {
  const hud = window.__game.hud;
  const canvas = document.getElementById('bigmap');
  const ctx = canvas.getContext('2d');
  hud.paintMap(ctx, 1024, 816, {
    playerPos: { x: -150, z: -150 }, playerHeading: 0, cars: [], driving: false,
    missionTarget: null, policeBlips: [], timeSeconds: 0, trafficBlips: [],
    ammoCrates: [], sideJobTarget: null, eventBlip: null, businessBlips: [],
    sprayPos: null, shopPos: { x: 10, z: 8 }, labels: false,
  });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const p = hud.toMap(10, 8, width, height);
  const cx = Math.round(p.x), cy = Math.round(p.y);
  let minX = 999, maxX = -1, minY = 999, maxY = -1, n = 0;
  for (let y = Math.max(0, cy - 20); y <= Math.min(height - 1, cy + 20); y += 1) {
    for (let x = Math.max(0, cx - 20); x <= Math.min(width - 1, cx + 20); x += 1) {
      const i = (y * width + x) * 4;
      if (data[i] > 240 && data[i + 1] > 70 && data[i + 1] < 110 && data[i + 2] > 150 && data[i + 2] < 190) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        n += 1;
      }
    }
  }
  return n === 0 ? null : { w: maxX - minX + 1, h: maxY - minY + 1, n };
});
note(`shop diamond on the full map: ${JSON.stringify(shopDot)}`);
check('barbershop draws as a pink diamond on the map', shopDot && shopDot.w >= 18 && shopDot.w <= 30, JSON.stringify(shopDot));
check('legend names the barbershop (pink)', await ev(() => [...document.querySelectorAll('#map-legend .legend-grid span')].some((s) => s.textContent.trim() === 'Barbershop' && getComputedStyle(s.querySelector('i')).backgroundColor === 'rgb(255, 90, 168)')));

// ---- O. Settings panel: tabbed, live controls, clean title ----
await loadGame();
check('title has no controls bar', await ev(() => ![...document.querySelectorAll('#title-screen .controls')].some((el) => el.textContent.includes('W/S'))));
check('title has no judge note', await ev(() => !document.querySelector('.judge-note')));
await page.evaluate(() => document.getElementById('settings-button').click());
await page.waitForTimeout(400);
check('settings panel opens from the title menu', await ev(() => !document.getElementById('settings-screen').classList.contains('hidden')));
const settingRows = await ev(() => [...document.querySelectorAll('#settings-tab-panel .settings-row')].map((r) => r.querySelector('label').textContent));
note(`settings rows: ${settingRows.join(' | ')}`);
check('settings tab has the six live rows', settingRows.length === 6 && settingRows.includes('MUSIC VOLUME') && settingRows.includes('EFFECTS VOLUME') && settingRows.includes('RADIO STATION') && settingRows.includes('QUALITY') && settingRows.includes('SHADOWS') && settingRows.includes('HUD DENSITY'), settingRows.join(', '));
check('no dead Glow/bloom toggle', await ev(() => !document.getElementById('settings-screen').textContent.includes('GLOW')));
await shot(page, `${SHOTS}/o-settings-tab.png`);
await page.evaluate(() => document.querySelector('.settings-tab[data-tab="controls"]').click());
await page.waitForTimeout(300);
const controlRows = await ev(() => [...document.querySelectorAll('#controls-tab-panel .controls-row')].map((r) => r.children[0].textContent));
check('controls tab lists all 15 bindings', controlRows.length === 15, `${controlRows.length} rows`);
await shot(page, `${SHOTS}/o-controls-tab.png`);
await page.evaluate(() => document.querySelector('.settings-tab[data-tab="settings"]').click());
await page.waitForTimeout(300);
// Shadows toggle flips the real sun shadow.
await page.evaluate(() => {
  const box = document.getElementById('shadows-toggle');
  box.checked = false;
  box.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(200);
check('shadows off disables the sun shadow', await ev(() => window.__game.hud.city.sunLight.castShadow === false));
await page.evaluate(() => {
  const box = document.getElementById('shadows-toggle');
  box.checked = true;
  box.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(200);
check('shadows on re-enables the sun shadow', await ev(() => window.__game.hud.city.sunLight.castShadow === true));
// Quality Low shrinks the shadow map.
await page.evaluate(() => {
  const sel = document.getElementById('quality-select');
  sel.value = 'low';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(200);
check('quality Low sets a 512 shadow map', await ev(() => window.__game.hud.city.sunLight.shadow.mapSize.x === 512));
await page.evaluate(() => {
  const sel = document.getElementById('quality-select');
  sel.value = 'high';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(200);
check('quality High restores a 2048 shadow map', await ev(() => window.__game.hud.city.sunLight.shadow.mapSize.x === 2048));
// HUD density Minimal hides the secondary panels.
await page.evaluate(() => {
  const sel = document.getElementById('hud-density');
  sel.value = 'minimal';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(200);
check('HUD Minimal hides the radio line', await ev(() => document.body.classList.contains('hud-minimal') && getComputedStyle(document.getElementById('hud-radio')).display === 'none'));
await page.evaluate(() => {
  const sel = document.getElementById('hud-density');
  sel.value = 'full';
  sel.dispatchEvent(new Event('change', { bubbles: true }));
});
await page.waitForTimeout(200);
// A setting persists across reloads.
await page.evaluate(() => {
  const slider = document.getElementById('effects-volume');
  slider.value = '50';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(200);
check('effects volume slider applies', await ev(() => window.__game.audio.effectsVolume === 0.5));
await loadGame();
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('settings-button').click());
await page.waitForTimeout(400);
check('settings persist after reload', await ev(() => document.getElementById('effects-volume').value === '50' && document.getElementById('effects-volume-value').textContent === '50'));
await page.evaluate(() => {
  const slider = document.getElementById('effects-volume');
  slider.value = '100';
  slider.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.evaluate(() => document.getElementById('settings-back').click());
await page.waitForTimeout(300);
// Settings from the pause menu returns to pause, not title.
check('NEW GAME starts (pause settings test)', await newGame());
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.evaluate(() => document.getElementById('pause-settings-button').click());
await page.waitForTimeout(400);
check('settings panel opens from the pause menu', await ev(() => !document.getElementById('settings-screen').classList.contains('hidden')));
await page.evaluate(() => document.getElementById('settings-back').click());
await page.waitForTimeout(300);
check('BACK from pause settings returns to pause', await ev(() => !document.getElementById('pause-screen').classList.contains('hidden') && document.getElementById('title-screen').classList.contains('hidden')));

// ---- P. Buildings glow at night, stay dark by day ----
await page.goto('file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?shot=combat&seed=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.waitForTimeout(500);
check('NEW GAME starts (night windows test)', await newGame());
await page.waitForTimeout(2000);
const nightGlow = await ev(() => {
  const mats = window.__game.hud.city.buildingMaterials;
  const intensities = mats.map((m) => m.emissiveIntensity);
  // Count lit pixels in one building's emissive map (warm yellow windows).
  const img = mats[0].emissiveMap.image;
  const ctx = img.getContext('2d');
  const data = ctx.getImageData(0, 0, img.width, img.height).data;
  let lit = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i] > 150) lit += 1;
  return { count: mats.length, min: Math.min(...intensities), max: Math.max(...intensities), litPixels: lit, totalPixels: img.width * img.height };
});
note(`night glow: ${JSON.stringify(nightGlow)}`);
check('every building glows at night (emissiveIntensity > 0)', nightGlow.count > 0 && nightGlow.min > 0, `mats=${nightGlow.count} min=${nightGlow.min.toFixed(2)}`);
check('emissive maps carry lit windows (not all black, not all lit)', nightGlow.litPixels > 50 && nightGlow.litPixels < nightGlow.totalPixels * 0.5, `lit=${nightGlow.litPixels}/${nightGlow.totalPixels}`);
await shot(page, `${SHOTS}/p-night-windows.png`);
await ev(() => window.__game.setGameMinutes(720));
await page.waitForTimeout(2000);
const dayGlow = await ev(() => Math.max(...window.__game.hud.city.buildingMaterials.map((m) => m.emissiveIntensity)));
check('no glow by day (emissiveIntensity 0)', dayGlow === 0, `max=${dayGlow}`);
await shot(page, `${SHOTS}/p-day-windows.png`);

// ---- Q. HUD redesign: big bold KARIMBU-style HUD, no overlap ----
await loadGame();
check('NEW GAME starts (HUD test)', await newGame());
await page.waitForTimeout(1000);
await ev(() => window.__game.setRep(150));
await page.waitForTimeout(500);
const hudQ = await ev(() => {
  const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
  const canvas = document.getElementById('minimap');
  const slots = [...document.querySelectorAll('.weapon-slot')].map((s) => ({ cls: s.className, text: s.textContent.trim() }));
  return {
    canvasBuf: { w: canvas.width, h: canvas.height },
    canvasCss: r('minimap'),
    districtInBars: document.getElementById('hud-bars').contains(document.getElementById('hud-district')),
    districtInTopLeft: document.getElementById('hud-top-left').contains(document.getElementById('hud-district')),
    districtFont: getComputedStyle(document.getElementById('hud-district')).fontSize,
    district: document.getElementById('hud-district').textContent,
    street: document.getElementById('hud-street').textContent,
    healthNum: document.getElementById('hud-health-num').textContent,
    armourNum: document.getElementById('hud-armour-num').textContent,
    repbar: document.getElementById('hud-repbar-fill').style.width,
    slots,
    boxes: { topLeft: r('hud-top-left'), topRight: r('hud-top-right'), minimap: r('hud-minimap'), bars: r('hud-bars'), speedo: r('hud-speedo'), hint: r('hud-hint') },
  };
});
note(`HUD: ${JSON.stringify(hudQ.boxes)} slots=${JSON.stringify(hudQ.slots)}`);
check('minimap is the large 260x220 rectangle (buffer + CSS)', hudQ.canvasBuf.w === 260 && hudQ.canvasBuf.h === 220 && hudQ.canvasCss.w === 260 && hudQ.canvasCss.h === 220, JSON.stringify({ buf: hudQ.canvasBuf, css: hudQ.canvasCss }));
check('district moved to the bottom-left bars block', hudQ.districtInBars && !hudQ.districtInTopLeft);
check('district name is HUGE (44px)', hudQ.districtFont === '44px', hudQ.districtFont);
check('street name shows the grid position at spawn', hudQ.street === '7TH AVE · 7TH ST', hudQ.street);
check('all 4 weapon slots render, locked ones greyed', hudQ.slots.length === 4 && hudQ.slots[0].cls.includes('active') && hudQ.slots.slice(1).every((s) => s.cls.includes('locked') && s.text.includes('LOCKED')), JSON.stringify(hudQ.slots));
check('health/armour bars carry numbers', hudQ.healthNum === '100' && hudQ.armourNum === '0', `health=${hudQ.healthNum} armour=${hudQ.armourNum}`);
check('rep bar matches rep progress (150/200 = 75%)', hudQ.repbar === '75%', hudQ.repbar);
check('1280px: top panels do not meet', hudQ.boxes.topLeft.right < hudQ.boxes.topRight.left, JSON.stringify({ l: hudQ.boxes.topLeft.right, r: hudQ.boxes.topRight.left }));
check('1280px: bars sit above the minimap', hudQ.boxes.bars.bottom <= hudQ.boxes.minimap.top, JSON.stringify({ barsBottom: hudQ.boxes.bars.bottom, mapTop: hudQ.boxes.minimap.top }));
check('1280px: hint clears the minimap and speedo', hudQ.boxes.hint.top >= hudQ.boxes.minimap.bottom && hudQ.boxes.hint.top >= hudQ.boxes.speedo.bottom, JSON.stringify({ hintTop: hudQ.boxes.hint.top, mapBottom: hudQ.boxes.minimap.bottom, speedoBottom: hudQ.boxes.speedo.bottom }));
check('1280px: minimap and speedo do not meet', hudQ.boxes.minimap.right < hudQ.boxes.speedo.left, JSON.stringify({ mapRight: hudQ.boxes.minimap.right, speedoLeft: hudQ.boxes.speedo.left }));
async function hudLayoutAt(width, height, label) {
  const p = await browser.newPage({ viewport: { width, height } });
  p.on('pageerror', (e) => errors.push(`PAGEERROR(${label}): ${e.message}`));
  await p.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('start-button')?.click());
  await p.waitForTimeout(1000);
  const boxes = await p.evaluate(() => {
    const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
    return { topLeft: r('hud-top-left'), topRight: r('hud-top-right'), minimap: r('hud-minimap'), canvas: r('minimap'), bars: r('hud-bars'), speedo: r('hud-speedo'), hint: r('hud-hint') };
  });
  note(`${label} boxes: ${JSON.stringify(boxes)}`);
  await shot(p, `${SHOTS}/q-hud-${label}.png`);
  await p.close();
  return boxes;
}
const q768 = await hudLayoutAt(768, 1024, '768x1024');
check('768px: top panels do not meet', q768.topLeft.right < q768.topRight.left, JSON.stringify({ l: q768.topLeft.right, r: q768.topRight.left }));
check('768px: bars sit above the minimap', q768.bars.bottom <= q768.minimap.top, JSON.stringify({ barsBottom: q768.bars.bottom, mapTop: q768.minimap.top }));
check('768px: hint clears the minimap and speedo', q768.hint.top >= q768.minimap.bottom && q768.hint.top >= q768.speedo.bottom, JSON.stringify({ hintTop: q768.hint.top, mapBottom: q768.minimap.bottom, speedoBottom: q768.speedo.bottom }));
check('768px: minimap and speedo do not meet', q768.minimap.right < q768.speedo.left, JSON.stringify({ mapRight: q768.minimap.right, speedoLeft: q768.speedo.left }));
const q768l = await hudLayoutAt(768, 432, '768x432');
check('768x432: bars do not reach the mission panel', q768l.bars.top > q768l.topLeft.bottom, JSON.stringify({ barsTop: q768l.bars.top, panelBottom: q768l.topLeft.bottom }));
check('768x432: hint clears the minimap and speedo', q768l.hint.top >= q768l.minimap.bottom && q768l.hint.top >= q768l.speedo.bottom, JSON.stringify({ hintTop: q768l.hint.top, mapBottom: q768l.minimap.bottom, speedoBottom: q768l.speedo.bottom }));
const q480 = await hudLayoutAt(480, 800, '480x800');
check('480px: top panels do not meet', q480.topLeft.right < q480.topRight.left, JSON.stringify({ l: q480.topLeft.right, r: q480.topRight.left }));
check('480px: minimap stays 120px', q480.canvas.w === 120 && q480.canvas.h === 120, JSON.stringify(q480.canvas));
check('480px: bars sit above the minimap', q480.bars.bottom <= q480.minimap.top, JSON.stringify({ barsBottom: q480.bars.bottom, mapTop: q480.minimap.top }));
check('480px: minimap and speedo do not meet', q480.minimap.right < q480.speedo.left, JSON.stringify({ mapRight: q480.minimap.right, speedoLeft: q480.speedo.left }));
check('480px: hint clears the minimap and speedo', q480.hint.top >= q480.minimap.bottom && q480.hint.top >= q480.speedo.bottom, JSON.stringify({ hintTop: q480.hint.top, mapBottom: q480.minimap.bottom, speedoBottom: q480.speedo.bottom }));

// ---- R. Motorcycles: parked + traffic, mount/drive/dismount, save/load ----
await loadGame();
check('NEW GAME starts (bike test)', await newGame());
const bikeParked = await ev(() => {
  const g = window.__game;
  return {
    bikes: g.cars.filter((c) => c.style === 'bike').map((c) => ({ name: c.name, x: Math.round(c.position.x), z: Math.round(c.position.z) })),
    trafficBikes: g.traffic.cars.filter((n) => n.car.style === 'bike').length,
  };
});
note(`parked bikes: ${JSON.stringify(bikeParked.bikes)}; traffic bikes: ${bikeParked.trafficBikes}`);
check('two parked bikes on the map (VICE SPORT, GULL SCOOTER)', bikeParked.bikes.length === 2 && bikeParked.bikes.some((b) => b.name === 'VICE SPORT') && bikeParked.bikes.some((b) => b.name === 'GULL SCOOTER'), JSON.stringify(bikeParked.bikes));
check('traffic includes bikes', bikeParked.trafficBikes >= 1, `traffic bikes=${bikeParked.trafficBikes}`);
// Park the traffic for the rest of this section: a passing car can knock
// the player down (0.8s game-time = 5-16s real headless) and block F, and
// a nearer traffic car steals the F press at the remount (run 3 race).
await ev(() => {
  for (const npc of window.__game.traffic.cars) {
    npc.dormant = true; npc.retryTimer = 999;
    npc.car.group.position.set(10000, 0, 10000);
  }
});
await ev(() => { const g = window.__game; const bike = g.cars.find((c) => c.name === 'VICE SPORT'); g.player.group.position.set(bike.position.x + 2, 0, bike.position.z); });
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
const mounted = await ev(() => ({ driving: window.__game.drivenCar?.name, style: window.__game.drivenCar?.style, playerVisible: window.__game.player.group.visible }));
check('F mounts the bike', mounted.driving === 'VICE SPORT' && mounted.style === 'bike', JSON.stringify(mounted));
check('rider stays visible, seated on the bike', mounted.playerVisible === true, JSON.stringify(mounted));
const bikeBefore = await ev(() => ({ x: window.__game.drivenCar.position.x, z: window.__game.drivenCar.position.z, heading: window.__game.drivenCar.heading }));
await page.keyboard.down('KeyW');
await page.waitForTimeout(5000);
await page.keyboard.up('KeyW');
const bikeDrove = await ev(() => ({ x: window.__game.drivenCar.position.x, z: window.__game.drivenCar.position.z, speed: window.__game.drivenCar.speed }));
// Headless game-time is ~6-20x slower than real time and varies with VM
// load: 5s of W covered 0.26m in one run. Speed > 1 proves the bike drives;
// displacement just needs to be clearly non-zero (> 0.1m).
check('bike drives forward under W', bikeDrove.speed > 1 && Math.hypot(bikeDrove.x - bikeBefore.x, bikeDrove.z - bikeBefore.z) > 0.1, JSON.stringify({ before: bikeBefore, after: bikeDrove }));
await page.keyboard.down('KeyW');
await page.keyboard.down('KeyA');
await page.waitForTimeout(3000);
const bikeLean = await ev(() => ({ lean: window.__game.drivenCar.leanGroup.rotation.z, heading: window.__game.drivenCar.heading }));
await page.keyboard.up('KeyA');
await page.keyboard.up('KeyW');
check('bike leans into the turn (left turn = negative rotation.z)', bikeLean.lean < -0.02, JSON.stringify(bikeLean));
check('bike turns under A', bikeLean.heading - bikeBefore.heading > 0.01, JSON.stringify({ before: bikeBefore.heading, after: bikeLean.heading }));
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
check('F dismounts the bike', await ev(() => window.__game.drivenCar === null));
await shot(page, `${SHOTS}/r-bike.png`);
// Save/load restores the ridden bike. Stand the player back up first: a
// car hit leaves downTimer > 0 for 0.8s of game-time and blocks F.
await ev(() => {
  const g = window.__game;
  g.player.downTimer = 0;
  g.player.group.rotation.x = 0;
  g.player.group.position.y = 0;
  const bike = g.cars.find((c) => c.name === 'VICE SPORT');
  g.player.group.position.set(bike.position.x + 2, 0, bike.position.z);
});
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
check('remount for save/load', await ev(() => window.__game.drivenCar?.style === 'bike'), await ev(() => JSON.stringify({ driving: window.__game.drivenCar?.name, style: window.__game.drivenCar?.style })));
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('save-button')?.click());
await page.waitForTimeout(500);
await loadGame();
await page.waitForTimeout(500);
check('CONTINUE appears after saving', await ev(() => !document.getElementById('continue-button').classList.contains('hidden')));
await page.evaluate(() => document.getElementById('continue-button')?.click());
await page.waitForTimeout(1000);
const bikeLoaded = await ev(() => ({ driving: window.__game.drivenCar?.name, style: window.__game.drivenCar?.style, playerVisible: window.__game.player.group.visible }));
check('save/load restores the ridden bike', bikeLoaded.driving === 'VICE SPORT' && bikeLoaded.style === 'bike' && bikeLoaded.playerVisible === true, JSON.stringify(bikeLoaded));

// ---- S. Island: 12x12 grid, sea on all 4 sides, everything still valid ----
await loadGame();
check('NEW GAME starts (island test)', await newGame());
const island = await ev(() => {
  const g = window.__game;
  const boxes = g.hud.city.buildingBoxes;
  const colSet = new Set(), rowSet = new Set();
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const b of boxes) {
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    colSet.add(Math.floor((cx + 318) / 52));
    rowSet.add(Math.floor((cz + 318) / 52));
    minX = Math.min(minX, b.minX); maxX = Math.max(maxX, b.maxX);
    minZ = Math.min(minZ, b.minZ); maxZ = Math.max(maxZ, b.maxZ);
  }
  const missions = g.missions.statusList().map((m) => ({ name: m.name, start: m.start }));
  const biz = g.businesses.blips();
  return {
    buildings: boxes.length,
    cols: [...colSet].sort((a, b) => a - b),
    rows: [...rowSet].sort((a, b) => a - b),
    spanX: Math.round(maxX - minX),
    spanZ: Math.round(maxZ - minZ),
    missions,
    biz,
    shop: g.shop,
    tapes: g.tapes.tapes.length,
  };
});
note(`island: ${island.buildings} buildings, cols=${island.cols.length} rows=${island.rows.length} span=${island.spanX}x${island.spanZ}m tapes=${island.tapes}`);
check('city grid is 12x12 blocks', island.cols.length === 12 && island.rows.length === 12, `cols=${JSON.stringify(island.cols)} rows=${JSON.stringify(island.rows)}`);
check('city spans ~636m (was ~324m)', island.spanX > 590 && island.spanZ > 590, `span=${island.spanX}x${island.spanZ}m`);
check('all 8 mission starts are on the island (beach starts sit on the sand at z=330)', island.missions.every((m) => Math.abs(m.start[0]) < 356 && Math.abs(m.start[1]) < 356), JSON.stringify(island.missions));
check('businesses + barbershop are inside the city', [...island.biz, island.shop].every((p) => Math.abs(p.x) < 318 && Math.abs(p.z) < 318), JSON.stringify({ biz: island.biz, shop: island.shop }));
check('40 tapes across the island', island.tapes === 40, `tapes=${island.tapes}`);
async function swimAt(x, z) {
  await ev(({ x, z }) => window.__game.player.group.position.set(x, 0, z), { x, z });
  await page.waitForTimeout(600);
  return ev(() => ({ swimming: window.__game.player.swimming, y: window.__game.player.group.position.y }));
}
const seaS = await swimAt(0, 400);
const seaN = await swimAt(0, -400);
const seaE = await swimAt(400, 0);
const seaW = await swimAt(-400, 0);
check('sea surrounds the island on all 4 sides (deep water)', seaS.swimming && seaN.swimming && seaE.swimming && seaW.swimming, JSON.stringify({ S: seaS, N: seaN, E: seaE, W: seaW }));
await ev(() => window.__game.player.group.position.set(0, 0, 330));
await page.waitForTimeout(600);
const beachS = await ev(() => ({ swimming: window.__game.player.swimming, district: document.getElementById('hud-district').textContent }));
await ev(() => window.__game.player.group.position.set(-330, 0, 0));
await page.waitForTimeout(600);
const beachW = await ev(() => ({ swimming: window.__game.player.swimming, district: document.getElementById('hud-district').textContent }));
check('south beach is sand, not sea (SUNSET BLUFF)', !beachS.swimming && beachS.district === 'SUNSET BLUFF', JSON.stringify(beachS));
check('west beach is sand, not sea (CORAL STRAND)', !beachW.swimming && beachW.district === 'CORAL STRAND', JSON.stringify(beachW));
await shot(page, `${SHOTS}/s-beach.png`);

// ---- T. Traffic variety: buses, trucks, taxis ----
await loadGame();
check('NEW GAME starts (traffic test)', await newGame());
const trafficT = await ev(() => {
  const g = window.__game;
  const styles = {};
  for (const n of g.traffic.cars) styles[n.car.style] = (styles[n.car.style] || 0) + 1;
  const parked = g.cars.filter((c) => c.style === 'bus' || c.style === 'truck').map((c) => ({ name: c.name, style: c.style, x: Math.round(c.position.x), z: Math.round(c.position.z) }));
  const taxi = g.traffic.cars.find((n) => n.car.style === 'taxi')?.car;
  let sign = false, yellow = false;
  if (taxi) {
    taxi.group.traverse((child) => {
      const gp = child.isMesh && child.geometry && child.geometry.parameters;
      if (gp && gp.width === 0.7 && gp.height === 0.22 && gp.depth === 0.3 && child.material && child.material.map) sign = true;
      if (child.isMesh && child.material && child.material.color && child.material.color.getHex() === 0xffc828) yellow = true;
    });
  }
  return { styles, parked, taxiSign: sign, taxiYellow: yellow };
});
note(`traffic styles: ${JSON.stringify(trafficT.styles)}; parked heavy: ${JSON.stringify(trafficT.parked)}`);
check('parked bus + truck on the map', trafficT.parked.some((c) => c.style === 'bus' && c.name === 'KEYS LINER') && trafficT.parked.some((c) => c.style === 'truck' && c.name === 'CORAL HAULER'), JSON.stringify(trafficT.parked));
check('ambient traffic includes taxis, bikes and a truck', (trafficT.styles.taxi || 0) >= 1 && (trafficT.styles.bike || 0) >= 1 && (trafficT.styles.truck || 0) >= 1, JSON.stringify(trafficT.styles));
check('taxi has a roof TAXI sign (canvas texture)', trafficT.taxiSign === true);
check('taxi wears yellow livery', trafficT.taxiYellow === true);
// Seed 2 rolls buses into ambient traffic (seed 1 does not).
const p2 = await browser.newPage({ viewport: { width: 1280, height: 720 } });
p2.on('pageerror', (e) => errors.push(`PAGEERROR(seed2): ${e.message}`));
await p2.goto('file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?seed=2', { waitUntil: 'domcontentloaded', timeout: 60000 });
await p2.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
const seed2Styles = await p2.evaluate(() => {
  const styles = {};
  for (const n of window.__game.traffic.cars) styles[n.car.style] = (styles[n.car.style] || 0) + 1;
  return styles;
});
await p2.close();
check('ambient traffic includes buses (seed 2)', (seed2Styles.bus || 0) >= 1, JSON.stringify(seed2Styles));
// The parked bus drives.
await ev(() => { const g = window.__game; const bus = g.cars.find((c) => c.name === 'KEYS LINER'); g.player.group.position.set(bus.position.x + 3, 0, bus.position.z); });
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
check('F enters the parked bus', await ev(() => window.__game.drivenCar?.name === 'KEYS LINER'));
const busBefore = await ev(() => ({ x: window.__game.drivenCar.position.x, z: window.__game.drivenCar.position.z }));
await page.keyboard.down('KeyW');
await page.waitForTimeout(5000);
await page.keyboard.up('KeyW');
const busAfter = await ev(() => ({ x: window.__game.drivenCar.position.x, z: window.__game.drivenCar.position.z, speed: window.__game.drivenCar.speed }));
// Same headless-timing note as the bike: the heavy bus only covered 0.12m
// in 2s of W. Speed proves it drives.
check('bus drives under W', busAfter.speed > 0.5 && Math.hypot(busAfter.x - busBefore.x, busAfter.z - busBefore.z) > 0.1, JSON.stringify({ before: busBefore, after: busAfter }));
await shot(page, `${SHOTS}/t-bus.png`);
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);

// ---- U. Police markings: POLICE lettering, VRPD, officer back ----
await loadGame();
check('NEW GAME starts (police markings test)', await newGame());
await ev(() => {
  window.__game.wanted.setStars(1);
  const unit = window.__game.police.spawnPursuitCar(window.__game.player.position, 12);
  const p = window.__game.player.position;
  unit.car.group.position.set(p.x + 2, 0, p.z);
  unit.car.speed = 0;
  unit.mode = 'direct';
});
let officerU = false;
for (let i = 0; i < 10 && !officerU; i += 1) {
  await page.waitForTimeout(1000);
  officerU = await ev(() => window.__game.police.pursuit.some((u) => u.officer));
}
check('officer exits the stopped pursuit car (markings test)', officerU);
await page.waitForTimeout(800);
const policeHud = await ev(() => document.getElementById('hud-police').textContent);
check('pursuit HUD says VRPD, never KEYS POLICE', policeHud.includes('VRPD') && !policeHud.includes('KEYS POLICE'), policeHud.slice(0, 80));
const markings = await ev(() => {
  const unit = window.__game.police.pursuit.find((u) => u.officer);
  if (!unit) return null;
  let side = 0, roof = 0, plates = 0, badges = 0, textured = 0;
  unit.car.group.traverse((child) => {
    if (!child.isMesh || !child.geometry || !child.geometry.parameters) return;
    const gp = child.geometry.parameters;
    const pos = child.position;
    const hasMap = Boolean(child.material && child.material.map);
    if (gp.width === 3.4 && gp.height === 0.42 && Math.abs(Math.abs(pos.x) - 0.99) < 0.01) { side += 1; if (hasMap) textured += 1; }
    if (gp.width === 1.6 && gp.height === 1.9 && Math.abs(pos.y - 1.46) < 0.01) { roof += 1; if (hasMap) textured += 1; }
    if (gp.width === 1.2 && gp.height === 0.4 && Math.abs(pos.y - 0.87) < 0.01) { plates += 1; if (hasMap) textured += 1; }
    if (gp.width === 0.45 && gp.height === 0.45 && Math.abs(Math.abs(pos.x) - 0.99) < 0.01) { badges += 1; if (hasMap) textured += 1; }
  });
  let backPolice = false;
  unit.officer.group.traverse((child) => {
    if (!child.isMesh || !child.geometry || !child.geometry.parameters) return;
    const gp = child.geometry.parameters;
    const pos = child.position;
    if (gp.width === 0.5 && gp.height === 0.18 && Math.abs(pos.y - 1.35) < 0.01 && Math.abs(pos.z - -0.22) < 0.01) backPolice = true;
  });
  return { side, roof, plates, badges, textured, backPolice };
});
note(`police markings: ${JSON.stringify(markings)}`);
check('POLICE lettering on both sides', markings && markings.side === 2, JSON.stringify(markings));
check('POLICE lettering on the roof', markings && markings.roof === 1, JSON.stringify(markings));
check('POLICE plates on hood + trunk', markings && markings.plates === 2, JSON.stringify(markings));
check('VRPD badge on both doors', markings && markings.badges === 2, JSON.stringify(markings));
check('all lettering carries a canvas texture', markings && markings.textured === 7, JSON.stringify(markings));
check('officer has POLICE on the back', markings && markings.backPolice === true, JSON.stringify(markings));
await shot(page, `${SHOTS}/u-police-car.png`);
await ev(() => window.__game.wanted.setStars(0));

// ---- V. Swimming, stamina, beachgoers, cars in deep water ----
await loadGame();
check('NEW GAME starts (swim test)', await newGame());
await ev(() => window.__game.player.group.position.set(0, 0, 360));
await page.waitForTimeout(600);
check('wading at 0.8m depth is not swimming', await ev(() => window.__game.player.swimming === false));
await ev(() => window.__game.player.group.position.set(0, 0, 368));
await page.waitForTimeout(600);
const swimState = await ev(() => ({
  swimming: window.__game.player.swimming,
  staminaVisible: !document.getElementById('hud-stamina').classList.contains('hidden'),
  prone: window.__game.player.group.rotation.x,
  stamina: window.__game.player.stamina,
}));
note(`swim state: ${JSON.stringify(swimState)}`);
check('deep water triggers the swim state', swimState.swimming === true, JSON.stringify(swimState));
check('stamina bar shows while swimming', swimState.staminaVisible === true);
check('swimmer lies prone in the water', Math.abs(swimState.prone - Math.PI / 2) < 0.2, `rotation.x=${swimState.prone}`);
await page.waitForTimeout(5000);
const staminaAfter = await ev(() => window.__game.player.stamina);
check('stamina drains while swimming', staminaAfter < swimState.stamina, `before=${swimState.stamina} after=${staminaAfter}`);
await ev(() => { const g = window.__game; g.player.stamina = 0; g.player.heading = 0; });
await page.waitForTimeout(300);
const zOut0 = await ev(() => window.__game.player.group.position.z);
await page.keyboard.down('KeyW');
await page.waitForTimeout(5000);
await page.keyboard.up('KeyW');
const zOut1 = await ev(() => window.__game.player.group.position.z);
check('at 0 stamina the swimmer cannot head out to sea', zOut1 - zOut0 < 0.5, `z ${zOut0.toFixed(1)} -> ${zOut1.toFixed(1)}`);
await ev(() => { window.__game.player.heading = Math.PI; });
await page.waitForTimeout(300);
const zBack0 = await ev(() => window.__game.player.group.position.z);
await page.keyboard.down('KeyW');
await page.waitForTimeout(5000);
await page.keyboard.up('KeyW');
const zBack1 = await ev(() => window.__game.player.group.position.z);
check('at 0 stamina the swimmer can still head back to shore', zBack0 - zBack1 > 0.5, `z ${zBack0.toFixed(1)} -> ${zBack1.toFixed(1)}`);
await ev(() => window.__game.player.group.position.set(0, 0, 330));
await page.waitForTimeout(600);
check('back on the sand the swim state ends', await ev(() => window.__game.player.swimming === false));
await page.waitForTimeout(3000);
const staminaLand = await ev(() => window.__game.player.stamina);
check('stamina refills on land', staminaLand > 0, `stamina=${staminaLand}`);
await shot(page, `${SHOTS}/v-swim.png`);
// Beachgoers follow the night-density rule.
const beachNoon = await ev(() => { window.__game.setGameMinutes(720); return { target: window.__game.beachgoers.target, people: window.__game.beachgoers.people.length }; });
await page.waitForTimeout(1000);
const beachNoon2 = await ev(() => window.__game.beachgoers.target);
await ev(() => window.__game.setGameMinutes(180));
await page.waitForTimeout(1000);
const beachNight = await ev(() => window.__game.beachgoers.target);
note(`beachgoers: noon target=${beachNoon2} (pool ${beachNoon.people}), 03:00 target=${beachNight}`);
check('16 beachgoers by day', beachNoon.people === 16 && beachNoon2 === 16, `pool=${beachNoon.people} target=${beachNoon2}`);
check('beach thins out at 03:00 (target 4)', beachNight === 4, `target=${beachNight}`);
// A car stalls in deep water and reverses back out.
await ev(() => window.__game.setGameMinutes(720));
await ev(() => { const g = window.__game; const car = g.cars.find((c) => c.name === 'PALM RUNNER'); g.player.group.position.set(car.position.x + 2, 0, car.position.z); });
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
check('mounted a car for the water test', await ev(() => window.__game.drivenCar !== null));
await ev(() => { const c = window.__game.drivenCar; c.heading = 0; c.group.rotation.y = 0; c.position.set(0, 0, 380); c.speed = 0; });
await page.waitForTimeout(300);
await page.keyboard.down('KeyW');
await page.waitForTimeout(3000);
await page.keyboard.up('KeyW');
const stalled = await ev(() => ({ speed: window.__game.drivenCar.speed, z: window.__game.drivenCar.position.z }));
check('car stalls in deep water (no forward speed)', Math.abs(stalled.speed) < 1, JSON.stringify(stalled));
await page.keyboard.down('KeyS');
await page.waitForTimeout(12000);
await page.keyboard.up('KeyS');
const reversed = await ev(() => ({ z: window.__game.drivenCar.position.z, speed: window.__game.drivenCar.speed }));
check('stalled car reverses back out of the water', reversed.z < 379.5 && reversed.speed < -0.5, `z ${stalled.z.toFixed(1)} -> ${reversed.z.toFixed(1)}, speed=${reversed.speed.toFixed(1)}`);
await shot(page, `${SHOTS}/v-car-water.png`);

// ---- W. Gangs: spawn in turf, distinct colours, taunt, fight back, map legend ----
await loadGame();
check('NEW GAME starts (gangs test)', await newGame());
const gangSpawn = await ev(() => {
  const g = window.__game.gangs;
  const turf = [
    { x0: -318, z0: -208, x1: 0, z1: -52 },
    { x0: 0, z0: -208, x1: 318, z1: -52 },
    { x0: -318, z0: -52, x1: 0, z1: 26 },
    { x0: 0, z0: -52, x1: 318, z1: 26 },
  ];
  const counts = [0, 0, 0, 0];
  let inTurf = 0;
  for (const m of g.members) {
    counts[m.gang] += 1;
    const p = m.mesh.group.position, t = turf[m.gang];
    if (p.x >= t.x0 && p.x <= t.x1 && p.z >= t.z0 && p.z <= t.z1) inTurf += 1;
  }
  return { total: g.members.length, counts, inTurf };
});
note(`gang spawn: ${JSON.stringify(gangSpawn)}`);
check('24 gang members spawn, 6 per gang', gangSpawn.total === 24 && gangSpawn.counts.every((c) => c === 6), JSON.stringify(gangSpawn.counts));
check('every member spawns inside its gang turf', gangSpawn.inTurf === 24, `${gangSpawn.inTurf}/24 in turf`);
const gangColours = await ev(() => {
  const g = window.__game.gangs;
  const out = [];
  for (let i = 0; i < 4; i++) {
    const m = g.members.find((x) => x.gang === i);
    let shirt = -1, bandana = -1;
    for (const c of m.mesh.group.children) {
      const pr = c.geometry && c.geometry.parameters;
      if (!pr) continue;
      if (pr.width === 0.66) shirt = c.material.color.getHex();
      if (pr.width === 0.5 && pr.height === 0.14) bandana = c.material.color.getHex();
    }
    out.push({ gang: i, shirt, bandana });
  }
  return out;
});
note(`gang colours: ${JSON.stringify(gangColours)}`);
check('each gang has a distinct shirt colour', new Set(gangColours.map((c) => c.shirt)).size === 4, gangColours.map((c) => c.shirt.toString(16)).join(','));
check('bandana exists and matches the gang shirt colour', gangColours.every((c) => c.bandana !== -1 && c.bandana === c.shirt), JSON.stringify(gangColours));
// Taunt: walk up to a LANTERN BOYS member, the toast shows a gang taunt.
const tauntPos = await ev(() => {
  const g = window.__game.gangs;
  const m = g.members.find((x) => x.gang === 2 && !x.dormant);
  const p = m.mesh.group.position;
  window.__game.player.group.position.set(p.x + 5, 0, p.z);
  return { x: p.x, z: p.z };
});
let tauntText = '';
for (let i = 0; i < 3; i++) {
  await page.waitForTimeout(1000);
  tauntText = await ev(() => document.getElementById('hud-message').textContent.trim());
  if (/tourist|harbor|street|Rook/.test(tauntText)) break;
}
note(`taunt toast: "${tauntText}" (near member at ${tauntPos.x.toFixed(0)},${tauntPos.z.toFixed(0)})`);
check('gang member taunts the player up close', /tourist|harbor|street|Rook/.test(tauntText), `"${tauntText}"`);
// Fight-back: park the peds (no bystanders in the punch ray), punch a member.
await ev(() => {
  for (const ped of window.__game.pedestrians.peds) {
    ped.dormant = true; ped.retryTimer = 999;
    ped.mesh.group.visible = false;
    ped.mesh.group.position.set(10000, 0, 10000);
  }
  const g = window.__game.gangs;
  const m = g.members.find((x) => x.gang === 2 && !x.dormant && x.knockedTimer <= 0);
  const p = m.mesh.group.position;
  window.__game.player.group.position.set(p.x + 1.2, 0, p.z);
  window.__game.player.heading = -Math.PI / 2;
});
await page.waitForTimeout(600);
await page.mouse.click(640, 360);
await page.waitForTimeout(1500);
const hostile = await ev(() => window.__game.gangs.members.filter((x) => x.gang === 2).map((x) => x.hostile));
note(`LANTERN BOYS hostile after punch: ${JSON.stringify(hostile)}`);
check('attacked gang member fights back (hostile)', hostile.some((h) => h), JSON.stringify(hostile));
// Night density: 03:00 thins the gangs like peds.
const nightGangs = await ev(() => {
  const g = window.__game.gangs;
  g.setDensity(180);
  const night = { target: g.target, active: g.activeCount };
  g.setDensity(720);
  const day = { target: g.target, active: g.activeCount };
  return { night, day };
});
note(`gang density: ${JSON.stringify(nightGangs)}`);
check('gangs thin out at 03:00 (target 5)', nightGangs.night.target === 5 && nightGangs.night.active === 5, JSON.stringify(nightGangs.night));
check('gangs return to full strength at noon (target 24)', nightGangs.day.target === 24 && nightGangs.day.active === 24, JSON.stringify(nightGangs.day));
// Map: legend names all four gangs; the turf tint paints the map.
await page.keyboard.press('KeyN');
await page.waitForTimeout(600);
const gangLegend = await ev(() => [...document.querySelectorAll('#map-legend .legend-grid span')].map((s) => {
  const sw = s.querySelector('i');
  return `${s.textContent.trim()}|${sw ? getComputedStyle(sw).backgroundColor : ''}`;
}));
note(`gang legend: ${gangLegend.filter((l) => /turf/.test(l)).join(' ; ')}`);
check('legend names all four gang turfs',
  gangLegend.some((l) => l.startsWith('PORT KINGS turf|rgb(154, 95, 208)')) &&
  gangLegend.some((l) => l.startsWith('HARBOR SAINTS turf|rgb(61, 168, 107)')) &&
  gangLegend.some((l) => l.startsWith('LANTERN BOYS turf|rgb(255, 122, 61)')) &&
  gangLegend.some((l) => l.startsWith('SOL MIRAMAR turf|rgb(214, 48, 62)')),
  gangLegend.filter((l) => /turf/.test(l)).join(' ; '));
const turfTint = await ev(() => {
  const hud = window.__game.hud;
  const canvas = document.getElementById('bigmap');
  const ctx = canvas.getContext('2d');
  hud.paintMap(ctx, 1024, 816, {
    playerPos: { x: 0, z: 0 }, playerHeading: 0, cars: [], driving: false,
    missionTarget: null, policeBlips: [], timeSeconds: 0, trafficBlips: [],
    ammoCrates: [], sideJobTarget: null, eventBlip: null, businessBlips: [],
    sprayPos: null, labels: false, fullMap: true,
  });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  // PORT KINGS tint: land #2a2436 + 18% purple #9a5fd0 = ~(62,47,82).
  const tinted = (r, g, b) => Math.abs(r - 62) <= 8 && Math.abs(g - 47) <= 8 && Math.abs(b - 82) <= 8;
  const sample = (x0, z0, x1, z1) => {
    const a = hud.toMap(x0, z0, width, height, hud.mapView);
    const b = hud.toMap(x1, z1, width, height, hud.mapView);
    let n = 0;
    for (let y = Math.max(0, Math.floor(a.y)); y <= Math.min(height - 1, Math.ceil(b.y)); y += 3) {
      for (let x = Math.max(0, Math.floor(a.x)); x <= Math.min(width - 1, Math.ceil(b.x)); x += 3) {
        const i = (y * width + x) * 4;
        if (tinted(data[i], data[i + 1], data[i + 2])) n += 1;
      }
    }
    return n;
  };
  return {
    portKings: sample(-318, -208, 0, -52),
    control: sample(-318, 156, 0, 318), // SOUTH POINT has no gang
  };
});
note(`turf tint pixels: ${JSON.stringify(turfTint)}`);
check('gang turf tint paints the full map', turfTint.portKings >= 50 && turfTint.control === 0, JSON.stringify(turfTint));
await page.keyboard.press('KeyN');
await page.waitForTimeout(300);
// Street-level screenshot of a gang group for the dossier.
await ev(() => {
  const g = window.__game.gangs;
  const m = g.members.find((x) => x.gang === 2 && !x.dormant);
  const p = m.mesh.group.position;
  window.__game.player.group.position.set(p.x + 6, 0, p.z);
  window.__game.player.heading = -Math.PI / 2;
});
await page.waitForTimeout(1200);
await shot(page, `${SHOTS}/w-gangs-street.png`);

// ---- Summary ----
console.log(`\nfixbatch5: ${results.length - fails}/${results.length} checks passed, ${fails} failed`);
if (errors.length) {
  console.log(`page errors (${errors.length}):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
}
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
