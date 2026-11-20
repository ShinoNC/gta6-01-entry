// SOLARIS KEYS screenshot capture (Playwright + file://).
// Usage: node tools/shot.mjs <shot> <out-path> [quality]
// Example: node tools/shot.mjs core screenshots/0-core.jpg 72
// Waits for window.__shotReady, then saves a 1280x720 JPEG and reports any
// console/page errors. Later phases add more shots (chase, on-foot, mission,
// title) via the same ?shot= staging in game/src/main.js.
// Playwright lives in the shared tools dir, not in this repo, so it is
// imported by absolute path (ESM ignores NODE_PATH).
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { statSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRY = dirname(dirname(fileURLToPath(import.meta.url)));
const SHOT = process.argv[2] || 'core';
const OUT = process.argv[3] || join(ENTRY, 'screenshots', `0-${SHOT}.jpg`);
const QUALITY = parseInt(process.argv[4] || '72', 10);
const SEED = process.argv[5] || '1';

const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policy = readFileSync(POLICY_PATH);
const policySha = createHash('sha256').update(policy).digest('hex');

const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: [
    '--no-sandbox',
    '--disable-gpu',
    '--allow-file-access-from-files',
    '--disable-dev-shm-usage',
    '--force-device-scale-factor=1',
    `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
    `--hatch-webgl-allowed-domains-sha256=${policySha}`,
  ],
});
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`);
});
await page.goto(`file://${ENTRY}/game/index.html?shot=${SHOT}&seed=${SEED}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
if (SHOT === 'empire') {
  // No ?shot= preset for empire (removed to save dossier bytes): stage the
  // rich empire state via __game instead, then open the EMPIRE tab.
  await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
  await page.evaluate(() => document.getElementById('start-button').click());
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const g = window.__game;
    g.setMoney(25000);
    g.setRep(900);
    g.missions.setCompleted(5);
    g.businesses.buy(0);
    g.businesses.upgrade(0);
    g.businesses.buy(1);
    g.businesses.state[0].pending = 2400;
    g.businesses.state[1].pending = 6000;
    g.tapes.setCollected(7);
    Object.assign(g.stats, { carsStolen: 12, pedsDown: 4, moneyEarned: 32000, kmDriven: 48.5, escapes5: 1, helisDown: 2, robberiesStopped: 3, jobsDone: 6, businessesOwned: 2 });
    g.openMenu('empire');
  });
  await page.waitForTimeout(500);
} else {
  try {
    await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 60000 });
  } catch {
    console.log(`SHOT ${SHOT}: __shotReady TIMEOUT`);
    console.log(errors.join('\n') || '(no console errors captured)');
    await browser.close();
    process.exit(1);
  }
}
await page.waitForTimeout(300);
await page.screenshot({ path: OUT, type: 'jpeg', quality: QUALITY });
const size = statSync(OUT).size;
console.log(`SHOT ${OUT}: ${size} bytes ${size > 262144 ? 'OVER 256KiB!' : 'ok'}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
