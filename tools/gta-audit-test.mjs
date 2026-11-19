// GTA-logic audit tests for SOLARIS KEYS: pistol locked at start, police shoot
// at 3+ stars, arrest/BUSTED at 1-2 stars, WASTED, car burn/explode, traffic
// steal, drive-by, Pay'n'Spray, ped death, witness system.
// Run: node tools/gta-audit-test.mjs
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
// Shooting is click-only now (Space = jump / handbrake). The first canvas
// click engages pointer lock and is NOT a shot, so lock first if needed.
async function shoot() {
  const locked = await page.evaluate(() => document.pointerLockElement !== null);
  if (!locked) {
    await page.mouse.click(640, 360);
    await page.waitForTimeout(500);
  }
  await page.mouse.click(640, 360);
}

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
// Dismiss the mission-1 briefing (LATER) so it does not block the screen.
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);

// --- 1. Pistol locked at start, fists selected ---
check('pistol locked at start', await page.evaluate(() => window.__game.combat.ammoForHud()[1].locked === true));
check('fists selected at start', await page.evaluate(() => window.__game.combat.ammoForHud()[0].active === true));
await page.keyboard.press('Digit2');
await page.waitForTimeout(1200);
check(
  'Digit2 shows pistol locked hint',
  await page.evaluate(() => document.getElementById('hud-message').textContent.includes('PISTOL locked')),
  await page.evaluate(() => document.getElementById('hud-message').textContent),
);

// --- 2. Police shoot at 3+ stars (health must drop) ---
await page.evaluate(() => window.__game.wanted.setStars(3));
const hpBefore = await page.evaluate(() => window.__game.health);
// Poll up to 90s: police must drive 60m+ via roads, then the 1-3s shoot
// cooldown must elapse, then a 30% hit must land. Headless game-time runs
// ~10-20x slower than real time under CPU contention.
let shotResult = { hp: hpBefore, state: 'play', title: '' };
for (let i = 0; i < 18; i += 1) {
  await page.waitForTimeout(5000);
  shotResult = await page.evaluate(() => ({
    hp: window.__game.health,
    state: window.__game.state,
    title: document.getElementById('down-title')?.textContent,
  }));
  if (shotResult.hp < hpBefore || shotResult.state === 'down') break;
}
// Police shooting works if HP dropped OR they killed the player (WASTED resets HP to 100).
check(
  'police shooting damages player at 3 stars',
  shotResult.hp < hpBefore || (shotResult.state === 'down' && shotResult.title === 'WASTED'),
  `HP ${hpBefore} -> ${shotResult.hp} state=${shotResult.state} ${shotResult.title || ''}`,
);
// Recover if WASTED, then clear wanted for the next test.
if (shotResult.state === 'down') {
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
}
await page.evaluate(() => { window.__game.wanted.setStars(0); });
await page.waitForTimeout(2000);

// --- 3. BUSTED via arrest at 1 star (on foot, police close in) ---
await page.evaluate(() => {
  window.__game.player.group.position.set(0, 0, 0);
  window.__game.wanted.setStars(1);
});
// Wait for the pursuit car to arrive and the 3s arrest timer to run out.
// Headless game-time runs ~4-10x slower than real time.
let busted = false;
for (let i = 0; i < 24; i += 1) {
  await page.waitForTimeout(5000);
  busted = await page.evaluate(() => window.__game.state === 'down' && document.getElementById('down-title').textContent === 'BUSTED');
  if (busted) break;
}
check('arrest at 1 star leads to BUSTED', busted);
if (busted) {
  check(
    'BUSTED clears wanted + restores health',
    await page.evaluate(() => window.__game.wanted.stars === 0 && window.__game.health === 100),
  );
  check(
    'BUSTED respawns at police station (-104,-104)',
    await page.evaluate(() => {
      const p = window.__game.player.position;
      return Math.abs(p.x + 104) < 1 && Math.abs(p.z + 104) < 1;
    }),
  );
  await page.screenshot({ path: '/tmp/gta-audit-busted.png' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  check('CONTINUE after BUSTED returns to play', await page.evaluate(() => window.__game.state === 'play'));
}

// --- 4. WASTED via damage ---
await page.evaluate(() => window.__game.damagePlayer(100));
await page.waitForTimeout(500);
check(
  'HP 0 shows WASTED screen',
  await page.evaluate(() => window.__game.state === 'down' && document.getElementById('down-title').textContent === 'WASTED'),
);
check(
  'WASTED respawns at hospital (52,26)',
  await page.evaluate(() => {
    const p = window.__game.player.position;
    return Math.abs(p.x - 52) < 1 && Math.abs(p.z - 26) < 1;
  }),
);
await page.screenshot({ path: '/tmp/gta-audit-wasted.png' });
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
check('CONTINUE after WASTED returns to play', await page.evaluate(() => window.__game.state === 'play'));
check('health restored to 100 after WASTED', await page.evaluate(() => window.__game.health === 100));

// --- 5. Car burn + explode ---
const burn = await page.evaluate(() => {
  const car = window.__game.cars[0];
  window.__game.player.group.position.set(car.position.x + 3, 0, car.position.z + 3);
  window.__game.damageCar(car, 100);
  return { hp: car.hp, burning: car.burning };
});
check('car at 0 HP starts burning', burn.hp <= 0 && burn.burning === true, `hp=${burn.hp} burning=${burn.burning}`);
const hpPreBoom = await page.evaluate(() => window.__game.health);
let exploded = false;
for (let i = 0; i < 12; i += 1) {
  await page.waitForTimeout(5000);
  exploded = await page.evaluate(() => window.__game.cars[0].destroyed === true);
  if (exploded) break;
}
check('burning car explodes after ~3s', exploded);
const hpPostBoom = await page.evaluate(() => window.__game.health);
check('explosion damages nearby player', hpPostBoom < hpPreBoom, `HP ${hpPreBoom} -> ${hpPostBoom}`);
// Heal back up for later tests (mission-complete path restores 100; use regen wait instead).
await page.evaluate(() => { window.__game.wanted.setStars(0); });

// --- 6. Steal a traffic car ---
const steal = await page.evaluate(() => {
  const npc = window.__game.traffic.cars[0];
  const carsBefore = window.__game.cars.length;
  const npcBefore = window.__game.traffic.cars.length;
  window.__game.player.group.position.set(npc.car.position.x + 1.5, 0, npc.car.position.z);
  return { carsBefore, npcBefore, name: npc.car.name };
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(1500);
check(
  'F steals a traffic car',
  await page.evaluate(() => window.__game.drivenCar !== null),
  `stole ${steal.name}`,
);
check(
  'stolen traffic car joins parked fleet + NPC replaced',
  await page.evaluate(([cb, nb]) => window.__game.cars.length === cb + 1 && window.__game.traffic.cars.length === nb, [steal.carsBefore, steal.npcBefore]),
);
check(
  'stealing gives a star',
  await page.evaluate(() => window.__game.wanted.stars >= 1),
  `stars=${await page.evaluate(() => window.__game.wanted.stars)}`,
);

// --- 7. Drive-by shooting (unlock pistol via test hook, then click while driving) ---
await page.evaluate(() => { window.__game.combat.unlockWeapon('pistol'); window.__game.wanted.setStars(0); });
await page.keyboard.press('Digit2');
await page.waitForTimeout(1200);
const magBefore = await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag);
await shoot();
await page.waitForTimeout(1500);
const magAfter = await page.evaluate(() => window.__game.combat.ammoForHud()[1].mag);
check('drive-by shooting spends pistol ammo while driving', magAfter === magBefore - 1, `mag ${magBefore} -> ${magAfter}`);

// --- 8. Pay'n'Spray repairs + clears heat ---
await page.evaluate(() => {
  window.__game.setMoney(500);
  window.__game.wanted.setStars(2);
  const car = window.__game.drivenCar;
  window.__game.damageCar(car, 50);
  car.group.position.set(104, 0, -52);
  car.position.set(104, 0, -52);
});
await page.waitForTimeout(1500);
check(
  "Pay'n'Spray does NOT auto-charge — no E press, no charge",
  await page.evaluate(() => window.__game.wanted.stars === 2 && window.__game.money === 500 && window.__game.drivenCar.hp === 50),
  `stars=${await page.evaluate(() => window.__game.wanted.stars)} money=$${await page.evaluate(() => window.__game.money)} hp=${await page.evaluate(() => window.__game.drivenCar.hp)}`,
);
await page.keyboard.press('KeyE');
await page.waitForTimeout(800);
check(
  "Pay'n'Spray E opens the garage screen (no instant charge)",
  await page.evaluate(() => !document.getElementById('garage-screen').classList.contains('hidden') && window.__game.money === 500),
);
await page.click('.garage-buy[data-action="repair"]');
await page.waitForTimeout(800);
check(
  "Pay'n'Spray clears wanted + repairs for $200 via garage REPAIR",
  await page.evaluate(() => window.__game.wanted.stars === 0 && window.__game.money === 300 && window.__game.drivenCar.hp === 100),
  `stars=${await page.evaluate(() => window.__game.wanted.stars)} money=$${await page.evaluate(() => window.__game.money)} hp=${await page.evaluate(() => window.__game.drivenCar.hp)}`,
);
await page.keyboard.press('Escape'); // close the garage screen so later tests can drive
await page.waitForTimeout(400);

// --- 9. Ped death: shot ped stays down 20s ---
await page.keyboard.press('KeyF'); // exit car
await page.waitForTimeout(1200);
const pedDown = await page.evaluate(() => {
  const ped = window.__game.pedestrians.peds[0];
  window.__game.pedestrians.knockDown(ped, window.__game.player.position.x, window.__game.player.position.z, 20);
  return { timer: ped.knockedTimer, fallen: Math.abs(ped.mesh.group.rotation.x) > 1 };
});
check('knockDown(20s) drops ped for 20s', pedDown.timer >= 19 && pedDown.fallen, `timer=${pedDown.timer.toFixed(1)} fallen=${pedDown.fallen}`);

// --- 10. Witness bypasses shoot cooldown ---
// Place a witness ped next to the player via line+along (placeOnSidewalk
// recomputes the mesh position from those every frame; setting x/z directly
// is overwritten immediately).
const placeWitness = () => page.evaluate(() => {
  const peds = window.__game.pedestrians;
  const ped = peds.peds[1];
  const p = window.__game.player.position;
  let best = null;
  let bestD = Infinity;
  for (const line of peds.lines) {
    const lat = line.axis === 'z' ? p.x : p.z;
    const d = Math.abs(lat - line.at);
    if (d < bestD) {
      bestD = d;
      best = line;
    }
  }
  ped.line = best;
  ped.along = best.axis === 'z' ? p.z : p.x;
  ped.along = Math.max(best.from, Math.min(best.to, ped.along));
  ped.side = (best.axis === 'z' ? p.x : p.z) >= best.at ? 1 : -1;
  ped.knockedTimer = 0;
  ped.fleeTimer = 0;
  ped.direction = 1;
});
await placeWitness();
await page.evaluate(() => {
  window.__game.wanted.setStars(0);
  window.__game.wanted.lastShootStarAt = -99;
});
await shoot(); // shot 1 -> 1 star
await page.waitForTimeout(1000);
const stars1 = await page.evaluate(() => window.__game.wanted.stars);
// Wait for the pistol cooldown (0.28s game-time) to actually elapse — poll the
// real timer instead of guessing real-time, since headless game-time runs
// ~10-20x slower than real time.
for (let i = 0; i < 15; i += 1) {
  const cd = await page.evaluate(() => window.__game.combat.cooldownTimer);
  if (cd <= 0) break;
  await page.waitForTimeout(1000);
}
// Re-place the witness: it flees after shot 1 and may leave the 20m radius
// during the cooldown wait.
await placeWitness();
await shoot(); // shot 2 within 4s cooldown, witness nearby
await page.waitForTimeout(3000);
const stars2 = await page.evaluate(() => window.__game.wanted.stars);
check('witness calls in second shot despite cooldown', stars1 === 1 && stars2 === 2, `stars ${stars1} -> ${stars2}`);

check('zero console/page errors', errors.length === 0, errors.join(' | ').slice(0, 300));

const fails = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
