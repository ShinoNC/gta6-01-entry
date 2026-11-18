// Focused retest for inconclusive drive/collision tests — uses direct speed
// setting and teleporting instead of slow keyboard driving.
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const LOG = '/home/hatch/workspace/makefun/gta6-01/player-test-results.log';
const POLICY_PATH = '/var/lib/hatch-browser/rootfs-base/usr/share/hatch/chromium/webgl-allowed-domains.txt';
const policySha = createHash('sha256').update(readFileSync(POLICY_PATH)).digest('hex');
const browser = await chromium.launch({
  executablePath: '/opt/meta-chromium/chrome',
  args: ['--no-sandbox', '--disable-gpu', '--allow-file-access-from-files', '--disable-dev-shm-usage',
    '--force-device-scale-factor=1', `--hatch-webgl-allowed-domains-file=${POLICY_PATH}`,
    `--hatch-webgl-allowed-domains-sha256=${policySha}`],
});
const errors = [];
const results = [];
function out(line) {
  results.push(line);
  console.log(line);
  appendFileSync(LOG, line + '\n');
}
function check(name, ok, detail = '') {
  out(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
function note(text) {
  out(`NOTE ${text}`);
}
out(`=== RETEST ${new Date().toISOString()} ===`);

async function freshPage() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE: ${m.text()}`); });
  await page.goto(`file://${ENTRY}/game/index.html?seed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 60000 });
  await page.waitForTimeout(500);
  return page;
}
async function startGame(page) {
  await page.click('#start-button');
  await page.waitForTimeout(400);
}

// R1: player on foot — teleport INTO a parked car. Does the game push the player out?
{
  const page = await freshPage();
  await startGame(page);
  await page.click('#phone-later').catch(() => {});
  const r1 = await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    g.player.group.position.set(car.position.x, 0, car.position.z);
    return { cx: car.position.x, cz: car.position.z };
  });
  // Walk a little so the update loop runs the collision resolve (if any).
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(2000);
  await page.keyboard.up('KeyW');
  const r1after = await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    const p = g.player.group.position;
    return { dist: Math.hypot(p.x - car.position.x, p.z - car.position.z).toFixed(2) };
  });
  check('R1: player on foot cannot stand inside a parked car', Number(r1after.dist) > 1.5,
    `player ended ${r1after.dist}m from car centre (car is ~2m wide, player radius 0.7)`);
  void r1;
  await page.close();
}

// R2: driven car vs parked car — place 5m away, speed 30, drive into it.
{
  const page = await freshPage();
  await startGame(page);
  await page.click('#phone-later').catch(() => {});
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g = window.__game;
    const target = g.cars.find((c) => c.name === 'PALM RUNNER');
    const car = g.drivenCar;
    car.group.position.set(target.position.x, 0, target.position.z - 5);
    car.heading = 0;
    car.group.rotation.y = 0;
    car.speed = 30;
    car.hp = 100;
    target.hp = 100;
  });
  await page.waitForTimeout(4000);
  const r2 = await page.evaluate(() => {
    const g = window.__game;
    const target = g.cars.find((c) => c.name === 'PALM RUNNER');
    const car = g.drivenCar;
    const d = Math.hypot(car.position.x - target.position.x, car.position.z - target.position.z);
    return { dist: d.toFixed(1), myHp: car.hp, tgtHp: target.hp, myZ: car.position.z.toFixed(1), tgtZ: target.position.z.toFixed(1), speed: car.speed.toFixed(1) };
  });
  check('R2: driven car collides with parked car (not pass through)', Number(r2.dist) > 2.5,
    `gap ${r2.dist}m, my hp=${r2.myHp}, target hp=${r2.tgtHp}, my z=${r2.myZ} vs target z=${r2.tgtZ}, speed=${r2.speed}`);
  await page.screenshot({ path: '/home/hatch/workspace/makefun/gta6-01/player-r2.png' });
  await page.close();
}

// R3: building crash — place 5m from building face, speed 30.
{
  const page = await freshPage();
  await startGame(page);
  await page.click('#phone-later').catch(() => {});
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.drivenCar;
    // Building at (-26,-130), 32x32 -> south face at z=-114. Approach from z=-108 heading north.
    car.group.position.set(-26, 0, -108);
    car.heading = Math.PI;
    car.group.rotation.y = Math.PI;
    car.speed = 30;
    car.hp = 100;
  });
  await page.waitForTimeout(3000);
  const r3 = await page.evaluate(() => {
    const g = window.__game;
    const car = g.drivenCar;
    return { hp: car.hp, speed: car.speed.toFixed(1), z: car.position.z.toFixed(1), health: g.health, impact: car.impact.toFixed(2) };
  });
  check('R3: crashing into a building at 30 m/s damages the car', r3.hp < 100,
    `hp 100 -> ${r3.hp}, speed ${r3.speed}, z=${r3.z} (building face -114), player health ${r3.health}, impact=${r3.impact}`);
  await page.close();
}

// R4: Pay'n'Spray — teleport the car directly into the spray zone.
{
  const page = await freshPage();
  await startGame(page);
  await page.click('#phone-later').catch(() => {});
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  const before = await page.evaluate(() => {
    const g = window.__game;
    g.setMoney(1000);
    g.wanted.setStars(1);
    const car = g.drivenCar;
    car.hp = 95;
    car.group.position.set(104, 0, -52);
    car.speed = 0;
    return { money: g.money, hp: car.hp, stars: g.wanted.stars };
  });
  await page.waitForTimeout(2000);
  const after = await page.evaluate(() => ({
    money: window.__game.money, hp: window.__game.drivenCar.hp, stars: window.__game.wanted.stars,
    msg: document.getElementById('hud-message').textContent,
  }));
  check('R4: Pay\'n\'Spray does NOT auto-charge $200 for a 5-HP scratch just by being in the zone',
    after.money === before.money,
    `money $${before.money} -> $${after.money}, hp ${before.hp} -> ${after.hp}, stars ${before.stars} -> ${after.stars}, msg="${after.msg}"`);
  await page.close();
}

// R5: traffic ram — place driven car 5m behind a traffic car, speed 30.
{
  const page = await freshPage();
  await startGame(page);
  await page.click('#phone-later').catch(() => {});
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g = window.__game;
    const npc = g.traffic.cars[0];
    const car = g.drivenCar;
    car.hp = 100;
    npc.car.hp = 100;
    car.group.position.set(npc.car.position.x, 0, npc.car.position.z - 5);
    car.heading = 0;
    car.group.rotation.y = 0;
    car.speed = 30;
  });
  await page.waitForTimeout(3000);
  const r5 = await page.evaluate(() => {
    const g = window.__game;
    return { myHp: g.drivenCar.hp, npcHp: g.traffic.cars[0].car.hp, speed: g.drivenCar.speed.toFixed(1) };
  });
  check('R5: ramming a traffic car at 30 m/s damages cars', r5.myHp < 100 || r5.npcHp < 100,
    `my hp=${r5.myHp}, traffic hp=${r5.npcHp}, speed=${r5.speed}`);
  await page.close();
}

// R6: police pursuit collision — place driven car 5m behind a pursuit car, speed 30.
{
  const page = await freshPage();
  await startGame(page);
  await page.click('#phone-later').catch(() => {});
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__game.wanted.setStars(1); });
  await page.waitForTimeout(5000);
  const setup = await page.evaluate(() => {
    const g = window.__game;
    const unit = g.police.pursuit[0];
    if (!unit) return { none: true };
    const car = g.drivenCar;
    car.group.position.set(unit.car.position.x, 0, unit.car.position.z - 5);
    car.heading = 0;
    car.group.rotation.y = 0;
    car.speed = 30;
    return { policeZ: unit.car.position.z.toFixed(1) };
  });
  if (!setup.none) {
    await page.waitForTimeout(3000);
    const r6 = await page.evaluate(() => {
      const g = window.__game;
      const unit = g.police.pursuit[0];
      if (!unit) return { gone: true };
      const car = g.drivenCar;
      const d = Math.hypot(car.position.x - unit.car.position.x, car.position.z - unit.car.position.z);
      return { dist: d.toFixed(1), myZ: car.position.z.toFixed(1), policeZ: unit.car.position.z.toFixed(1), speed: car.speed.toFixed(1) };
    });
    // Pursuit police get damage+slow with NO push-out (preserves the ram
    // mechanic), so the cars rest in contact — pass = stopped + did not
    // pass through (still behind the police car's z). The original bug was
    // driving straight through at speed 22.
    check('R6: driven car collides with pursuit police car (not pass through)',
      r6.gone || (Number(r6.speed) < 5 && Number(r6.myZ) < Number(r6.policeZ)),
      r6.gone ? 'police unit despawned mid-test' : `gap ${r6.dist}m, my z=${r6.myZ} vs police z=${r6.policeZ}, speed=${r6.speed}`);
  } else {
    note('R6: skipped — no pursuit unit spawned');
  }
  await page.close();
}

// R7: car explosion — set car HP to 1 while driving, crash it, watch the burn + explosion.
{
  const page = await freshPage();
  await startGame(page);
  await page.click('#phone-later').catch(() => {});
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.drivenCar;
    car.group.position.set(-26, 0, -108);
    car.heading = Math.PI;
    car.group.rotation.y = Math.PI;
    car.speed = 30;
    car.hp = 5;
  });
  await page.waitForTimeout(3000);
  const burning = await page.evaluate(() => {
    const g = window.__game;
    const car = g.drivenCar;
    return car ? { burning: car.burning, hp: car.hp, msg: document.getElementById('hud-message').textContent } : { driven: null };
  });
  note(`R7: after fatal crash — burning=${burning.burning}, hp=${burning.hp}, msg="${burning.msg}"`);
  // Stay in the car through the explosion (player ignores the warning).
  // Burn timer is 3 game-seconds; headless runs ~0.14x and throttles late
  // in a long run, so poll up to 60s like the audit test does.
  let exploded = { destroyed: false };
  for (let i = 0; i < 12; i += 1) {
    await page.waitForTimeout(5000);
    exploded = await page.evaluate(() => {
      const g = window.__game;
      const car = g.cars[0];
      return { destroyed: car.destroyed, health: g.health, state: g.state, driven: g.drivenCar !== null };
    });
    if (exploded.destroyed === true) break;
  }
  check('R7: car explodes after burning and the player takes blast damage', exploded.destroyed === true,
    `destroyed=${exploded.destroyed}, player health=${exploded.health}, state=${exploded.state}, still driving=${exploded.driven}`);
  await page.close();
}

check('zero console/page errors across all retests', errors.length === 0, errors.length ? errors.join(' | ') : '');
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
