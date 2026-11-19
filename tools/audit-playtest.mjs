// Audit playtest for SOLARIS KEYS: roleplays a real GTA player through the
// scenarios the other suites do not cover — GHOST achievement paths, the
// remaining achievements, chaos run + escape, explorer bounds, save scumming,
// dying mid-robbery, screen overlap, edge cases.
// Run: node tools/audit-playtest.mjs
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

await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
await page.click('#start-button');
await page.waitForTimeout(500);
await page.evaluate(() => document.getElementById('phone-later')?.click());
await page.waitForTimeout(300);
// Capture the starter car's spawn position now — later tests move cars around.
const starterSpawn = await page.evaluate(() => ({
  x: window.__game.cars[0].position.x,
  z: window.__game.cars[0].position.z,
}));

// --- 1. GHOST: hiding out a 5-star heat counts as an escape ---
await page.evaluate(() => {
  window.__game.wanted.setStars(5);
});
await page.waitForTimeout(2000); // let the game register the 5-star episode
await page.evaluate(() => {
  window.__game.wanted.setStars(1);
  window.__game.wanted.hiddenSeconds = 5.9; // 1 star needs 6s hidden
  window.__game.player.group.position.set(-150, 0, -150);
});
await page.waitForTimeout(8000);
check(
  'GHOST: hiding from 5 stars down to 0 counts as an escape',
  await page.evaluate(() => window.__game.wanted.stars === 0 && window.__game.stats.escapes5 === 1),
  await page.evaluate(() => `stars=${window.__game.wanted.stars} escapes5=${window.__game.stats.escapes5}`),
);
check(
  'GHOST achievement unlocked (+$1,000)',
  await page.evaluate(() => window.__game.achievements.includes('ghost')),
);

// --- 2. GHOST negative: Pay'n'Spray clear is NOT an escape ---
await page.evaluate(() => {
  window.__game.stats.escapes5 = 0;
  window.__game.wanted.setStars(5);
});
await page.waitForTimeout(2000);
await page.evaluate(() => window.__game.wanted.setStars(0)); // same as Pay'n'Spray clear
await page.waitForTimeout(1500);
check(
  'GHOST: clearing 5 stars instantly (Pay\'n\'Spray) is NOT an escape',
  await page.evaluate(() => window.__game.stats.escapes5 === 0),
  await page.evaluate(() => `escapes5=${window.__game.stats.escapes5}`),
);

// --- 3. GHOST negative: dying at 5 stars is NOT an escape ---
await page.evaluate(() => window.__game.wanted.setStars(5));
await page.waitForTimeout(2000);
await page.evaluate(() => window.__game.damagePlayer(500));
await page.waitForTimeout(1000);
check(
  'GHOST: dying at 5 stars is NOT an escape',
  await page.evaluate(() => window.__game.stats.escapes5 === 0 && window.__game.state === 'down'),
  await page.evaluate(() => `escapes5=${window.__game.stats.escapes5} state=${window.__game.state}`),
);
await page.click('#down-button');
await page.waitForTimeout(500);

// --- 4. M + B screens never overlap ---
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);
check(
  'opening EMPIRE while MISSIONS is open closes MISSIONS',
  await page.evaluate(
    () => document.getElementById('mission-screen').classList.contains('hidden') && !document.getElementById('empire-screen').classList.contains('hidden'),
  ),
);
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);
check(
  'opening MISSIONS while EMPIRE is open closes EMPIRE',
  await page.evaluate(
    () => !document.getElementById('mission-screen').classList.contains('hidden') && document.getElementById('empire-screen').classList.contains('hidden'),
  ),
);
await page.keyboard.press('KeyM');
await page.waitForTimeout(300);

// --- 5. Buy with exactly enough money ---
await page.evaluate(() => window.__game.setMoney(2000));
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);
await page.click('.empire-buy');
await page.waitForTimeout(400);
check(
  'buy with exactly $2,000 works, money hits $0',
  await page.evaluate(() => window.__game.businesses.state[0].owned === true && window.__game.money === 0),
  await page.evaluate(() => `owned=${window.__game.businesses.state[0].owned} money=$${window.__game.money}`),
);
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);

// --- 6. No collect prompt with 0 pending ---
await page.evaluate(() => {
  window.__game.businesses.state[0].pending = 0;
  window.__game.player.group.position.set(52, 0, 52);
});
await page.waitForTimeout(1500);
check(
  'no collect prompt when nothing is pending',
  await page.evaluate(() => !document.getElementById('hud-message').textContent.includes('collect $')),
  await page.evaluate(() => document.getElementById('hud-message').textContent),
);

// --- 7. TYCOON: own all 3 businesses ---
await page.evaluate(() => {
  window.__game.setMoney(50000);
  window.__game.setRep(800); // REP_PER_LEVEL=200 -> repLevel 5
});
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);
await page.click('.empire-buy'); // nightclub ($6,000)
await page.waitForTimeout(300);
await page.click('.empire-buy'); // dealership ($15,000)
await page.waitForTimeout(400);
check(
  'TYCOON unlocks at 3 businesses owned',
  await page.evaluate(() => window.__game.businesses.ownedCount() === 3 && window.__game.achievements.includes('tycoon')),
  await page.evaluate(() => `owned=${window.__game.businesses.ownedCount()} achievements=${window.__game.achievements.join(',')}`),
);
await page.keyboard.press('KeyB');
await page.waitForTimeout(300);

// --- 8. BIG SHOT: crossing $50,000 career earnings ---
await page.evaluate(() => {
  window.__game.stats.moneyEarned = 49900;
  window.__game.businesses.state[0].pending = 500;
  window.__game.player.group.position.set(52, 0, 52);
});
await page.waitForTimeout(1500);
await page.keyboard.press('KeyE');
await page.waitForTimeout(800);
check(
  'BIG SHOT unlocks when career earnings pass $50,000',
  await page.evaluate(() => window.__game.achievements.includes('bigShot')),
  await page.evaluate(() => `moneyEarned=$${Math.floor(window.__game.stats.moneyEarned)}`),
);

// --- 9. MENACE: running a ped over counts ---
await page.evaluate(() => {
  window.__game.stats.pedsDown = 9;
  const ped = window.__game.pedestrians.peds.find((p) => p.knockedTimer <= 0);
  const car = window.__game.cars[0];
  // Park the car 1.5m from a ped, aimed straight at it, already rolling at
  // 20 m/s — the hit check (range 2.1m, min speed 2) fires on the first
  // frame after the player gets in.
  const px = ped.mesh.group.position.x;
  const pz = ped.mesh.group.position.z;
  const dx = px - car.position.x;
  const dz = pz - car.position.z;
  const d = Math.hypot(dx, dz) || 1;
  car.group.position.set(px - (dx / d) * 1.5, 0, pz - (dz / d) * 1.5);
  car.heading = Math.atan2(dx, dz);
  car.group.rotation.y = car.heading;
  car.speed = 20;
  window.__game.player.group.position.set(car.position.x + 2, 0, car.position.z);
});
await page.keyboard.press('KeyF');
await page.waitForTimeout(500);
let menace = false;
for (let i = 0; i < 20; i += 1) {
  menace = await page.evaluate(() => window.__game.stats.pedsDown >= 10);
  if (menace) break;
  await page.waitForTimeout(500);
}
check(
  'MENACE unlocks at 10 pedestrians down',
  menace && (await page.evaluate(() => window.__game.achievements.includes('menace'))),
  await page.evaluate(() => `pedsDown=${window.__game.stats.pedsDown}`),
);

// --- 10. Chaos run: 5 stars by stealing, full police response, escape via spray ---
await page.keyboard.press('KeyF'); // exit current car
await page.waitForTimeout(400);
await page.evaluate(() => {
  window.__game.wanted.setStars(0);
  window.__game.setMoney(500);
});
for (let i = 0; i < 5; i += 1) {
  // Try offsets until the player settles within enter range — the building
  // push-out can shove a teleported player out of the 4m enter range.
  let inRange = false;
  for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) {
    await page.evaluate(([x, z]) => {
      const g = window.__game;
      const car = g.cars.find((c) => !c.owned && !c.destroyed);
      if (car) g.player.group.position.set(car.position.x + x, 0, car.position.z + z);
    }, [ox, oz]);
    await page.waitForTimeout(300);
    inRange = await page.evaluate(() => {
      const g = window.__game;
      const car = g.cars.find((c) => !c.owned && !c.destroyed);
      if (!car) return false;
      return Math.hypot(g.player.group.position.x - car.position.x, g.player.group.position.z - car.position.z) < 3.5;
    });
    if (inRange) break;
  }
  if (!inRange) break;
  await page.keyboard.press('KeyF');
  // Poll for the enter/exit to register — fixed waits desync under load and
  // the exit KeyF can land before the enter is processed.
  await page.waitForFunction(() => window.__game.drivenCar !== null, null, { timeout: 5000 }).catch(() => {});
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__game.drivenCar === null, null, { timeout: 5000 }).catch(() => {});
}
await page.waitForTimeout(3000);
const chaos = await page.evaluate(() => ({
  stars: window.__game.wanted.stars,
  pursuit: window.__game.police.pursuit.length,
  heli: window.__game.police.helicopter !== null,
  roadblock: window.__game.police.roadblock.length,
}));
check(
  'chaos run: 5 stars brings 6 pursuit cars + heli + roadblock',
  chaos.stars === 5 && chaos.pursuit === 6 && chaos.heli && chaos.roadblock >= 2,
  `stars=${chaos.stars} pursuit=${chaos.pursuit} heli=${chaos.heli} roadblock=${chaos.roadblock}`,
);
// Escape: drive to Pay'n'Spray and press E.
await page.evaluate(() => {
  const g = window.__game;
  const car = g.drivenCar || g.cars[0];
  car.group.position.set(104, 0, -52);
  car.position.set(104, 0, -52);
  if (!g.drivenCar) {
    g.player.group.position.set(104, 0, -50);
  }
});
if (!(await page.evaluate(() => Boolean(window.__game.drivenCar)))) {
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(500);
}
await page.waitForTimeout(1000);
const moneyBeforeSpray = await page.evaluate(() => window.__game.money);
await page.keyboard.press('KeyE');
await page.waitForTimeout(800);
await page.click('.garage-buy[data-action="repair"]');
await page.waitForTimeout(800);
check(
  'chaos run: Pay\'n\'Spray escape clears 5 stars for $200',
  await page.evaluate(
    (before) => window.__game.wanted.stars === 0 && window.__game.money === before - 200,
    moneyBeforeSpray,
  ),
  await page.evaluate(() => `stars=${window.__game.wanted.stars} money=$${window.__game.money}`),
);
await page.keyboard.press('Escape'); // close the garage screen so later tests can drive
await page.waitForTimeout(400);

// --- 11. Explorer: the map edges hold (no escaping the world) ---
await page.keyboard.press('KeyF'); // exit the car, test on foot
await page.waitForTimeout(400);
const bounds = [];
for (const [x, z] of [[-300, 0], [300, 0], [0, -300], [0, 300]]) {
  await page.evaluate(([px, pz]) => window.__game.player.group.position.set(px, 0, pz), [x, z]);
  await page.waitForTimeout(800); // the update loop clamps via city.resolveCircle
  bounds.push(
    await page.evaluate(() => ({
      x: window.__game.player.group.position.x,
      z: window.__game.player.group.position.z,
    })),
  );
}
check(
  'player cannot leave the map bounds',
  bounds.every((p) => p.x >= -162 && p.x <= 162 && p.z >= -162 && p.z <= 96),
  bounds.map((p) => `(${p.x.toFixed(0)},${p.z.toFixed(0)})`).join(' '),
);

// --- 12. Save scummer: save mid-chase, load, state stays consistent ---
await page.evaluate(() => {
  window.__game.wanted.setStars(3);
  window.__game.save.saveGame(3, window.__game.snapshotSave());
  window.__game.wanted.setStars(0);
  const loaded = window.__game.save.loadGame(3);
  window.__game.applySave(loaded);
});
await page.waitForTimeout(500);
check(
  'load after mid-chase save: wanted cleared, health full, on foot, still playing',
  await page.evaluate(
    () => window.__game.wanted.stars === 0 && window.__game.health === 100 && !window.__game.drivenCar && window.__game.state === 'play',
  ),
  await page.evaluate(() => `stars=${window.__game.wanted.stars} health=${window.__game.health} state=${window.__game.state}`),
);

// --- 13. Dying during a robbery does not break the event ---
await page.evaluate(() => window.__game.robbery.forceStart());
await page.waitForTimeout(2000);
const robberyActive = await page.evaluate(() => window.__game.robbery.active);
await page.evaluate(() => window.__game.damagePlayer(500));
await page.waitForTimeout(800);
await page.click('#down-button');
await page.waitForTimeout(800);
check(
  'dying during a robbery recovers cleanly',
  await page.evaluate(() => window.__game.state === 'play'),
  `robbery was active=${robberyActive} state=${await page.evaluate(() => window.__game.state)}`,
);

// --- 14. Starter car spawns on the road centreline, clear of traffic lanes ---
check(
  'starter car is on the road centreline (traffic passes either side)',
  starterSpawn.x === 0 && Math.abs(starterSpawn.x - 2.5) > 1.9 && Math.abs(starterSpawn.x + 2.5) > 1.9,
  `starter spawned at (${starterSpawn.x}, ${starterSpawn.z})`,
);

// --- 15. Button masher: 40 random keys incl. Space/M/B/E/F, no crash ---
const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF', 'KeyM', 'KeyB', 'KeyE', 'KeyR', 'KeyH', 'Digit1', 'Digit2', 'Digit3', 'Digit4'];
for (let i = 0; i < 40; i += 1) {
  await page.keyboard.press(keys[Math.floor(Math.random() * keys.length)]);
  await page.waitForTimeout(60);
}
await page.waitForTimeout(500);
// Close any open screen so the final state check is clean.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
check(
  'button mashing leaves the game in a sane state',
  await page.evaluate(() => ['play', 'pause'].includes(window.__game.state)),
  await page.evaluate(() => `state=${window.__game.state}`),
);

check('zero console/page errors', errors.length === 0, errors.length ? errors.join(' | ').slice(0, 400) : '');

const fails = results.filter((r) => r.startsWith('FAIL'));
console.log(`\n${results.length - fails.length}/${results.length} passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
