// Fix-batch 4 test (20/11): briefing survives a W-tap approach (live
// playtest: M1's briefing never opened — W dismissed it the frame it
// appeared), full-map icon scale, beacon fade near the player, dispatch
// popup moved off the centre, 768px layout no-overlap.
// Runs over file:// like the other suites; localStorage persists across
// reloads within one browser instance, which is all the save checks need.
// Run: node tools/fixbatch4-test.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const GAME_URL = 'file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?seed=1';
const SHOTS = '/home/hatch/workspace/makefun/gta6-01/bugcheck-20261119/fixbatch4-shots';
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
// Screenshots are evidence, not assertions: the renderer can stall on
// ReadPixels under the 12x12 city load, so retry once, then continue.
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
  await page.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
  await page.waitForTimeout(500);
}
async function newGame() {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.evaluate(() => document.getElementById('start-button')?.click());
    await page.waitForTimeout(300);
    if (await ev(() => window.__game.state === 'play')) return true;
  }
  return ev(() => window.__game.state === 'play');
}
const phoneOpen = () => ev(() => !document.getElementById('phone-panel').classList.contains('hidden'));
// One real W tap: key down long enough to span a headless frame, then up.
async function tapW() {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(110);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(60);
}

// ---- A. Briefing survives a W-tap approach (the critical regression) ----
await loadGame();
check('NEW GAME starts (briefing W-tap test)', await newGame());
await ev(() => {
  const g = window.__game;
  g.traffic.cars = [];
  // 14m south of Mara's marker, facing north (-z) toward it.
  g.player.group.position.set(52, 0, 14);
  g.player.heading = Math.PI;
  g.player.group.rotation.y = Math.PI;
});
check('phone hidden before the approach', !(await phoneOpen()));
let openedAtTap = -1;
for (let tap = 0; tap < 80 && openedAtTap < 0; tap += 1) {
  await tapW();
  if (await phoneOpen()) openedAtTap = tap + 1;
}
const approach = await ev(() => ({
  z: +window.__game.player.group.position.z.toFixed(1),
  dist: +Math.hypot(window.__game.player.group.position.x - 52, window.__game.player.group.position.z).toFixed(1),
  armed: window.__game.missions.briefingArmed,
  atMarker: window.__game.missions.atMarker,
}));
note(`briefing opened after ${openedAtTap} W taps, player at ${JSON.stringify(approach)}`);
check('briefing OPENS during a W-tap approach (was: never opened live)', openedAtTap > 0, `taps=${openedAtTap} ${JSON.stringify(approach)}`);
// Keep walking with W: the briefing must stay open, tap after tap.
let stayedOpen = true;
for (let tap = 0; tap < 12; tap += 1) {
  await tapW();
  if (!(await phoneOpen())) { stayedOpen = false; break; }
}
const afterWalk = await ev(() => ({
  z: +window.__game.player.group.position.z.toFixed(1),
  armed: window.__game.missions.briefingArmed,
}));
check('briefing STAYS open across 12 more W taps', stayedOpen, JSON.stringify(afterWalk));
check('briefing still armed after walking in with W', afterWalk.armed === true, JSON.stringify(afterWalk));
await page.evaluate(() => document.getElementById('phone-accept')?.click());
await page.waitForTimeout(500);
check('ACCEPT after a W-tap approach starts M1',
  await ev(() => window.__game.missions.currentMission()?.name === 'FIRST FARE' && window.__game.missions.curIdx === 0));
// Escape still dismisses (regression guard for the remaining dismiss path).
await loadGame();
check('NEW GAME starts (Escape dismiss guard)', await newGame());
await ev(() => { window.__game.player.group.position.set(52, 0, 0); });
let escOpened = false;
for (let i = 0; i < 20 && !escOpened; i += 1) {
  escOpened = await phoneOpen();
  if (!escOpened) await page.waitForTimeout(250);
}
check('briefing opens on teleport to the marker', escOpened);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
check('Escape still dismisses the briefing', !(await phoneOpen()));

// ---- B. Full-map icon scale (bigmap canvas, pixel-measured) ----
await loadGame();
check('NEW GAME starts (full-map icon test)', await newGame());
await ev(() => {
  const g = window.__game;
  for (const c of g.cars) c.group.position.set(500, 0, 500);
  g.traffic.cars = [];
  g.player.group.position.set(-150, 0, -150);
});
await page.waitForTimeout(1000);
const fullIcons = await ev(() => {
  const hud = window.__game.hud;
  const canvas = document.getElementById('bigmap');
  const ctx = canvas.getContext('2d');
  hud.paintMap(ctx, 1024, 816, {
    playerPos: { x: -150, z: -150 }, playerHeading: 0, cars: [], driving: false,
    missionTarget: { x: 52, z: 0 }, policeBlips: [], timeSeconds: 0, trafficBlips: [],
    ammoCrates: [{ x: 26, z: 26, available: true }, { x: -78, z: -52, available: true }, { x: 78, z: -130, available: true }],
    sideJobTarget: { x: -52, z: 52 }, eventBlip: null,
    businessBlips: [{ x: 52, z: 52, owned: false }, { x: -52, z: -52, owned: false }, { x: 104, z: -104, owned: false }],
    sprayPos: { x: 104, z: -52 }, labels: false,
  });
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const match = (x, y, test) => {
    const i = (y * width + x) * 4;
    return test(data[i], data[i + 1], data[i + 2]);
  };
  const cluster = (wx, wz, test) => {
    const p = hud.toMap(wx, wz, width, height);
    const cx = Math.round(p.x), cy = Math.round(p.y);
    let minX = 999, maxX = -1, minY = 999, maxY = -1, n = 0;
    for (let y = Math.max(0, cy - 20); y <= Math.min(height - 1, cy + 20); y += 1) {
      for (let x = Math.max(0, cx - 20); x <= Math.min(width - 1, cx + 20); x += 1) {
        if (match(x, y, test)) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          n += 1;
        }
      }
    }
    return n === 0 ? null : { w: maxX - minX + 1, h: maxY - minY + 1, n };
  };
  const white = (r, g, b) => r > 240 && g > 240 && b > 240;
  const teal = (r, g, b) => r > 20 && r < 60 && g > 190 && b > 180 && b < 220;
  const gold = (r, g, b) => r > 250 && g > 200 && g < 230 && b > 100 && b < 140;
  const green = (r, g, b) => r > 100 && r < 140 && g > 240 && b > 180 && b < 210;
  return {
    mission: cluster(52, 0, white),
    spray: cluster(104, -52, teal),
    taxiBiz: cluster(52, 52, gold),
    clubBiz: cluster(-52, -52, gold),
    dealerBiz: cluster(104, -104, gold),
    ammo1: cluster(26, 26, green),
    ammo2: cluster(-78, -52, green),
    ammo3: cluster(78, -130, green),
    sideJob: cluster(-52, 52, green),
  };
});
note(`full-map icon sizes (bigmap px): ${JSON.stringify(fullIcons)}`);
// Geometry on the 1024px map (m = sqrt(1024/168) = 2.47): r5 diamonds are
// ~25px across, the r6 mission diamond ~30px; anti-aliasing eats ~1-2px.
const dest = ['spray', 'taxiBiz', 'clubBiz', 'dealerBiz', 'ammo1', 'ammo2', 'ammo3', 'sideJob'];
const destOk = dest.every((k) => fullIcons[k] && fullIcons[k].h >= 20 && fullIcons[k].h <= 26);
check('every destination diamond is 20–26px tall on the full map', destOk, JSON.stringify(fullIcons));
check('mission diamond is 24–30px tall on the full map (slightly larger)',
  fullIcons.mission && fullIcons.mission.h >= 24 && fullIcons.mission.h <= 30, JSON.stringify(fullIcons.mission));
const destHeights = dest.map((k) => fullIcons[k]?.h ?? -1);
check('destination diamonds are one family (max-min <= 6px)',
  Math.max(...destHeights) - Math.min(...destHeights) <= 6, JSON.stringify(destHeights));
check('no small green square remains: ammo diamonds are full-size',
  ['ammo1', 'ammo2', 'ammo3'].every((k) => fullIcons[k] && fullIcons[k].h >= 20), JSON.stringify({ a1: fullIcons.ammo1, a2: fullIcons.ammo2, a3: fullIcons.ammo3 }));
// The real N-key map still renders (state assembly path, not just paintMap).
await page.keyboard.press('KeyN');
await page.waitForTimeout(600);
check('N opens the full map screen', await ev(() => !document.getElementById('map-screen').classList.contains('hidden')));
await shot(page, `${SHOTS}/fullmap.png`);
await page.keyboard.press('KeyN');
await page.waitForTimeout(300);

// ---- C. Beacon fade near the player ----
await loadGame();
check('NEW GAME starts (beacon fade test)', await newGame());
const opacityAt = async (x, z, read) => {
  await ev(([px, pz]) => { window.__game.player.group.position.set(px, 0, pz); }, [x, z]);
  await page.waitForTimeout(700);
  return ev(read);
};
const missionOp = (x, z) => opacityAt(x, z, () => window.__game.missions.beacon.pillar.material.opacity);
const opAt0 = await missionOp(52, 0);
const opAt10 = await missionOp(52, 10);
const opFar = await missionOp(0, 0);
note(`mission beacon opacity: at 0m=${opAt0.toFixed(2)} at 10m=${opAt10.toFixed(2)} at 52m=${opFar.toFixed(2)}`);
check('mission beacon nearly invisible at 0m (<= 0.20)', opAt0 <= 0.2, `opacity=${opAt0.toFixed(2)}`);
check('mission beacon half-faded at 10m (0.45–0.75)', opAt10 >= 0.45 && opAt10 <= 0.75, `opacity=${opAt10.toFixed(2)}`);
check('mission beacon full strength at 52m (>= 0.80)', opFar >= 0.8, `opacity=${opFar.toFixed(2)}`);
const bizOp = (x, z) => opacityAt(x, z, () => window.__game.businesses.beacons[0].pillar.material.opacity);
const bizNear = await bizOp(52, 52);
const bizFar = await bizOp(0, 0);
note(`business beacon opacity: at 0m=${bizNear.toFixed(2)} at 73m=${bizFar.toFixed(2)}`);
check('business beacon nearly invisible at 0m (<= 0.20)', bizNear <= 0.2, `opacity=${bizNear.toFixed(2)}`);
check('business beacon full strength far away (>= 0.80)', bizFar >= 0.8, `opacity=${bizFar.toFixed(2)}`);
// Spray beacon: found by its teal pillar material in the scene graph.
const sprayOp = (x, z) => opacityAt(x, z, () => {
  let found = null;
  window.__game.scene.traverse((o) => {
    if (found !== null) return;
    if (o.isMesh && o.geometry && o.geometry.type === 'CylinderGeometry' && o.material && o.material.color && o.material.color.getHex() === 0x2ad0c4) found = o.material.opacity;
  });
  return found;
});
const sprayNear = await sprayOp(104, -52);
const sprayFar = await sprayOp(0, 0);
note(`spray beacon opacity: at 0m=${sprayNear?.toFixed(2)} at 116m=${sprayFar?.toFixed(2)}`);
check('spray beacon nearly invisible at 0m (<= 0.20)', sprayNear !== null && sprayNear <= 0.2, `opacity=${sprayNear?.toFixed(2)}`);
check('spray beacon full strength far away (>= 0.80)', sprayFar !== null && sprayFar >= 0.8, `opacity=${sprayFar?.toFixed(2)}`);
// Side-job beacon: force a deterministic delivery job, stand just off its
// beacon. Teleporting ONTO it would trigger the 4m delivery pickup and
// move the beacon, so stand 6m off in the first direction that keeps the
// job in its pickup stage, and assert against the fade curve at the
// distance actually measured back (the collision resolver may push the
// player a little).
await ev(() => { window.__game.sideJobs.forceJob('delivery'); });
await page.waitForTimeout(600);
let sjNear = null;
for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) {
  await ev(([ox, oz]) => {
    const g = window.__game;
    const b = g.sideJobs.beacon.group.position;
    g.player.group.position.set(b.x + ox, 0, b.z + oz);
  }, [dx, dz]);
  await page.waitForTimeout(700);
  const read = await ev(() => {
    const g = window.__game;
    const p = g.player.group.position;
    const b = g.sideJobs.beacon.group.position;
    return {
      dist: +Math.hypot(p.x - b.x, p.z - b.z).toFixed(1),
      opacity: +g.sideJobs.beacon.pillar.material.opacity.toFixed(2),
      stage: g.sideJobs.job?.stage,
    };
  });
  if (read.stage === 'pickup' && read.dist >= 4 && read.dist < 10) { sjNear = read; break; }
  await ev(() => { window.__game.sideJobs.forceJob('delivery'); });
  await page.waitForTimeout(600);
}
note(`side-job beacon near: ${JSON.stringify(sjNear)}`);
const sjExpected = sjNear ? 0.95 * Math.min(1, Math.max(0.12, (sjNear.dist - 2) / 12)) + 0.05 : -1;
check('side-job beacon faded near the player (matches the fade curve)',
  sjNear !== null && sjNear.opacity <= sjExpected, JSON.stringify({ ...sjNear, expectedMax: +sjExpected.toFixed(2) }));
const sjFar = await ev(() => {
  const g = window.__game;
  const b = g.sideJobs.beacon.group.position;
  g.player.group.position.set(b.x + 40, 0, b.z);
  return true;
});
await page.waitForTimeout(700);
const sjFarRead = await ev(() => {
  const g = window.__game;
  const p = g.player.group.position;
  const b = g.sideJobs.beacon.group.position;
  return {
    dist: +Math.hypot(p.x - b.x, p.z - b.z).toFixed(1),
    opacity: +g.sideJobs.beacon.pillar.material.opacity.toFixed(2),
  };
});
note(`side-job beacon far: ${JSON.stringify(sjFarRead)}`);
check('side-job beacon full strength 40m away (>= 0.80)', sjFarRead.opacity >= 0.8, JSON.stringify(sjFarRead));
// The ground ring still marks the spot up close (its own material, unfaded).
const ringOp = await ev(() => window.__game.missions.beacon.ring.material.opacity);
check('mission ground ring stays visible up close (>= 0.85)', ringOp >= 0.85, `opacity=${ringOp.toFixed(2)}`);

// ---- D. Dispatch popup sits in the upper area, not the centre ----
await loadGame();
check('NEW GAME starts (dispatch position test)', await newGame());
const msgTop = await ev(() => getComputedStyle(document.getElementById('hud-message')).top);
check('#hud-message is pinned to top:150px (fix batch 5: 120px overlapped the objective line)',
  msgTop === '150px', `top=${msgTop}`);
await ev(() => { window.__game.hud.showMessage('BANK ROBBERY — Stop the getaway car! $500 REWARD', 5, true); });
await page.waitForTimeout(400);
const msgBox = await ev(() => {
  const b = document.getElementById('hud-message').getBoundingClientRect();
  return { top: Math.round(b.top), bottom: Math.round(b.bottom), height: Math.round(b.height), visible: document.getElementById('hud-message').classList.contains('visible') };
});
note(`dispatch banner box at 1280x720: ${JSON.stringify(msgBox)}`);
check('dispatch banner shows in the upper area (bottom < 45% of viewport height)',
  msgBox.visible && msgBox.bottom < 720 * 0.45, JSON.stringify(msgBox));
check('dispatch banner clears the vertical centre (top < 30% of viewport height)',
  msgBox.top < 720 * 0.3, JSON.stringify(msgBox));
await shot(page, `${SHOTS}/dispatch-top.png`);

// ---- E. Layout: no overlap at 768px, 860/880px (wrap boundary), 480px, 1280px ----
async function layoutAt(width, height, label) {
  const p = await browser.newPage({ viewport: { width, height } });
  p.on('pageerror', (e) => errors.push(`PAGEERROR(${label}): ${e.message}`));
  await p.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
  await p.waitForTimeout(500);
  await p.evaluate(() => document.getElementById('start-button')?.click());
  await p.waitForTimeout(800);
  const boxes = await p.evaluate(() => {
    const r = (id) => {
      const b = document.getElementById(id).getBoundingClientRect();
      return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width), height: Math.round(b.height) };
    };
    return { minimap: r('hud-minimap'), speedo: r('hud-speedo'), hint: r('hud-hint'), bars: r('hud-bars'), canvas: r('minimap') };
  });
  note(`${label} boxes: ${JSON.stringify(boxes)}`);
  await shot(p, `${SHOTS}/layout-${label}.png`);
  await p.close();
  return boxes;
}
const b768 = await layoutAt(768, 1024, '768x1024');
check('768px: minimap shrinks to 120px', b768.canvas.width === 120 && b768.canvas.height === 120, JSON.stringify(b768.canvas));
check('768px: hint strip does not overlap the minimap', b768.hint.top >= b768.minimap.bottom, JSON.stringify({ hintTop: b768.hint.top, minimapBottom: b768.minimap.bottom }));
check('768px: hint strip does not overlap the speedo', b768.hint.top >= b768.speedo.bottom, JSON.stringify({ hintTop: b768.hint.top, speedoBottom: b768.speedo.bottom }));
check('768px: bars sit above the minimap', b768.bars.bottom <= b768.minimap.top, JSON.stringify({ barsBottom: b768.bars.bottom, minimapTop: b768.minimap.top }));
const b768l = await layoutAt(768, 432, '768x432');
check('768x432 landscape: hint strip does not overlap the minimap', b768l.hint.top >= b768l.minimap.bottom, JSON.stringify({ hintTop: b768l.hint.top, minimapBottom: b768l.minimap.bottom }));
check('768x432 landscape: hint strip does not overlap the speedo', b768l.hint.top >= b768l.speedo.bottom, JSON.stringify({ hintTop: b768l.hint.top, speedoBottom: b768l.speedo.bottom }));
// Boundary: the hint text is ~857px wide, so it wraps just below that —
// the 880px breakpoint must already have the bottom row lifted there.
const b860 = await layoutAt(860, 600, '860x600');
check('860px: hint strip does not overlap the minimap', b860.hint.top >= b860.minimap.bottom, JSON.stringify({ hintTop: b860.hint.top, minimapBottom: b860.minimap.bottom, hintH: b860.hint.height }));
check('860px: hint strip does not overlap the speedo', b860.hint.top >= b860.speedo.bottom, JSON.stringify({ hintTop: b860.hint.top, speedoBottom: b860.speedo.bottom }));
const b880 = await layoutAt(880, 600, '880x600');
check('880px: hint strip does not overlap the minimap', b880.hint.top >= b880.minimap.bottom, JSON.stringify({ hintTop: b880.hint.top, minimapBottom: b880.minimap.bottom, hintH: b880.hint.height }));
check('880px: hint strip does not overlap the speedo', b880.hint.top >= b880.speedo.bottom, JSON.stringify({ hintTop: b880.hint.top, speedoBottom: b880.speedo.bottom }));
const b480 = await layoutAt(480, 800, '480x800');
check('480px: minimap stays 120px', b480.canvas.width === 120 && b480.canvas.height === 120, JSON.stringify(b480.canvas));
check('480px: hint strip does not overlap the minimap', b480.hint.top >= b480.minimap.bottom, JSON.stringify({ hintTop: b480.hint.top, minimapBottom: b480.minimap.bottom }));
check('480px: hint strip does not overlap the speedo', b480.hint.top >= b480.speedo.bottom, JSON.stringify({ hintTop: b480.hint.top, speedoBottom: b480.speedo.bottom }));
const b1280 = await layoutAt(1280, 720, '1280x720');
check('1280px: minimap is the large 260x220 rectangle', b1280.canvas.width === 260 && b1280.canvas.height === 220, JSON.stringify(b1280.canvas));
check('1280px: hint strip does not overlap the minimap', b1280.hint.top >= b1280.minimap.bottom, JSON.stringify({ hintTop: b1280.hint.top, minimapBottom: b1280.minimap.bottom }));
check('1280px: hint strip does not overlap the speedo', b1280.hint.top >= b1280.speedo.bottom, JSON.stringify({ hintTop: b1280.hint.top, speedoBottom: b1280.speedo.bottom }));

// ---- Summary ----
console.log(`\nfixbatch4: ${results.length - fails}/${results.length} checks passed, ${fails} failed`);
if (errors.length) {
  console.log(`page errors (${errors.length}):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
}
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
