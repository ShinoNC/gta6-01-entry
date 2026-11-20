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
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
await page.goto('file:///home/hatch/workspace/makefun/gta6-01/entry-v1/game/index.html?seed=1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(4000);
await page.screenshot({ path: '/tmp/smoke-title.png' });
const titleState = await page.evaluate(() => ({ hasGame: Boolean(window.__game), state: window.__game?.state, peds: window.__game?.pedestrians?.peds?.length, traffic: window.__game?.traffic?.cars?.length, beach: window.__game?.beachgoers?.people?.length, cars: window.__game?.cars?.length }));
console.log('TITLE:', JSON.stringify(titleState));
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(2000);
const playState = await page.evaluate(() => {
  const g = window.__game;
  const styles = {};
  for (const c of g.cars) styles[c.style] = (styles[c.style] || 0) + 1;
  const tstyles = {};
  for (const n of g.traffic.cars) tstyles[n.car.style] = (tstyles[n.car.style] || 0) + 1;
  return { state: g.state, money: g.money, cars: g.cars.length, styles, tstyles, beachActive: g.beachgoers.activeCount, pedActive: g.pedestrians.activeCount, trafActive: g.traffic.activeCount };
});
console.log('PLAY:', JSON.stringify(playState));
await page.screenshot({ path: '/tmp/smoke-play.png' });
await page.keyboard.press('KeyN');
await page.waitForTimeout(800);
const menuState = await page.evaluate(() => ({ menuTab: window.__game.menuTab, mapVisible: !document.getElementById('map-screen').classList.contains('hidden'), tabsVisible: !document.getElementById('menu-tabs').classList.contains('hidden'), nextMission: document.getElementById('map-next-mission').textContent.slice(0, 80), districts: document.querySelectorAll('.district-row').length, saveRows: document.querySelectorAll('#map-save .save-row').length }));
console.log('MENU:', JSON.stringify(menuState));
await page.screenshot({ path: '/tmp/smoke-map.png' });
console.log('ERRORS:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();
