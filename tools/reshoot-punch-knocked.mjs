// Re-shoot two playtest moments the first pass missed:
//  - 10-punch.png: wait until the arm is actually mid-swing, then shoot.
//  - 11-knocked.png: knock the player down in the OPEN (spawn intersection),
//    not against a map-edge wall, so the lying player is visible.
// One-off visual check, not part of the suite.
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const OUT = '/tmp/ui-shots';
fs.mkdirSync(OUT, { recursive: true });
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
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`file://${ENTRY}/game/index.html?seed=1`);
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(1500);
await page.evaluate(() => window.__game.missions.snoozeBriefing(600));

// Punch: lock, click, wait for the arm to actually be mid-swing.
await page.mouse.click(640, 360);
await page.waitForTimeout(600);
await page.mouse.click(640, 360);
await page.waitForFunction(() => window.__game.player.group.children[4].rotation.x < -1.5, null, { timeout: 15000 });
await page.screenshot({ path: `${OUT}/10-punch.png` });
console.log('10-punch.png (arm mid-swing)');
await page.waitForTimeout(2000);

// Knockdown in the open: player at spawn, knock down for 5s game time.
await page.evaluate(() => {
  const g = window.__game;
  g.player.group.position.set(0, 0, 0);
  g.player.heading = Math.PI;
  g.player.knockDown(5);
});
await page.waitForFunction(() => window.__game.player.group.rotation.x > 1.4, null, { timeout: 15000 });
await page.waitForTimeout(1500); // let the camera settle on the lying player
await page.screenshot({ path: `${OUT}/11-knocked.png` });
console.log('11-knocked.png (lying in the open)');
console.log(errors.length, 'console/page errors');
await browser.close();
