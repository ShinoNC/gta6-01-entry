// Side-jobs discovery tests for SOLARIS KEYS: jobs exist hidden in the world
// from game start (no timer, no HUD), are discovered by driving within 40m,
// and a hidden replacement spawns after each completion.
// Run: node tools/sidejobs-discovery-test.mjs
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

const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(results[results.length - 1]);
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-decline')?.click());
await page.waitForTimeout(300);

// --- 1. No job visible on the HUD at game start ---
const startState = await page.evaluate(() => {
  const sj = window.__game.sideJobs;
  return {
    hasJob: sj.job !== null,
    discovered: sj.job ? sj.job.discovered : null,
    type: sj.job ? sj.job.type : null,
    target: sj.target,
    objective: sj.objectiveLine(),
    status: sj.statusLine(),
    beaconVisible: sj.beacon.group.visible,
    figureVisible: sj.passenger.group.visible || sj.package.visible,
    taxiMarkerVisible: sj.taxiMarker.visible,
    pickupFromSpawn: sj.job ? Math.hypot(sj.job.pickup.x, sj.job.pickup.z) : -1,
    hudObjective: document.getElementById('hud-objective').textContent,
  };
});
check('a hidden job exists at game start', startState.hasJob === true, `type=${startState.type}`);
check('job is undiscovered at game start', startState.discovered === false);
check('no minimap target before discovery', startState.target === null);
check('no HUD objective line before discovery', startState.objective === null);
check('no status line before discovery', startState.status === null);
check('no beacon before discovery', startState.beaconVisible === false);
check('no taxi marker before discovery', startState.taxiMarkerVisible === false);
check('fare/package figure visible in the world', startState.figureVisible === true);
check('pickup is far from spawn (>60m)', startState.pickupFromSpawn > 60, `${startState.pickupFromSpawn.toFixed(0)}m from spawn`);
check(
  'HUD objective shows free-roam text, not a job',
  !startState.hudObjective.includes('TAXI') && !startState.hudObjective.includes('DELIVERY'),
  startState.hudObjective,
);

// Waiting must not offer a job on its own (the old 12s timer is gone).
await page.waitForTimeout(15000);
check(
  'still undiscovered after 15s of waiting',
  await page.evaluate(() => window.__game.sideJobs.job !== null && window.__game.sideJobs.job.discovered === false),
);

// --- 2. Driving within 40m discovers the job ---
await page.evaluate(() => {
  const sj = window.__game.sideJobs;
  // Teleport 30m from the pickup TOWARD the map centre: +30 on x can land
  // outside the map (the player is clamped back to the edge, possibly right
  // next to the fare, which overwrites the SPOTTED toast with "Get in a car").
  const dx = 0 - sj.job.pickup.x;
  const dz = 0 - sj.job.pickup.z;
  const d = Math.hypot(dx, dz) || 1;
  window.__game.player.group.position.set(sj.job.pickup.x + (dx / d) * 30, 0, sj.job.pickup.z + (dz / d) * 30);
});
await page.waitForTimeout(2000);
const discoveredState = await page.evaluate(() => {
  const sj = window.__game.sideJobs;
  return {
    discovered: sj.job.discovered,
    target: sj.target !== null,
    objective: sj.objectiveLine(),
    status: sj.statusLine(),
    beaconVisible: sj.beacon.group.visible,
    hudMessage: document.getElementById('hud-message').textContent,
  };
});
check('job discovered within 40m', discoveredState.discovered === true);
check('minimap target appears after discovery', discoveredState.target === true);
check(
  'HUD objective line appears after discovery',
  discoveredState.objective !== null && (discoveredState.objective.includes('TAXI') || discoveredState.objective.includes('DELIVERY')),
  discoveredState.objective,
);
check('status line appears after discovery', discoveredState.status !== null, discoveredState.status);
check('beacon appears after discovery', discoveredState.beaconVisible === true);
check(
  'discovery toast says SPOTTED or FOUND',
  discoveredState.hudMessage.includes('SPOTTED') || discoveredState.hudMessage.includes('FOUND'),
  discoveredState.hudMessage,
);

// --- 3. Completing a job spawns a hidden replacement ---
// forceJob('delivery') gives a deterministic discovered delivery job (no car needed).
await page.evaluate(() => window.__game.sideJobs.forceJob('delivery'));
await page.waitForTimeout(500);
check(
  'forceJob spawns a discovered delivery job',
  await page.evaluate(() => {
    const sj = window.__game.sideJobs;
    return sj.job !== null && sj.job.type === 'delivery' && sj.job.discovered === true && sj.target !== null;
  }),
);
const moneyBefore = await page.evaluate(() => window.__game.money);
await page.evaluate(() => {
  const sj = window.__game.sideJobs;
  window.__game.player.group.position.set(sj.job.pickup.x, 0, sj.job.pickup.z);
});
await page.waitForTimeout(2000);
check(
  'delivery pickup moves job to dropoff stage',
  await page.evaluate(() => window.__game.sideJobs.job.stage === 'dropoff'),
);
await page.evaluate(() => {
  const sj = window.__game.sideJobs;
  window.__game.player.group.position.set(sj.job.dropoff.x, 0, sj.job.dropoff.z);
});
await page.waitForTimeout(2000);
const moneyAfter = await page.evaluate(() => window.__game.money);
const replacementState = await page.evaluate(() => {
  const sj = window.__game.sideJobs;
  const p = window.__game.player.position;
  return {
    hasJob: sj.job !== null,
    discovered: sj.job ? sj.job.discovered : null,
    target: sj.target,
    objective: sj.objectiveLine(),
    beaconVisible: sj.beacon.group.visible,
    figureVisible: sj.passenger.group.visible || sj.package.visible,
    pickupFromPlayer: sj.job ? Math.hypot(sj.job.pickup.x - p.x, sj.job.pickup.z - p.z) : -1,
  };
});
check('delivery paid out', moneyAfter > moneyBefore, `$${moneyBefore} -> $${moneyAfter}`);
check('replacement job exists after completion', replacementState.hasJob === true);
check('replacement job is hidden', replacementState.discovered === false);
check('no minimap target for replacement', replacementState.target === null);
check('no HUD objective for replacement', replacementState.objective === null);
check('no beacon for replacement', replacementState.beaconVisible === false);
check('replacement figure visible in the world', replacementState.figureVisible === true);
check('replacement pickup is far from the player (>60m)', replacementState.pickupFromPlayer > 60, `${replacementState.pickupFromPlayer.toFixed(0)}m`);

check('zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ') : '');
console.log(results.join('\n'));
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
