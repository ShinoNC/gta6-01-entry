// Mouse-direction test for SOLARIS KEYS (bug 6: mouse-look X was inverted).
// Verifies EMPIRICALLY, not from sign reasoning: moving the mouse right must
// turn the VIEW right (the camera orbits to the player's left), and moving
// it left must turn the view left. Measured from the real three.js camera
// position vs the player position while standing still, pointer locked.
// Run: node tools/mouse-direction-test.mjs
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
function info(name, detail = '') {
  console.log(`INFO ${name}${detail ? ` — ${detail}` : ''}`);
}

// View direction = player position minus camera position, in the XZ plane.
// Player spawns facing -Z (heading PI); their right hand is +X. Mouse right
// must swing the view toward +X (viewDir.x > 0) and push the camera to -X.
const viewState = () => page.evaluate(() => {
  const g = window.__game;
  const p = g.player.position;
  const c = g.camera.position;
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  const len = Math.hypot(dx, dz) || 1;
  return {
    viewX: dx / len, viewZ: dz / len,
    camX: c.x - p.x, camZ: c.z - p.z,
    yawOffset: g.chaseCamera.yawOffset, yaw: g.chaseCamera.yaw,
  };
});
// Headless runs at ~0.1x game speed, so the chase yaw and the camera
// position lag far behind real time. Poll until the yaw has settled near its
// target and the camera position has caught up with the yaw.
async function waitForCameraSettle(maxMs = 15000) {
  const t0 = Date.now();
  for (;;) {
    const s = await viewState();
    const impliedX = Math.sin(s.yaw) * 7.5;
    const impliedZ = Math.cos(s.yaw) * 7.5;
    const posErr = Math.hypot(s.camX - impliedX, s.camZ - impliedZ);
    const wrap = (a) => {
      let w = a;
      while (w > Math.PI) w -= Math.PI * 2;
      while (w < -Math.PI) w += Math.PI * 2;
      return w;
    };
    const yawErr = Math.abs(wrap(s.yawOffset - s.yaw));
    if ((yawErr < 0.2 && posErr < 1.5) || Date.now() - t0 > maxMs) return s;
    await page.waitForTimeout(500);
  }
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);
await page.mouse.click(640, 360); // engage pointer lock
await page.waitForTimeout(500);
check('pointer locked', await page.evaluate(() => window.__game.input.locked === true));
// Let the chase camera settle behind the player first.
const base = await waitForCameraSettle();
info('baseline (standing, no mouse)', `view=(${base.viewX.toFixed(2)},${base.viewZ.toFixed(2)}) camRel=(${base.camX.toFixed(2)},${base.camZ.toFixed(2)}) yaw=${base.yaw.toFixed(2)} off=${base.yawOffset.toFixed(2)}`);
check('baseline view faces -Z (north)', base.viewZ < -0.8 && Math.abs(base.viewX) < 0.3, `view=(${base.viewX.toFixed(2)},${base.viewZ.toFixed(2)})`);

// --- Mouse right: view must turn RIGHT (toward +X) ---
await page.mouse.move(940, 360);
const right = await waitForCameraSettle();
info('after mouse right (+300px)', `view=(${right.viewX.toFixed(2)},${right.viewZ.toFixed(2)}) camRel=(${right.camX.toFixed(2)},${right.camZ.toFixed(2)}) yaw=${right.yaw.toFixed(2)} off=${right.yawOffset.toFixed(2)}`);
check('mouse right turns the view right', right.viewX > 0.3, `viewX=${right.viewX.toFixed(2)}`);
check('mouse right moves the camera to the player\'s left', right.camX < -1, `camRelX=${right.camX.toFixed(2)}`);

// --- Mouse left: view must turn LEFT (toward -X) ---
await page.mouse.move(340, 360);
const left = await waitForCameraSettle();
info('after mouse left (-600px)', `view=(${left.viewX.toFixed(2)},${left.viewZ.toFixed(2)}) camRel=(${left.camX.toFixed(2)},${left.camZ.toFixed(2)}) yaw=${left.yaw.toFixed(2)} off=${left.yawOffset.toFixed(2)}`);
check('mouse left turns the view left', left.viewX < -0.3, `viewX=${left.viewX.toFixed(2)}`);
check('mouse left moves the camera to the player\'s right', left.camX > 1, `camRelX=${left.camX.toFixed(2)}`);

// --- Drag fallback (no pointer lock): same direction ---
await page.evaluate(() => document.exitPointerLock && document.exitPointerLock());
await page.waitForTimeout(500);
check('pointer unlocked for drag test', await page.evaluate(() => window.__game.input.locked === false));
await page.mouse.move(640, 360);
await page.mouse.down();
// Drag +600px: the offset starts near +1.2 (leftover from the mouse-left
// step), so a +300px drag would only reach about -0.3. +600px drives it to
// the -1.2 clamp and swings the view fully right.
await page.mouse.move(1240, 360, { steps: 20 });
// Measure while still dragging: once the button is released the offset
// decays (not locked) and the camera swings back behind the player.
const drag = await waitForCameraSettle();
info('after drag right (+300px, no lock)', `view=(${drag.viewX.toFixed(2)},${drag.viewZ.toFixed(2)}) off=${drag.yawOffset.toFixed(2)}`);
check('drag right turns the view right', drag.viewX > 0.3, `viewX=${drag.viewX.toFixed(2)}`);
await page.mouse.up();

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const fails = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
