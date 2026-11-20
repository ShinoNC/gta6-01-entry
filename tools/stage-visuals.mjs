// One-off visual staging (run after fixbatch5): screenshots the test suite
// does not capture well — bike leaning into a turn, mid-swim prone pose,
// beachgoers on the sand, a taxi with its roof sign. No ?shot= preset is
// added (dossier bytes); everything stages via window.__game.
// Run: node tools/stage-visuals.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const SHOTS = '/home/hatch/workspace/makefun/gta6-01/bugcheck-20261119/fixbatch5-shots';
mkdirSync(SHOTS, { recursive: true });
const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policySha = createHash('sha256').update(readFileSync(POLICY_PATH)).digest('hex');
const browser = await chromium.launch({ executablePath: '/opt/meta-chromium/chrome', args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-dev-shm-usage', '--force-device-scale-factor=1', `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`, `--hatch-webgl-allowed-domains-sha256=${policySha}`] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
const ev = (fn, arg) => page.evaluate(fn, arg);
async function shot(path) {
  try { await page.screenshot({ path, timeout: 60000 }); }
  catch (e) {
    console.log(`screenshot ${path.split('/').pop()} timed out — retrying`);
    try { await page.screenshot({ path, timeout: 60000 }); }
    catch (e2) { console.log(`screenshot ${path.split('/').pop()} failed twice, continuing`); }
  }
}
await page.goto('file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?seed=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(800);
// Snap the chase camera behind the player after a long teleport: the lerp
// (stiffness 4.5/s) needs ~0.7s of game-time to cover a 700m jump.
async function snapCam() {
  await ev(() => {
    const g = window.__game;
    const yaw = g.player.heading + Math.PI;
    g.chaseCamera.yaw = yaw;
    g.chaseCamera.currentPosition.set(
      g.player.position.x + Math.sin(yaw) * 7.5,
      g.player.position.y + 3.4,
      g.player.position.z + Math.cos(yaw) * 7.5
    );
  });
}
// 1. Bike leaning into a left turn.
await ev(() => { const g = window.__game; const bike = g.cars.find((c) => c.name === 'VICE SPORT'); g.player.downTimer = 0; g.player.group.rotation.x = 0; g.player.group.position.set(bike.position.x + 2, 0, bike.position.z); });
await page.waitForTimeout(400);
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
await page.keyboard.down('KeyW');
await page.waitForTimeout(3000);
await page.keyboard.down('KeyA');
await page.waitForTimeout(3000);
const lean = await ev(() => ({ lean: window.__game.drivenCar.leanGroup.rotation.z, heading: window.__game.drivenCar.heading, speed: window.__game.drivenCar.speed }));
await shot(`${SHOTS}/visual-bike-lean.png`);
await page.keyboard.up('KeyA');
await page.keyboard.up('KeyW');
console.log('bike lean:', JSON.stringify(lean));
// 2. Mid-swim: prone pose + stamina bar.
await page.keyboard.press('KeyF');
await page.waitForTimeout(800);
await ev(() => { const g = window.__game; g.player.group.position.set(0, 0, 368); g.player.heading = 0; });
await snapCam();
await page.waitForTimeout(1200);
const swim = await ev(() => ({ swimming: window.__game.player.swimming, stamina: window.__game.player.stamina, prone: window.__game.player.group.rotation.x }));
await shot(`${SHOTS}/visual-swim.png`);
console.log('swim:', JSON.stringify(swim));
// 3. Beachgoers on the south beach at noon.
await ev(() => { const g = window.__game; g.setGameMinutes(720); const b = g.beachgoers.people.find((p) => p.state !== 'dormant'); const pos = b.mesh.group.position; g.player.group.position.set(pos.x + 6, 0, pos.z); g.player.heading = -Math.PI / 2; });
await snapCam();
await page.waitForTimeout(1200);
await shot(`${SHOTS}/visual-beachgoers.png`);
console.log('beachgoers staged');
// 4. Taxi with its roof sign (day).
await ev(() => { const g = window.__game; const t = g.traffic.cars.find((n) => n.car.style === 'taxi'); const p = t.car.position; g.player.group.position.set(p.x + 6, 0, p.z); g.player.heading = -Math.PI / 2; });
await snapCam();
await page.waitForTimeout(800);
await shot(`${SHOTS}/visual-taxi.png`);
console.log('taxi staged');
console.log('ERRORS:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
