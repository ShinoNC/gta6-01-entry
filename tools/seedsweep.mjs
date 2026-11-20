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
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  await page.goto(`file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?seed=${seed}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
  const styles = await page.evaluate(() => {
    const t = {};
    for (const n of window.__game.traffic.cars) t[n.car.style] = (t[n.car.style] || 0) + 1;
    return t;
  });
  console.log(`seed ${seed}:`, JSON.stringify(styles));
}
await browser.close();
