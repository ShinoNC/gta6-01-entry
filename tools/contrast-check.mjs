// WCAG contrast check for VICE ROYALE HUD text (20/11). Do NOT judge
// contrast by eye: this script renders the real game (day, sunset,
// night+rain, BUSTED screen), screenshots it, and records every HUD text
// element's box + computed colour. contrast-analyze.py then samples the
// real pixels behind each element and computes WCAG ratios.
// Bar: 4.5:1 normal text, 3:1 large text (>=24px, or >=18.66px bold).
// Run: node tools/contrast-check.mjs && python3 tools/contrast-analyze.py
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const OUT = '/home/hatch/workspace/makefun/gta6-01/bugcheck-20261119/contrast-shots';
mkdirSync(OUT, { recursive: true });
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
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

// Selectors to measure: [key, selector, multiple?]
const TARGETS = [
  ['district', '#hud-district', false],
  ['mission', '#hud-mission', false],
  ['objective', '#hud-objective', false],
  ['next', '#hud-next', false],
  ['clock', '#hud-clock', false],
  ['money', '#hud-money', false],
  ['stars', '#hud-stars', false],
  ['rep', '#hud-rep', false],
  ['radio', '#hud-radio', false],
  ['car', '#hud-car', false],
  ['condition', '#hud-condition', false],
  ['speed', '#hud-speed-row', false],
  ['bar-label', '.bar-label', true],
  ['weapon-slot', '.weapon-slot', true],
  ['hint', '#hud-hint', false],
  ['toast', '#hud-message', false],
  ['police-row', '.police-row', true],
  ['down-title', '#down-title', false],
  ['down-sub', '#down-sub', false],
];

async function measureElements(onlyKeys = null) {
  return page.evaluate(({ targets, only }) => {
    const out = [];
    for (const [key, sel, multi] of targets) {
      if (only && !only.includes(key)) continue;
      const els = multi ? [...document.querySelectorAll(sel)] : [document.querySelector(sel)];
      for (const [i, el] of els.entries()) {
        if (!el) continue;
        const cs = getComputedStyle(el);
        // NOTE: offsetParent is null for top-level position:fixed elements
        // (#hud-hint, #hud-message) — that does NOT mean hidden. Use the
        // computed display + the rect instead.
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        if (!el.textContent.trim()) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        out.push({
          key: multi ? `${key}[${i}]` : key,
          text: el.textContent.trim().slice(0, 40),
          x: Math.round(r.left), y: Math.round(r.top),
          w: Math.round(r.width), h: Math.round(r.height),
          color: cs.color, size: parseFloat(cs.fontSize),
          weight: parseInt(cs.fontWeight, 10),
        });
      }
    }
    return out;
  }, { targets: TARGETS, only: onlyKeys });
}

const manifest = { scenarios: [] };
async function captureScenario(name, setup, onlyKeys = null) {
  await setup();
  await page.waitForTimeout(2500); // let the scene + HUD settle
  const elements = await measureElements(onlyKeys);
  const shotPath = `${OUT}/${name}.png`;
  await page.screenshot({ path: shotPath });
  manifest.scenarios.push({ name, shot: shotPath, elements });
  console.log(`captured ${name}: ${elements.length} text elements`);
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);

// Toast on for every gameplay scenario (30s real time).
const showToast = () => page.evaluate(() => window.__game.hud.showMessage('TEST MESSAGE — contrast check', 30));

// Day, noon, clear — brightest scene behind the panels.
await captureScenario('day', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.setGameMinutes(720);
    g.weather.forceClear();
  });
  await showToast();
});

// Sunset (the default start time, 18:50) — warm bright sky.
await captureScenario('sunset', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.setGameMinutes(1130);
    g.weather.forceClear();
  });
  await showToast();
});

// Night + rain — the exact case from the user's screenshot.
await captureScenario('night-rain', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.setGameMinutes(0);
    g.weather.forceRain();
  });
  await showToast();
});

// Police panel (1 star, day — brightest scene behind its panel).
await captureScenario('police-day', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.setGameMinutes(720);
    g.weather.forceClear();
    g.wanted.setStars(1);
  });
  await showToast();
  // Wait until a unit exists so the panel has rows.
  for (let i = 0; i < 20; i += 1) {
    const n = await page.evaluate(() => window.__game.police.pursuit.length);
    if (n > 0) break;
    await page.waitForTimeout(500);
  }
});

// Driving (day): the speed row + condition only exist while driving.
await captureScenario('driving-day', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.setGameMinutes(720);
    g.weather.forceClear();
    g.wanted.setStars(0);
    g.player.group.position.set(2, 0, -8);
  });
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  await showToast();
});

// BUSTED screen (gradient background, no game scene behind the text).
// Only the down-screen text is measurable here — the gameplay HUD is
// occluded by the opaque overlay, so sampling behind it is meaningless.
await captureScenario('busted', async () => {
  await page.evaluate(() => window.__game.endRun('BUSTED'));
}, ['down-title', 'down-sub']);

writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`manifest: ${OUT}/manifest.json, errors: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
