import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policySha = createHash('sha256').update(readFileSync(POLICY_PATH)).digest('hex');
const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-dev-shm-usage',
    '--force-device-scale-factor=1', `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
    `--hatch-webgl-allowed-domains-sha256=${policySha}`],
});
const errors = [];
async function shot(w, h, name) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  page.on('pageerror', (e) => errors.push(name + ' PAGEERROR: ' + e.message));
  await page.goto('file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?seed=1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => document.getElementById('start-button')?.click());
  await page.waitForTimeout(1500);
  // Give the player a pistol + rep so the weapon cards + rep bar show variety.
  await page.evaluate(() => { const g = window.__game; g.setMoney(50000); g.setRep(150); });
  await page.waitForTimeout(800);
  const boxes = await page.evaluate(() => {
    const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), w: Math.round(b.width), h: Math.round(b.height) }; };
    const slots = [...document.querySelectorAll('.weapon-slot')].map((s) => s.className + '|' + s.textContent.trim());
    return { topLeft: r('hud-top-left'), topRight: r('hud-top-right'), minimap: r('hud-minimap'), canvas: r('minimap'), bars: r('hud-bars'), speedo: r('hud-speedo'), hint: r('hud-hint'), district: document.getElementById('hud-district').textContent, street: document.getElementById('hud-street').textContent, healthNum: document.getElementById('hud-health-num').textContent, repbar: document.getElementById('hud-repbar-fill').style.width, slots };
  });
  console.log(name, JSON.stringify(boxes, null, 0));
  await page.screenshot({ path: `/tmp/hud-${name}.png` });
  await page.close();
}
//await shot(1280, 800, '1280x800');
//await shot(768, 1024, '768x1024');
//await shot(768, 432, '768x432');
await shot(480, 800, '480x800');
console.log('ERRORS:', errors.length ? errors : 'none');
await browser.close();
