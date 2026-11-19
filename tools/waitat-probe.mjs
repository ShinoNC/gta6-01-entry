// Probe the full-story waitAt timeouts (M5-s2 at (130,70), M8-s2 at (-52,70)):
// force-start the mission, teleport to the waitAt point, and sample what the
// focus is doing every second — position, distance, waitSeconds, stars,
// nearest police/traffic car — until the stage advances or 90s elapse.
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policySha = createHash('sha256').update(readFileSync(POLICY_PATH)).digest('hex');
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-dev-shm-usage',
    '--force-device-scale-factor=1', `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
    `--hatch-webgl-allowed-domains-sha256=${policySha}`] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const ev = (fn, ...args) => page.evaluate(fn, ...args);

async function loadGame() {
  await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
  await page.evaluate(() => document.getElementById('start-button')?.click());
  await page.waitForTimeout(500);
  await page.evaluate(() => document.getElementById('phone-later')?.click());
  await page.waitForTimeout(300);
}

async function enterStarterCar() {
  await ev(() => window.__game.player.group.position.set(2, 0, -8));
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(800);
  return ev(() => window.__game.drivenCar?.name);
}

// missionIdx: 0-based. waitPt: [x, z] of the failing waitAt (== stage-1 driveTo).
async function probe(label, missionIdx, doneCount, waitPt, driving, stars) {
  await loadGame();
  if (driving) {
    const car = await enterStarterCar();
    console.log(`${label}: driving ${car}`);
  }
  await ev(([mi, dc, st]) => {
    const g = window.__game;
    g.missions.setCompleted(dc);
    g.wanted.setStars(st);
    g.missions.forceStart(mi);
  }, [missionIdx, doneCount, stars]);
  await page.waitForTimeout(500);
  // Stage 1 is a driveTo to the same point: teleport the focus there.
  await ev(([x, z]) => {
    const g = window.__game;
    const focus = g.drivenCar ? g.drivenCar.group : g.player.group;
    focus.position.set(x, 0, z);
    if (g.drivenCar) g.drivenCar.speed = 0;
  }, waitPt);
  const t0 = Date.now();
  let lastStage = -1;
  let lastWait = -1;
  for (let i = 0; i < 90; i += 1) {
    await page.waitForTimeout(1000);
    const s = await ev(([x, z]) => {
      const g = window.__game;
      const focus = g.drivenCar ? g.drivenCar.group : g.player.group;
      const d = Math.hypot(focus.position.x - x, focus.position.z - z);
      let nearestPolice = 999;
      for (const u of g.police.pursuit) {
        nearestPolice = Math.min(nearestPolice, Math.hypot(u.car.position.x - focus.position.x, u.car.position.z - focus.position.z));
      }
      let nearestTraffic = 999;
      for (const t of g.traffic.cars) {
        nearestTraffic = Math.min(nearestTraffic, Math.hypot(t.car.position.x - focus.position.x, t.car.position.z - focus.position.z));
      }
      return {
        stage: g.missions.stageIndex, wait: +g.missions.waitSeconds.toFixed(2),
        fx: +focus.position.x.toFixed(1), fz: +focus.position.z.toFixed(1), dist: +d.toFixed(1),
        stars: g.wanted.stars, down: +g.player.downTimer.toFixed(1),
        driving: !!g.drivenCar, police: +nearestPolice.toFixed(1), traffic: +nearestTraffic.toFixed(1),
        speed: g.drivenCar ? +g.drivenCar.speed.toFixed(1) : null,
      };
    }, waitPt);
    // Log on change of stage/wait (rounded), every 10s, or on completion.
    if (s.stage !== lastStage || Math.floor(s.wait) !== Math.floor(lastWait) || i % 10 === 9) {
      console.log(`${label} t=${Math.round((Date.now() - t0) / 1000)}s stage=${s.stage} wait=${s.wait} pos=(${s.fx},${s.fz}) dist=${s.dist} stars=${s.stars} down=${s.down} driving=${s.driving} speed=${s.speed} police=${s.police}m traffic=${s.traffic}m`);
      lastStage = s.stage;
      lastWait = s.wait;
    }
    if (s.stage > 1) {
      console.log(`${label}: STAGE ADVANCED to ${s.stage} at t=${Math.round((Date.now() - t0) / 1000)}s`);
      return true;
    }
  }
  console.log(`${label}: TIMEOUT after 90s (stage never advanced past 1)`);
  return false;
}

await probe('M8-s2 ON FOOT 0*', 7, 7, [-52, 70], false, 0);
await probe('M8-s2 DRIVING 0*', 7, 7, [-52, 70], true, 0);
await probe('M5-s2 DRIVING 0*', 4, 4, [130, 70], true, 0);
await probe('M5-s2 DRIVING 2*', 4, 4, [130, 70], true, 2);
await browser.close();
