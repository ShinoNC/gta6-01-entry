// Fix-batch 3 test (20/11): M1 pickup needs a car, Stage 3 distance+arrow,
// carjack prompt staleness, briefing dismiss/cooldown, par timer over-par,
// save restores car + mission stage, map icon scale, headlight brightness,
// portrait 480px layout, FIRST WHEELS +$100 verdict.
// Runs over file:// like the other suites; localStorage persists across
// reloads within one browser instance, which is all the save checks need.
// Run: node tools/fixbatch3-test.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const GAME_URL = 'file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?seed=1';
const SHOTS = '/home/hatch/workspace/makefun/gta6-01/bugcheck-20261119/fixbatch3-shots';
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
async function waitForPhone(timeoutMs = 8000) {
  for (let i = 0; i < timeoutMs / 250; i += 1) {
    if (await ev(() => !document.getElementById('phone-panel').classList.contains('hidden'))) return true;
    await page.waitForTimeout(250);
  }
  return false;
}
async function acceptM1() {
  await ev(() => { window.__game.player.group.position.set(52, 0, 0); });
  if (!(await waitForPhone())) return false;
  await domClick('#phone-accept');
  await page.waitForTimeout(400);
  return ev(() => window.__game.missions.currentMission()?.name === 'FIRST FARE');
}
async function enterStarterCar() {
  await ev(() => {
    const g = window.__game;
    const car = g.cars.find((c) => c.name === 'SOLSTICE GT');
    g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  return ev(() => window.__game.drivenCar?.name === 'SOLSTICE GT');
}
async function driveTo(x, z) {
  await ev(([tx, tz]) => {
    const g = window.__game;
    g.drivenCar.group.position.set(tx, 0, tz);
    g.drivenCar.speed = 0;
  }, [x, z]);
}

await loadGame();

// ---- A. M1 pickup needs a car (bugs 1+2) ----
check('NEW GAME starts (M1 needsCar test)', await newGame());
check('M1 accepted at Mara\'s marker', await acceptM1());
const m1Start = await ev(() => ({ stage: window.__game.missions.stageIndex, target: window.__game.missions.target }));
check('M1 stage 1/3, target is the east pier (104,0)', m1Start.stage === 0 && m1Start.target?.x === 104 && m1Start.target?.z === 0, JSON.stringify(m1Start));
// On foot at the pier: the pickup must NOT advance, and the hint shows.
await ev(() => { window.__game.player.group.position.set(104, 0, 0); });
await page.waitForTimeout(4000);
const onFoot = await ev(() => ({
  stage: window.__game.missions.stageIndex,
  hint: window.__game.missions.needsCarHint,
  objective: document.getElementById('hud-objective').textContent,
}));
check('on foot at the pier: M1 stays at stage 1/3', onFoot.stage === 0, JSON.stringify(onFoot));
check('on foot at the pier: hint says get in a car first',
  onFoot.hint === true && onFoot.objective.includes('get in a car first'), JSON.stringify(onFoot));
// Now drive: the pickup + 2s wait must advance to the delivery stage.
check('entered the starter car', await enterStarterCar());
await driveTo(104, 0);
for (let i = 0; i < 40; i += 1) {
  if (await ev(() => window.__game.missions.stageIndex >= 2)) break;
  await page.waitForTimeout(1000);
}
const delivery = await ev(() => ({
  stage: window.__game.missions.stageIndex,
  objective: document.getElementById('hud-objective').textContent,
}));
check('driving to the pier advances to stage 3/3', delivery.stage === 2, JSON.stringify(delivery));
check('stage 3 shows distance + arrow to Palm Row',
  delivery.objective.includes('Drop the client at Palm Row') && /\d+m [↑↓←→]/.test(delivery.objective), JSON.stringify(delivery));
await driveTo(-52, 52);
for (let i = 0; i < 12; i += 1) {
  if (await ev(() => window.__game.missions.doneCount() === 1)) break;
  await page.waitForTimeout(1000);
}
const m1Done = await ev(() => ({ done: window.__game.missions.doneCount(), money: window.__game.money }));
check('M1 completes driving, pays $500', m1Done.done === 1 && m1Done.money === 1750, JSON.stringify(m1Done));

// ---- B. Carjack prompt follows the live F condition (bug 3) ----
await loadGame();
check('NEW GAME starts (prompt test)', await newGame());
await ev(() => {
  const g = window.__game;
  for (const c of g.cars) c.group.position.set(500, 0, 500);
  g.traffic.cars = [];
});
await page.waitForTimeout(2000);
let strayPrompt = false;
for (let i = 0; i < 6; i += 1) {
  const vis = await ev(() => document.getElementById('hud-message').classList.contains('visible')
    && document.getElementById('hud-message').textContent.includes('Press F'));
  if (vis) strayPrompt = true;
  await page.waitForTimeout(200);
}
check('no Press-F prompt when every car is 500m away', !strayPrompt);
// Prompt appears next to a car, then hides the moment the car is gone.
// (Visibility, not text: the element keeps stale text after hiding.)
await ev(() => {
  const g = window.__game;
  g.cars[0].group.position.set(2, 0, -8);
  g.player.group.position.set(4, 0, -8);
});
let promptSeen = false;
for (let i = 0; i < 10 && !promptSeen; i += 1) {
  promptSeen = await ev(() => document.getElementById('hud-message').classList.contains('visible')
    && document.getElementById('hud-message').textContent.includes('Press F to drive SOLSTICE GT'));
  await page.waitForTimeout(200);
}
check('prompt shows next to the starter car', promptSeen);
await ev(() => { window.__game.cars[0].group.position.set(500, 0, 500); });
let promptGone = false;
for (let i = 0; i < 8 && !promptGone; i += 1) {
  promptGone = await ev(() => !document.getElementById('hud-message').classList.contains('visible')
    || !document.getElementById('hud-message').textContent.includes('Press F'));
  await page.waitForTimeout(200);
}
check('prompt hides within ~1.5s after the car teleports away', promptGone);
// Latch: 6m away within 1.5s of a 5m sighting still shows the prompt.
await ev(() => {
  const g = window.__game;
  g.cars[0].group.position.set(2, 0, -8);
  g.player.group.position.set(2, 0, -8);
});
await page.waitForTimeout(600);
await ev(() => { window.__game.player.group.position.set(8, 0, -8); });
let latchPrompt = false;
for (let i = 0; i < 6 && !latchPrompt; i += 1) {
  latchPrompt = await ev(() => document.getElementById('hud-message').classList.contains('visible')
    && document.getElementById('hud-message').textContent.includes('Press F'));
  await page.waitForTimeout(200);
}
check('prompt still shows at 6m inside the 1.5s latch', latchPrompt);
// The latch runs on GAME time, which crawls in headless (~0.3–0.5x real),
// so poll up to 20s real for it to expire instead of waiting a fixed 2s.
let latchHidden = false;
for (let i = 0; i < 20 && !latchHidden; i += 1) {
  await page.waitForTimeout(1000);
  latchHidden = await ev(() => !document.getElementById('hud-message').classList.contains('visible')
    || !document.getElementById('hud-message').textContent.includes('Press F'));
}
check('prompt hides after the latch expires at 6m', latchHidden);

// ---- C. Briefing dismiss + cooldown (bug 4) ----
await loadGame();
check('NEW GAME starts (briefing test)', await newGame());
await ev(() => { window.__game.player.group.position.set(52, 0, 0); });
check('briefing opens at Mara\'s marker', await waitForPhone());
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
check('Escape dismisses the briefing', await ev(() => document.getElementById('phone-panel').classList.contains('hidden')));
await page.waitForTimeout(3000);
check('briefing does NOT reopen while still at the marker (3s)', await ev(() => document.getElementById('phone-panel').classList.contains('hidden')));
await ev(() => { window.__game.player.group.position.set(0, 0, 0); });
await page.waitForTimeout(1000);
await ev(() => { window.__game.player.group.position.set(52, 0, 0); });
check('briefing reopens after leaving (>15m) and re-entering', await waitForPhone());
await page.keyboard.press('KeyW');
await page.waitForTimeout(600);
check('W does NOT dismiss the briefing (W is the move key — fix batch 4)', await ev(() => !document.getElementById('phone-panel').classList.contains('hidden')));
await ev(() => { window.__game.player.group.position.set(0, 0, 0); });
await page.waitForTimeout(1000);
await ev(() => { window.__game.player.group.position.set(52, 0, 0); });
check('briefing reopens a second time after leaving and re-entering', await waitForPhone());
await ev(() => { window.__game.player.group.position.set(100, 0, 0); });
let autoHidden = false;
for (let i = 0; i < 8 && !autoHidden; i += 1) {
  autoHidden = await ev(() => document.getElementById('phone-panel').classList.contains('hidden'));
  await page.waitForTimeout(250);
}
check('briefing auto-hides when the player walks >15m away', autoHidden);

// ---- D. Par timer counts over par (bug 5) ----
await loadGame();
check('NEW GAME starts (par timer test)', await newGame());
check('M1 accepted (par timer test)', await acceptM1());
await ev(() => {
  const m = window.__game.missions;
  m.missionClock = m.parSeconds + 83;
});
await page.waitForTimeout(800);
const parLine = await ev(() => window.__game.missions.progressLine());
const parHud = await page.textContent('#hud-mission');
check('past par the timer shows +1:23 OVER PAR', parLine.includes('+1:23 OVER PAR'), parLine);
check('HUD mission line shows OVER PAR', parHud.includes('OVER PAR'), parHud);

// ---- E. Save restores the car + the mission stage (bug 6) ----
await loadGame();
check('NEW GAME starts (save test)', await newGame());
check('M1 accepted (save test)', await acceptM1());
check('entered the starter car (save test)', await enterStarterCar());
await driveTo(104, 0);
for (let i = 0; i < 40; i += 1) {
  if (await ev(() => window.__game.missions.stageIndex >= 2)) break;
  await page.waitForTimeout(1000);
}
check('M1 reached stage 3/3 before saving', await ev(() => window.__game.missions.stageIndex === 2));
await ev(() => {
  const g = window.__game;
  g.drivenCar.group.position.set(30, 0, 0);
  g.drivenCar.heading = Math.PI / 2;
  g.drivenCar.group.rotation.y = g.drivenCar.heading;
  g.drivenCar.speed = 0;
  g.save.saveGame(1, g.snapshotSave());
});
await loadGame();
await domClick('#continue-button');
await page.waitForTimeout(1000);
const restored = await ev(() => ({
  driving: !!window.__game.drivenCar,
  carName: window.__game.drivenCar?.name,
  carX: +window.__game.drivenCar?.position.x.toFixed(1),
  carZ: +window.__game.drivenCar?.position.z.toFixed(1),
  carHeading: +window.__game.drivenCar?.heading.toFixed(2),
  curIdx: window.__game.missions.curIdx,
  stage: window.__game.missions.stageIndex,
  target: window.__game.missions.target,
  phoneHidden: document.getElementById('phone-panel').classList.contains('hidden'),
}));
check('CONTINUE mid-M1 restores the driven car at the saved spot',
  restored.driving && restored.carName === 'SOLSTICE GT' && Math.abs(restored.carX - 30) < 1 && Math.abs(restored.carZ) < 1, JSON.stringify(restored));
check('CONTINUE mid-M1 resumes stage 3/3 (no briefing reopen)',
  restored.curIdx === 0 && restored.stage === 2 && restored.target?.x === -52 && restored.target?.z === 52 && restored.phoneHidden, JSON.stringify(restored));
// Free-roam car restore.
await loadGame();
check('NEW GAME starts (free-roam save test)', await newGame());
check('entered the starter car (free-roam save test)', await enterStarterCar());
await driveTo(80, -52);
await ev(() => { const g = window.__game; g.save.saveGame(1, g.snapshotSave()); });
await loadGame();
await domClick('#continue-button');
await page.waitForTimeout(1000);
const restoredFree = await ev(() => ({
  driving: !!window.__game.drivenCar,
  carName: window.__game.drivenCar?.name,
  carX: +window.__game.drivenCar?.position.x.toFixed(1),
  carZ: +window.__game.drivenCar?.position.z.toFixed(1),
}));
check('CONTINUE in free roam restores the driven car (80,-52)',
  restoredFree.driving && restoredFree.carName === 'SOLSTICE GT' && Math.abs(restoredFree.carX - 80) < 1 && Math.abs(restoredFree.carZ + 52) < 1, JSON.stringify(restoredFree));
// Traffic-car fallback: a saved KEYS TAXI is recreated, not lost.
await loadGame();
check('NEW GAME starts (taxi restore test)', await newGame());
await ev(() => {
  const g = window.__game;
  const snap = g.snapshotSave();
  // On the x=0 road: a building-block spawn would be pushed out by the
  // collision resolver before the test reads the position back.
  snap.car = { name: 'KEYS TAXI', style: 'sedan', hp: 80, x: 0, z: 10, heading: 0 };
  snap.playerX = 0;
  snap.playerZ = 10;
  snap.heading = 0;
  g.save.saveGame(1, snap);
});
await loadGame();
await domClick('#continue-button');
await page.waitForTimeout(1000);
const restoredTaxi = await ev(() => ({
  driving: !!window.__game.drivenCar,
  carName: window.__game.drivenCar?.name,
  carX: +window.__game.drivenCar?.position.x.toFixed(1),
  carZ: +window.__game.drivenCar?.position.z.toFixed(1),
  hp: window.__game.drivenCar?.hp,
  owned: window.__game.drivenCar?.owned,
}));
check('CONTINUE restores a stolen taxi (recreated with saved hp)',
  restoredTaxi.driving && restoredTaxi.carName === 'KEYS TAXI' && Math.abs(restoredTaxi.carX) < 1 && Math.abs(restoredTaxi.carZ - 10) < 1 && restoredTaxi.hp === 80 && restoredTaxi.owned === true, JSON.stringify(restoredTaxi));

// ---- F. Map icon scale (bug 7): mission / spray / business diamonds ----
await loadGame();
check('NEW GAME starts (map icon test)', await newGame());
await ev(() => {
  const g = window.__game;
  // Park the cars off-map so their gold dots cannot pollute the clusters,
  // and stand the player in a corner so the white player arrow is far away.
  for (const c of g.cars) c.group.position.set(500, 0, 500);
  g.traffic.cars = [];
  g.player.group.position.set(-150, 0, -150);
});
await page.waitForTimeout(1000);
const iconSizes = await ev(() => {
  const hud = window.__game.hud;
  const canvas = document.getElementById('minimap');
  const ctx = canvas.getContext('2d');
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
    for (let y = Math.max(0, cy - 10); y <= Math.min(height - 1, cy + 10); y += 1) {
      for (let x = Math.max(0, cx - 10); x <= Math.min(width - 1, cx + 10); x += 1) {
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
  return {
    mission: cluster(52, 0, white),
    spray: cluster(104, -52, teal),
    taxiBiz: cluster(52, 52, gold),
    dealerBiz: cluster(104, -104, gold),
  };
});
note(`map icon sizes (minimap px): ${JSON.stringify(iconSizes)}`);
// Anti-aliasing eats ~1px per side at the diamond tips, so measured sizes
// run ~2px under the geometric diameter (mission r 6±0.5 → 11–13, others
// r 5 → 10). What matters is the family: mission slightly larger, the rest
// equal.
check('mission diamond is 9–12px tall (r 6 ± 0.5 pulse, AA-adjusted)',
  iconSizes.mission && iconSizes.mission.h >= 9 && iconSizes.mission.h <= 12, JSON.stringify(iconSizes.mission));
check('spray diamond is 7–10px tall (r 5, AA-adjusted)',
  iconSizes.spray && iconSizes.spray.h >= 7 && iconSizes.spray.h <= 10, JSON.stringify(iconSizes.spray));
check('business diamonds are 7–10px tall (r 5, AA-adjusted)',
  iconSizes.taxiBiz && iconSizes.taxiBiz.h >= 7 && iconSizes.taxiBiz.h <= 10
  && iconSizes.dealerBiz && iconSizes.dealerBiz.h >= 7 && iconSizes.dealerBiz.h <= 10,
  JSON.stringify({ taxi: iconSizes.taxiBiz, dealer: iconSizes.dealerBiz }));
check('mission diamond is at most ~3px taller than spray/business (slightly larger by design)',
  iconSizes.mission && iconSizes.spray && iconSizes.mission.h - iconSizes.spray.h <= 3 && iconSizes.mission.h >= iconSizes.spray.h, JSON.stringify(iconSizes));

// ---- G. Headlights (bug 8): intensity 1200, angle 0.55, visible pool ----
await loadGame();
check('NEW GAME starts (headlight test)', await newGame());
const lamp = await ev(() => {
  const h = window.__game.headlight;
  return { intensity: h.intensity, angle: h.angle, distance: h.distance, shadow: h.castShadow };
});
note(`headlight: ${JSON.stringify(lamp)}`);
check('headlight intensity 1200, angle 0.55, range 35m, no shadow',
  lamp.intensity === 1200 && lamp.angle === 0.55 && lamp.distance === 35 && lamp.shadow === false, JSON.stringify(lamp));
await ev(() => {
  const g = window.__game;
  g.pedestrians.peds.forEach((p) => { p.knockedTimer = 999; });
  g.setGameMinutes(0); // midnight
  g.player.group.position.set(2, 0, -8);
});
await page.waitForTimeout(1200);
await page.keyboard.press('KeyF');
await page.waitForTimeout(1200);
check('entered the starter car at night', await ev(() => window.__game.drivenCar?.name === 'SOLSTICE GT'));
check('headlight ON at night while driving', await ev(() => window.__game.headlight.visible === true));
// Wait out the 3s ENTERED toast: it covers the middle of the screen and
// would drag the pool measurement down.
await page.waitForTimeout(3500);
await page.screenshot({ path: `${SHOTS}/night-headlight.png` });
// Measure the pool: reload the screenshot into the page and compare the
// mean luminance of the lit road flanking the car with the dark road far
// ahead (beyond the 35m beam).
const pool = await page.evaluate(async (url) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const mean = (x0, y0, x1, y1) => {
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return +(sum / (d.length / 4)).toFixed(1);
  };
  // The car faces north (-z); the camera sits behind it. The lit road is
  // the fan ahead of the car (above its roof); the road behind the car is
  // the same surface with no headlight on it.
  const poolMean = mean(520, 290, 760, 355);
  return {
    pool: poolMean,
    control: mean(500, 600, 780, 680),
  };
}, `file://${SHOTS}/night-headlight.png`);
note(`night headlight pool luminance: ${JSON.stringify(pool)}`);
check('night headlight pool is clearly brighter than unlit road',
  pool.pool > 35 && pool.pool > pool.control * 2.5, JSON.stringify(pool));

// ---- H. Portrait 480px: no overlap (bug 9) ----
const portrait = await browser.newPage({ viewport: { width: 480, height: 800 } });
portrait.on('pageerror', (e) => errors.push(`PAGEERROR(portrait): ${e.message}`));
await portrait.goto(GAME_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
await portrait.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await portrait.waitForTimeout(500);
await portrait.evaluate(() => document.getElementById('start-button')?.click());
await portrait.waitForTimeout(800);
const boxes = await portrait.evaluate(() => {
  const r = (id) => {
    const b = document.getElementById(id).getBoundingClientRect();
    return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width), height: Math.round(b.height) };
  };
  return { minimap: r('hud-minimap'), speedo: r('hud-speedo'), hint: r('hud-hint'), bars: r('hud-bars'), canvas: r('minimap') };
});
note(`portrait 480px boxes: ${JSON.stringify(boxes)}`);
check('portrait minimap shrinks to 120px', boxes.canvas.width === 120 && boxes.canvas.height === 120, JSON.stringify(boxes.canvas));
check('portrait hint strip does not overlap the minimap', boxes.hint.top >= boxes.minimap.bottom, JSON.stringify({ hintTop: boxes.hint.top, minimapBottom: boxes.minimap.bottom }));
check('portrait hint strip does not overlap the speedo', boxes.hint.top >= boxes.speedo.bottom, JSON.stringify({ hintTop: boxes.hint.top, speedoBottom: boxes.speedo.bottom }));
check('portrait bars sit above the minimap', boxes.bars.bottom <= boxes.minimap.top, JSON.stringify({ barsBottom: boxes.bars.bottom, minimapTop: boxes.minimap.top }));
await portrait.screenshot({ path: `${SHOTS}/portrait-480.png` });
await portrait.close();

// ---- I. +$100 on first car entry = FIRST WHEELS (bug 10, verdict) ----
await loadGame();
check('NEW GAME starts (+$100 test)', await newGame());
const before = await ev(() => ({ money: window.__game.money, tapes: window.__game.tapes.collected, stolen: window.__game.stats.carsStolen }));
await ev(() => {
  const g = window.__game;
  const car = g.cars.find((c) => c.name === 'PALM RUNNER');
  g.player.group.position.set(car.position.x + 2, 0, car.position.z);
});
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
const after = await ev(() => ({
  money: window.__game.money,
  tapes: window.__game.tapes.collected,
  stolen: window.__game.stats.carsStolen,
  achievements: window.__game.achievements,
  driving: window.__game.drivenCar?.name,
}));
check('first entry is a steal (PALM RUNNER, not the starter)', after.driving === 'PALM RUNNER' && after.stolen === 1, JSON.stringify(after));
check('+$100 is FIRST WHEELS, tapes still 0/20',
  before.money === 1250 && after.money === 1350 && after.tapes === 0 && after.achievements.includes('firstWheels'),
  JSON.stringify({ before, after }));

// ---- Summary ----
console.log(`\nfixbatch3: ${results.length - fails}/${results.length} checks passed, ${fails} failed`);
if (errors.length) {
  console.log(`page errors (${errors.length}):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
}
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
