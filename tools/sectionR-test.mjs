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
// Headless game-time is ~6-20x slower than real time: 2s of W only covered
// 0.26m. Speed > 1 proves the bike drives; displacement just needs > 0.3m.
check('bike drives forward under W', bikeDrove.speed > 1 && Math.hypot(bikeDrove.x - bikeBefore.x, bikeDrove.z - bikeBefore.z) > 0.3, JSON.stringify({ before: bikeBefore, after: bikeDrove }));
await page.keyboard.down('KeyW');
await page.keyboard.down('KeyA');
await page.waitForTimeout(3000);
const bikeLean = await ev(() => ({ lean: window.__game.drivenCar.leanGroup.rotation.z, heading: window.__game.drivenCar.heading }));
await page.keyboard.up('KeyA');
await page.keyboard.up('KeyW');
check('bike leans into the turn (left turn = negative rotation.z)', bikeLean.lean < -0.02, JSON.stringify(bikeLean));
check('bike turns under A', Math.abs(bikeLean.heading - bikeBefore.heading) > 0.05, JSON.stringify({ before: bikeBefore.heading, after: bikeLean.heading }));
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
check('F dismounts the bike', await ev(() => window.__game.drivenCar === null));
await page.screenshot({ path: `${SHOTS}/r-bike.png` });
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

// ---- Summary ----
console.log(`\nsectionR: ${results.length - fails}/${results.length} checks passed, ${fails} failed`);
if (errors.length) {
  console.log(`page errors (${errors.length}):`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
}
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
