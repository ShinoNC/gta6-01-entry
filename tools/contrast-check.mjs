// WCAG contrast check for VICE ROYALE — EVERY text element, measured by
// code from real screenshot pixels. No element is skipped for being small:
// the checklist enumerates the HUD, the weapon cards (incl. locked state),
// the health/armour/stamina numbers, the dialogue + briefing panels, the
// interaction prompt, WASTED/BUSTED, the title screen, every menu tab, the
// settings + controls rows, and the map menu (legend, next mission,
// district standing, save slots, canvas district/POI labels).
// Bar: 4.5:1 normal text, 3:1 large text (>=24px, or >=18.66px bold).
// Small text is where colour decides readability — it gets measured first.
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
// Containers (e.g. .weapon-slot) are NOT targets — only real text nodes.
const TARGETS = [
  // HUD (gameplay)
  ['district', '#hud-district', false],
  ['street', '#hud-street', false],
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
  ['health-num', '#hud-health-num', false],
  ['armour-num', '#hud-armour-num', false],
  ['stamina-num', '#hud-stamina-num', false],
  ['ws-num', '.ws-num', true],
  ['ws-name', '.ws-name', true],
  ['ws-ammo', '.ws-ammo', true],
  ['hint', '#hud-hint', false],
  ['toast', '#hud-message', false],
  ['prompt', '#hud-message', false],
  ['police-row', '.police-row', true],
  // Dialogue + briefing panels
  ['dialogue-name', '#dialogue-name', false],
  ['dialogue-text', '#dialogue-text', false],
  ['phone-giver', '#phone-giver', false],
  ['phone-text', '#phone-text', false],
  ['phone-button', '.phone-button', true],
  // Down screen
  ['down-title', '#down-title', false],
  ['down-sub', '#down-sub', false],
  // Title screen
  ['game-title', '.game-title', true],
  ['game-subtitle', '.game-subtitle', true],
  ['feature-line', '.feature-line', false],
  ['menu-button', '.menu-button', true],
  ['continue-summary', '#continue-summary', false],
  // Menu tabs + screens
  ['menu-tab', '.menu-tab', true],
  ['settings-label', '.settings-row label', true],
  ['settings-value', '.settings-value', true],
  ['settings-select', '.settings-row select', true],
  ['controls-label', '#controls-tab-panel .controls-row span:first-child', true],
  ['key-chip', '.key-chip', true],
  ['legend-item', '#map-legend .legend-grid span', true],
  ['legend-hint', '.legend-hint', false],
  ['map-panel-title', '.map-panel-title', true],
  ['map-next-name', '.map-next-name', false],
  ['map-next-obj', '.map-next-obj', false],
  ['map-next-dist', '.map-next-dist', false],
  ['district-name', '.district-name', true],
  ['district-status', '.district-status', true],
  ['save-slot', '.save-slot', true],
  ['save-summary', '.save-summary', true],
  ['mission-head', '.mission-head span', true],
  ['mission-reward', '.mission-reward', true],
  ['mission-briefing', '.mission-briefing', true],
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
        // Skip elements clipped by a scrolling ancestor (mission/empire
        // list rows below the fold, controls rows below the panel fold):
        // their box extends past the ancestor's visible rect, so the
        // screenshot at that box shows something else (the footer, the
        // gradient). They are measured in the scrolled capture where
        // they are fully visible. (elementFromPoint cannot do this job:
        // .hud has pointer-events:none, so it skips every HUD element.)
        let clipped = false;
        for (let a = el.parentElement; a; a = a.parentElement) {
          const csa = getComputedStyle(a);
          if (csa.overflowY !== 'auto' && csa.overflowY !== 'scroll') continue;
          const ar = a.getBoundingClientRect();
          if (r.top < ar.top - 1 || r.bottom > ar.bottom + 1 || r.left < ar.left - 1 || r.right > ar.right + 1) { clipped = true; break; }
        }
        if (clipped) continue;
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

// Canvas labels on the full map (district names + POI labels): drawn by
// paintMap with a dark outline (#1a1030) around each glyph. The outline is
// the colour adjacent to the glyphs, so the verdict measures text-vs-outline;
// the ring sample (map background behind the outline) is reported too.
// Boxes are converted from canvas px to screen px via the canvas rect.
async function measureMapLabels() {
  return page.evaluate(() => {
    const g = window.__game;
    const hud = g.hud;
    const canvas = document.getElementById('bigmap');
    const ctx = canvas.getContext('2d');
    const r = canvas.getBoundingClientRect();
    const sx = r.width / canvas.width;
    const sy = r.height / canvas.height;
    const out = [];
    // paintMap's marker scale: m = sqrt(canvas width / 168).
    const m = Math.sqrt(canvas.width / 168);
    const fs = Math.round(9 * m);
    ctx.font = `bold ${fs}px "Courier New", monospace`;
    // District labels: replicate paintMap's clamped positions. Anchors are
    // the DISTRICTS lx/lz in city.js (+ the two beaches).
    const districts = [
      { name: 'NORTHGATE', x: -159, z: -263 }, { name: 'FOG HARBOR', x: 159, z: -263 },
      { name: 'OLD PORT', x: -107, z: -135 }, { name: 'HARBOR LIGHTS', x: 107, z: -135 },
      { name: 'LANTERN ROW', x: -107, z: -13 }, { name: 'MARINA DEL SOL', x: 107, z: -13 },
      { name: 'PALM ROW', x: -107, z: 42 }, { name: 'PELICAN BAY', x: 107, z: 42 },
      { name: 'SUNSET KEYS', x: -159, z: 107 }, { name: 'GULL HARBOR', x: 159, z: 107 },
      { name: 'SOUTH POINT', x: -159, z: 237 }, { name: 'BEACON KEY', x: 159, z: 237 },
      { name: 'CORAL STRAND', x: -159, z: 337 }, { name: 'SUNSET BLUFF', x: 159, z: 337 },
    ];
    for (const d of districts) {
      const p = hud.toMap(d.x, d.z, canvas.width, canvas.height);
      const tw = ctx.measureText(d.name).width;
      const x = Math.min(Math.max(p.x, tw / 2 + 24), canvas.width - tw / 2 - 24);
      const y = Math.min(Math.max(p.y, fs + 10), canvas.height - 12);
      out.push({ key: `map-district-${d.name}`, text: d.name, x: Math.round(r.left + (x - tw / 2) * sx), y: Math.round(r.top + (y - fs) * sy), w: Math.round(tw * sx), h: Math.round(fs * sy), color: 'rgb(255, 255, 255)', size: Math.round(fs * sy), weight: 700, canvas: true, outline: '#1a1030' });
    }
    // POI labels.
    const pfs = Math.round(7 * m);
    ctx.font = `bold ${pfs}px "Courier New", monospace`;
    const pois = [];
    for (const b of g.businesses.blips()) pois.push({ x: b.x, z: b.z, text: b.name, color: b.owned ? '#7affc4' : '#ffd978', dy: -14 });
    pois.push({ x: 104, z: -52, text: "PAY'N'SPRAY", color: '#2ad0c4', dy: 0 });
    pois.push({ x: g.shop.x, z: g.shop.z, text: 'VICE CUTS', color: '#ff5aa8', dy: -14 });
    pois.push({ x: 52, z: 0, text: 'MARA SOLIS', color: '#ffffff', dy: 14 });
    pois.push({ x: -52, z: 330, text: 'JUNO REYES', color: '#ffffff', dy: 0 });
    pois.push({ x: 104, z: -104, text: 'OTTO KANE', color: '#ffffff', dy: 16 });
    pois.push({ x: 104, z: -104, text: 'SAFEHOUSE', color: '#ffffff', dy: 32 });
    for (const poi of pois) {
      const p = hud.toMap(poi.x, poi.z, canvas.width, canvas.height);
      const tw = ctx.measureText(poi.text).width;
      const x = Math.min(Math.max(p.x, tw / 2 + 8), canvas.width - tw / 2 - 8);
      const y = Math.min(Math.max(p.y + poi.dy, pfs + 6), canvas.height - 8);
      const rgb = [1, 3, 5].map((i) => parseInt(poi.color.slice(i, i + 2), 16)).join(', ');
      out.push({ key: `map-poi-${poi.text}`, text: poi.text, x: Math.round(r.left + (x - tw / 2) * sx), y: Math.round(r.top + (y - pfs) * sy), w: Math.round(tw * sx), h: Math.round(pfs * sy), color: `rgb(${rgb})`, size: Math.round(pfs * sy), weight: 700, canvas: true, outline: '#1a1030' });
    }
    return out;
  });
}

const manifest = { scenarios: [] };
async function captureScenario(name, setup, onlyKeys = null, extra = null) {
  await setup();
  await page.waitForTimeout(2500); // let the scene + HUD settle
  const elements = await measureElements(onlyKeys);
  if (extra) elements.push(...(await extra()));
  const shotPath = `${OUT}/${name}.png`;
  await page.screenshot({ path: shotPath });
  manifest.scenarios.push({ name, shot: shotPath, elements });
  console.log(`captured ${name}: ${elements.length} text elements`);
}

const HUD_KEYS = ['district', 'street', 'mission', 'objective', 'next', 'clock', 'money', 'stars', 'rep', 'radio', 'car', 'condition', 'speed', 'bar-label', 'health-num', 'armour-num', 'stamina-num', 'ws-num', 'ws-name', 'ws-ammo', 'hint', 'toast', 'police-row'];
const MENU_KEYS = ['menu-tab', 'game-title', 'game-subtitle', 'menu-button', 'map-panel-title', 'legend-item', 'legend-hint', 'map-next-name', 'map-next-obj', 'map-next-dist', 'district-name', 'district-status', 'save-slot', 'save-summary', 'mission-head', 'mission-reward', 'mission-briefing', 'settings-label', 'settings-value', 'settings-select', 'controls-label', 'key-chip'];

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });

// Title screen (before starting the game).
await captureScenario('title', async () => {}, ['game-title', 'game-subtitle', 'feature-line', 'menu-button', 'continue-summary']);

await page.evaluate(() => document.getElementById('start-button')?.click());
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
}, HUD_KEYS);

// Sunset (the default start time, 18:50) — warm bright sky.
await captureScenario('sunset', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.setGameMinutes(1130);
    g.weather.forceClear();
  });
  await showToast();
}, HUD_KEYS);

// Night + rain — the exact case from the user's screenshot.
await captureScenario('night-rain', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.setGameMinutes(0);
    g.weather.forceRain();
  });
  await showToast();
}, HUD_KEYS);

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
}, HUD_KEYS);

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
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
}, HUD_KEYS);

// Dialogue panel (forced line, 30s).
await captureScenario('dialogue', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.setGameMinutes(720);
    g.weather.forceClear();
    g.dialogue.say('mara', 'Contrast check — clean and fast, Rook.', 8);
  });
}, ['dialogue-name', 'dialogue-text']);

// Briefing phone panel (teleport next to Mara Solis). Dismiss the
// dialogue panel first: it overlaps the phone's ACCEPT/LATER buttons.
await captureScenario('briefing', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.dialogue.until = 0;
    document.getElementById('dialogue-panel').classList.add('hidden');
    g.player.group.position.set(50, 0, 0);
    g.player.heading = Math.PI / 2;
  });
  for (let i = 0; i < 20; i += 1) {
    const vis = await page.evaluate(() => !document.getElementById('phone-panel').classList.contains('hidden'));
    if (vis) break;
    await page.waitForTimeout(500);
  }
}, ['phone-giver', 'phone-text', 'phone-button']);

// Interaction prompt (E prompt at the barbershop — shares #hud-message).
await captureScenario('prompt', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.player.group.position.set(g.shop.x, 0, g.shop.z + 2);
  });
  for (let i = 0; i < 20; i += 1) {
    const t = await page.evaluate(() => document.getElementById('hud-message').textContent);
    if (t && t.includes('Press E')) break;
    await page.waitForTimeout(500);
  }
}, ['prompt']);

// Swimming (stamina bar + number only show while swimming).
await captureScenario('swimming', async () => {
  await page.evaluate(() => {
    const g = window.__game;
    g.setGameMinutes(720);
    g.weather.forceClear();
    g.player.group.position.set(0, 0, 368);
  });
  for (let i = 0; i < 20; i += 1) {
    const sw = await page.evaluate(() => window.__game.player.swimming);
    if (sw) break;
    await page.waitForTimeout(500);
  }
}, ['district', 'street', 'stamina-num', 'bar-label', 'mission', 'objective', 'money', 'stars', 'clock']);

// Menu tabs (game pauses while open; the panels are opaque, so the scene
// behind them does not matter — day/clear for the map canvas).
await page.evaluate(() => {
  const g = window.__game;
  g.setGameMinutes(720);
  g.weather.forceClear();
  g.player.group.position.set(0, 0, 0);
  g.openMenu('map');
});
await captureScenario('menu-map', async () => {}, MENU_KEYS, measureMapLabels);
await captureScenario('menu-map-bottom', async () => {
  await page.evaluate(() => { const s = document.getElementById('map-sidebar'); s.scrollTop = s.scrollHeight; });
}, MENU_KEYS);
await page.evaluate(() => window.__game.openMenu('story'));
await captureScenario('menu-story', async () => {}, MENU_KEYS);
await captureScenario('menu-story-bottom', async () => {
  await page.evaluate(() => { const s = document.getElementById('mission-list'); s.scrollTop = s.scrollHeight; });
}, MENU_KEYS);
await page.evaluate(() => window.__game.openMenu('stats'));
await captureScenario('menu-stats', async () => {}, MENU_KEYS);
await captureScenario('menu-stats-bottom', async () => {
  await page.evaluate(() => { const s = document.getElementById('stats-list'); s.scrollTop = s.scrollHeight; });
}, MENU_KEYS);
await page.evaluate(() => window.__game.openMenu('empire'));
await captureScenario('menu-empire', async () => {}, MENU_KEYS);
await captureScenario('menu-empire-bottom', async () => {
  await page.evaluate(() => { const s = document.getElementById('empire-list'); s.scrollTop = s.scrollHeight; });
}, MENU_KEYS);
await page.evaluate(() => window.__game.openMenu('settings'));
await captureScenario('menu-settings', async () => {}, MENU_KEYS);
await page.evaluate(() => window.__game.openMenu('controls'));
await captureScenario('menu-controls', async () => {}, MENU_KEYS);
await captureScenario('menu-controls-bottom', async () => {
  await page.evaluate(() => { const s = document.getElementById('controls-tab-panel'); s.scrollTop = s.scrollHeight; });
}, MENU_KEYS);
await page.evaluate(() => window.__game.openMenu('save'));
await captureScenario('menu-save', async () => {}, MENU_KEYS);
await page.evaluate(() => window.__game.closeMenu());

// BUSTED screen (gradient background, no game scene behind the text).
await captureScenario('busted', async () => {
  await page.evaluate(() => window.__game.endRun('BUSTED'));
}, ['down-title', 'down-sub']);

// WASTED screen (fresh page — the down screen is already showing).
await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.evaluate(() => document.getElementById('start-button')?.click());
await page.waitForTimeout(500);
await captureScenario('wasted', async () => {
  await page.evaluate(() => window.__game.endRun('WASTED'));
}, ['down-title', 'down-sub']);

writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 2));
console.log(`manifest: ${OUT}/manifest.json, errors: ${errors.length}`);
if (errors.length) console.log(errors.join('\n'));
await browser.close();
process.exit(errors.length ? 1 : 0);
