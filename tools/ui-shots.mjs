// Visual verification screenshots for bugs 5 (map) + 8 (readability).
// Captures: title, HUD while playing, map (N), mission (M), empire (B),
// pause (ESC), phone briefing (at the M1 marker), WASTED.
// Output: /tmp/ui-shots/*.png — inspect with your own eyes before reporting.
// Run: node tools/ui-shots.mjs
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const OUT = '/tmp/ui-shots';
mkdirSync(OUT, { recursive: true });
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

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${OUT}/1-title.png` });
console.log('1-title.png');

await page.click('#start-button');
await page.waitForTimeout(2000);
await page.screenshot({ path: `${OUT}/2-hud.png` });
console.log('2-hud.png');

// Map (N) — the bug-5 shot. Measure the canvas box too.
await page.keyboard.press('KeyN');
await page.waitForTimeout(800);
const mapBox = await page.evaluate(() => {
  const c = document.getElementById('bigmap');
  const r = c.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), vw: window.innerWidth, vh: window.innerHeight, canvasW: c.width, canvasH: c.height };
});
console.log('map box:', JSON.stringify(mapBox));
await page.screenshot({ path: `${OUT}/3-map.png` });
console.log('3-map.png');
await page.keyboard.press('KeyN');
await page.waitForTimeout(400);

// Mission screen (M).
await page.keyboard.press('KeyM');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/4-missions.png` });
console.log('4-missions.png');
await page.keyboard.press('KeyM');
await page.waitForTimeout(400);

// Empire screen (B).
await page.keyboard.press('KeyB');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/5-empire.png` });
console.log('5-empire.png');
await page.keyboard.press('KeyB');
await page.waitForTimeout(400);

// Pause (ESC).
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/6-pause.png` });
console.log('6-pause.png');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// Phone briefing: teleport to the M1 marker and wait for the phone.
await page.evaluate(() => { window.__game.player.group.position.set(52, 0, 0); });
let up = false;
for (let i = 0; i < 12 && !up; i += 1) {
  await page.waitForTimeout(2000);
  up = await page.evaluate(() => !document.getElementById('phone-panel').classList.contains('hidden'));
}
console.log('briefing up:', up);
await page.screenshot({ path: `${OUT}/7-briefing.png` });
console.log('7-briefing.png');
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(400);

// WASTED: kill the player.
await page.evaluate(() => { window.__game.damagePlayer(9999); });
await page.waitForTimeout(1000);
await page.screenshot({ path: `${OUT}/8-wasted.png` });
console.log('8-wasted.png');

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : '0 console/page errors');
await browser.close();
