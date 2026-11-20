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
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + ' @ ' + (e.stack || '').split('\n').slice(0, 3).join(' | ')));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText || '')));
await page.goto('file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?seed=1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000);
const st = await page.evaluate(() => ({ hasGame: Boolean(window.__game), keys: Object.keys(window).filter((k) => k.includes('game') || k.includes('__')) }));
console.log('STATE:', JSON.stringify(st));
console.log('ERRORS:', errors.length ? errors.slice(0, 12).join('\n') : 'none');
await browser.close();
