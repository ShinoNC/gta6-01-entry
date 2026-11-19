// Toast timeline probe: what does #hud-message actually show, and when,
// around a first car steal? Hooks hud.showMessage to log every call with
// the queue state, then samples the visible text every 150ms for 10s.
// Run: node tools/toast-probe.mjs
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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);
await page.evaluate(() => {
  const g = window.__game;
  g.pedestrians.peds.forEach((p) => { p.knockedTimer = 999; });
  const target = g.cars.find((c) => !c.owned && c.name !== 'SUNSET COUPE' && !c.destroyed);
  for (const c of g.cars) if (c !== target) c.group.position.set(500, 0, 500);
  target.group.position.set(4, 0, -8);
  g.player.group.position.set(2, 0, -8);
  window.__t0 = performance.now();
  window.__calls = [];
  const orig = g.hud.showMessage.bind(g.hud);
  g.hud.showMessage = (text, seconds = 3.5, sticky = false) => {
    window.__calls.push({
      at: +((performance.now() - window.__t0) / 1000).toFixed(2),
      text, seconds, sticky,
      queueBefore: g.hud.pendingMessages.map((m) => m.text),
      showingBefore: document.getElementById('hud-message').textContent,
    });
    return orig(text, seconds, sticky);
  };
});
await page.waitForTimeout(1000); // let the carjack prompt cycle
console.log('--- pressing F ---');
await page.keyboard.press('KeyF');
const samples = [];
const t0 = Date.now();
let last = '';
for (let i = 0; i < 67; i += 1) {
  const msg = await page.textContent('#hud-message');
  const t = ((Date.now() - t0) / 1000).toFixed(2);
  if (msg !== last) {
    samples.push(`t=${t}s: ${JSON.stringify(msg)}`);
    last = msg;
  }
  await page.waitForTimeout(150);
}
console.log('--- showMessage calls ---');
const calls = await page.evaluate(() => window.__calls);
for (const c of calls) console.log(`t=${c.at}s show(${JSON.stringify(c.text)}, ${c.seconds}s, sticky=${c.sticky}) queueBefore=${JSON.stringify(c.queueBefore)} showingBefore=${JSON.stringify(c.showingBefore)}`);
console.log('--- visible timeline ---');
for (const s of samples) console.log(s);
console.log('--- final state ---');
console.log(await page.evaluate(() => ({
  stars: window.__game.wanted.stars,
  car: window.__game.drivenCar?.name,
  queue: window.__game.hud.pendingMessages.map((m) => m.text),
})));
await browser.close();
