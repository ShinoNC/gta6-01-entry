// Top-10 gap features tests for SOLARIS KEYS (#2 map, #3 garage, #5 MISSION
// PASSED, #6 damage numbers + crosshair, #7 CONDITION, #8 districts,
// #9 givers, #10 % COMPLETE, #11 radio, night cycle).
// Run: node tools/gap-features-test.mjs
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
const errors = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });

const results = [];
function check(name, ok, detail = '') {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  console.log(results[results.length - 1]);
}
async function dismissPhone() {
  await page.evaluate(() => document.getElementById('phone-later')?.click());
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
await dismissPhone();
await page.waitForTimeout(300);

// --- A. Districts (#8): 8 named areas resolve at the right coords ---
const districts = [
  [52, 0, 'MARINA DEL SOL'], [-52, 0, 'LANTERN ROW'],
  [52, 40, 'PELICAN BAY'], [-52, 40, 'PALM ROW'],
  [52, -104, 'HARBOR LIGHTS'], [-52, -104, 'OLD PORT'],
  [52, 77, 'SUNSET BLUFF'], [-52, 77, 'CORAL STRAND'],
];
for (const [x, z, name] of districts) {
  await page.evaluate(([px, pz]) => window.__game.player.group.position.set(px, 0, pz), [x, z]);
  await page.waitForTimeout(600);
  const shown = await page.evaluate(() => document.getElementById('hud-district').textContent);
  check(`district (${x},${z}) shows ${name}`, shown === name, `got "${shown}"`);
}

// --- B. Radio (#11): 3 stations, KEYS FM 95.5 among them ---
const stations = await page.evaluate(() => {
  const names = [];
  for (let i = 0; i < 3; i += 1) names.push(window.__game.audio.nextStation());
  return names;
});
check(
  '3 radio stations incl. KEYS FM 95.5',
  new Set(stations).size === 3 && stations.some((s) => s.includes('KEYS FM 95.5')),
  stations.join(' / '),
);

// --- C. Full-screen map (#2): N opens/closes, Escape closes, one screen at a time ---
await dismissPhone();
await page.keyboard.press('KeyN');
await page.waitForTimeout(400);
check(
  'N opens the map screen with a 1024x816 canvas',
  await page.evaluate(() => {
    const c = document.getElementById('bigmap');
    return !document.getElementById('map-screen').classList.contains('hidden') && c.width === 1024 && c.height === 816;
  }),
);
await page.keyboard.press('KeyN');
await page.waitForTimeout(300);
check(
  'N closes the map screen',
  await page.evaluate(() => document.getElementById('map-screen').classList.contains('hidden')),
);
await page.keyboard.press('KeyN');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check(
  'Escape closes the map screen',
  await page.evaluate(() => document.getElementById('map-screen').classList.contains('hidden')),
);
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);
await page.keyboard.press('KeyN');
await page.waitForTimeout(300);
check(
  'opening the map closes the mission screen',
  await page.evaluate(() =>
    document.getElementById('mission-screen').classList.contains('hidden') &&
    !document.getElementById('map-screen').classList.contains('hidden')),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// --- G. % COMPLETE + play time (#10) and givers (#9) on the mission screen ---
await dismissPhone();
await page.keyboard.press('KeyM');
await page.waitForTimeout(400);
check(
  'mission screen starts at 0% COMPLETE with play time',
  await page.evaluate(() => {
    const text = document.getElementById('mission-list').textContent;
    return text.includes('0% COMPLETE') && text.includes('played');
  }),
);
check(
  'mission list shows 3 givers (Mara, Juno, Otto)',
  await page.evaluate(() => {
    const text = document.getElementById('mission-list').textContent;
    return text.includes('from Mara Solis') && text.includes('from Juno Reyes') && text.includes('from Otto Kane');
  }),
);
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);
await page.evaluate(() => {
  window.__game.missions.setCompleted(4);
  window.__game.missions.snoozeBriefing(300);
  window.__game.tapes.setCollected(10);
});
await page.keyboard.press('KeyM');
await page.waitForTimeout(400);
const pct = await page.evaluate(() => {
  const m = document.getElementById('mission-list').textContent.match(/(\d+)% COMPLETE/);
  return m ? parseInt(m[1], 10) : -1;
});
check('% COMPLETE updates with progress (4 jobs + 10 tapes = 33%)', pct === 33, `got ${pct}%`);
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);

// --- D. Car CONDITION % + class (#7) ---
await page.evaluate(() => {
  const g = window.__game;
  const car = g.cars[0];
  g.player.group.position.set(car.position.x + 2, 0, car.position.z);
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(600);
check(
  'driving shows car class + CONDITION 100%',
  await page.evaluate(() => document.getElementById('hud-condition').textContent.includes('CONDITION 100%')),
  await page.evaluate(() => document.getElementById('hud-condition').textContent),
);
await page.evaluate(() => window.__game.damageCar(window.__game.drivenCar, 50));
await page.waitForTimeout(600);
check(
  'CONDITION drops to 50% after 50 damage',
  await page.evaluate(() => document.getElementById('hud-condition').textContent.includes('CONDITION 50%')),
  await page.evaluate(() => document.getElementById('hud-condition').textContent),
);

// --- E. Crosshair + damage numbers (#6) ---
check(
  'crosshair hidden with FISTS',
  await page.evaluate(() => document.getElementById('crosshair').classList.contains('hidden')),
);
await page.evaluate(() => {
  window.__game.combat.setOwnedWeapons(['fists', 'pistol']);
  window.__game.combat.restock();
  window.__game.combat.selectWeapon(1);
});
await page.waitForTimeout(400);
check(
  'crosshair shows with PISTOL equipped',
  await page.evaluate(() => !document.getElementById('crosshair').classList.contains('hidden')),
);
await page.evaluate(() => window.__game.hud.spawnDamageNumber(640, 360, '-12'));
await page.waitForTimeout(200);
check(
  'damage number appears in the layer',
  await page.evaluate(() => {
    const kids = [...document.querySelectorAll('#dmg-layer > div')];
    return kids.some((d) => !d.classList.contains('hidden') && d.textContent === '-12');
  }),
);

// --- F. MISSION PASSED full screen (#5) ---
await page.evaluate(() =>
  window.__game.hud.showPassed('MISSION PASSED', 'TEST JOB', ['+$500 · +50 REP', 'PISTOL UNLOCKED']),
);
await page.waitForTimeout(300);
check(
  'MISSION PASSED screen shows title + rewards',
  await page.evaluate(() => {
    const el = document.getElementById('passed-screen');
    return !el.classList.contains('hidden') && el.textContent.includes('MISSION PASSED') &&
      el.textContent.includes('+$500') && el.textContent.includes('PISTOL UNLOCKED');
  }),
);
await page.waitForTimeout(4500);
check(
  'MISSION PASSED screen auto-hides after 4s',
  await page.evaluate(() => document.getElementById('passed-screen').classList.contains('hidden')),
);

// --- I. Garage upgrades at Pay'n'Spray (#3) ---
await page.evaluate(() => {
  const g = window.__game;
  g.setMoney(10000);
  const car = g.drivenCar;
  car.group.position.set(104, 0, -52);
  car.position.set(104, 0, -52);
  car.speed = 0;
});
await page.waitForTimeout(800);
await page.keyboard.press('KeyE');
await page.waitForTimeout(500);
check(
  'E at Pay\'n\'Spray opens the garage with 3 upgrades + repair',
  await page.evaluate(() => {
    const el = document.getElementById('garage-screen');
    if (el.classList.contains('hidden')) return false;
    const text = document.getElementById('garage-list').textContent;
    return text.includes('ENGINE TUNE') && text.includes('ARMOUR PLATING') && text.includes('NITRO') && text.includes('REPAIR');
  }),
);
const speedBefore = await page.evaluate(() => window.__game.drivenCar.maxSpeed);
await page.click('.garage-buy[data-action="engine"]');
await page.waitForTimeout(400);
check(
  'ENGINE TUNE $4,000: money drops, flag set, current car faster',
  await page.evaluate(
    (before) => window.__game.money === 6000 && window.__game.garage.engine && window.__game.drivenCar.maxSpeed > before * 1.1,
    speedBefore,
  ),
  `maxSpeed ${speedBefore.toFixed(1)} -> ${await page.evaluate(() => window.__game.drivenCar.maxSpeed.toFixed(1))}`,
);
await page.click('.garage-buy[data-action="armour"]');
await page.waitForTimeout(400);
check(
  'ARMOUR PLATING $3,000: car maxHp 200, hp topped to 200',
  await page.evaluate(() =>
    window.__game.money === 3000 && window.__game.garage.armour &&
    window.__game.drivenCar.maxHp === 200 && window.__game.drivenCar.hp === 200,
  ),
);
await page.click('.garage-buy[data-action="nitro"]');
await page.waitForTimeout(400);
check(
  'NITRO $3,000: money 0, flag set, car has nitro',
  await page.evaluate(() =>
    window.__game.money === 0 && window.__game.garage.nitro && window.__game.drivenCar.nitro === true,
  ),
);
// Repair via the garage: damage the car, set heat, reopen, click REPAIR.
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.evaluate(() => {
  const g = window.__game;
  g.setMoney(500);
  g.wanted.setStars(2);
  g.damageCar(g.drivenCar, 50);
});
await page.keyboard.press('KeyE');
await page.waitForTimeout(500);
await page.click('.garage-buy[data-action="repair"]');
await page.waitForTimeout(400);
check(
  'garage REPAIR $200: hp back to maxHp 200, heat cleared',
  await page.evaluate(() =>
    window.__game.money === 300 && window.__game.drivenCar.hp === 200 && window.__game.wanted.stars === 0,
  ),
  await page.evaluate(() => `money=$${window.__game.money} hp=${window.__game.drivenCar.hp} stars=${window.__game.wanted.stars}`),
);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
// Nitro boost: hold SHIFT while driving.
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(600);
check(
  'holding SHIFT with nitro sets boosting on the driven car',
  await page.evaluate(() => window.__game.drivenCar.boosting === true),
);
await page.keyboard.up('ShiftLeft');
// Garage persists in saves.
check(
  'garage upgrades persist in the save file',
  await page.evaluate(() => {
    const g = window.__game;
    g.save.saveGame(3, g.snapshotSave());
    const loaded = g.save.loadGame(3);
    return loaded.garage && loaded.garage.engine && loaded.garage.armour && loaded.garage.nitro;
  }),
);

// --- J. Night cycle: the clock follows gameMinutes into the night ---
await page.evaluate(() => window.__game.setGameMinutes(22 * 60 + 30));
await page.waitForTimeout(800);
check(
  'clock shows 22:30 after setting night time',
  await page.evaluate(() => document.getElementById('hud-clock').textContent.includes('22:3')),
  await page.evaluate(() => document.getElementById('hud-clock').textContent),
);
await page.evaluate(() => window.__game.setGameMinutes(12 * 60));
await page.waitForTimeout(800);
check(
  'clock shows 12:00 after setting noon',
  await page.evaluate(() => document.getElementById('hud-clock').textContent.includes('12:00')),
  await page.evaluate(() => document.getElementById('hud-clock').textContent),
);

const failed = results.filter((r) => r.startsWith('FAIL')).length;
console.log(`\n${results.length - failed}/${results.length} passed, ${failed} failed`);
if (errors.length) console.log(`CONSOLE/PAGE ERRORS:\n${errors.join('\n')}`);
await browser.close();
process.exit(failed || errors.length ? 1 : 0);
