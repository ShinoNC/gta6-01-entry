// Player-style playtest for SOLARIS KEYS: play like a real GTA player would.
// Run selected sessions: SESSIONS=A,C,E node tools/player-test.mjs
// Results append to ~/workspace/makefun/gta6-01/player-test-results.log
import { chromium } from '/home/hatch/workspace/tools/pw/node_modules/playwright-core/index.mjs';
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ENTRY = '/home/hatch/workspace/makefun/gta6-01/entry-v1';
const LOG = '/home/hatch/workspace/makefun/gta6-01/player-test-results.log';
const WANT = new Set((process.env.SESSIONS || 'A,B,C,D,E,F,G').split(','));
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
out(`=== RUN ${new Date().toISOString()} sessions=${[...WANT].join(',')} ===`);

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

// ============ SESSION A: first 5 minutes as a new player ============
if (WANT.has('A')) {
  const page = await freshPage();
  await startGame(page);
  const briefingMs = await page.evaluate(() => new Promise((resolve) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      if (!document.getElementById('phone-panel').classList.contains('hidden')) {
        clearInterval(iv);
        resolve(Math.round(performance.now() - t0));
      }
    }, 100);
    setTimeout(() => { clearInterval(iv); resolve(-1); }, 30000);
  }));
  note(`A1: first phone briefing appears ${briefingMs}ms after NEW GAME (player barely has time to look around)`);
  await page.click('#phone-later');
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const car = window.__game.cars[0];
    const p = window.__game.player.group.position;
    p.set(car.position.x + 6, 0, car.position.z);
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  await page.keyboard.up('KeyW');
  const overlap = await page.evaluate(() => {
    const car = window.__game.cars[0];
    const p = window.__game.player.group.position;
    const d = Math.hypot(p.x - car.position.x, p.z - car.position.z);
    return { dist: d.toFixed(1), px: p.x.toFixed(1), pz: p.z.toFixed(1) };
  });
  check('A2: player on foot collides with parked car (not walk through)', Number(overlap.dist) > 1.5, `player-car distance ${overlap.dist}m at (${overlap.px}, ${overlap.pz})`);

  await page.evaluate(() => {
    const car = window.__game.cars[0];
    window.__game.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  const entered = await page.evaluate(() => window.__game.drivenCar !== null);
  check('A3a: F enters starter car', entered);
  const ramResult = await page.evaluate(() => {
    const g = window.__game;
    const target = g.cars.find((c) => c.name === 'PALM RUNNER');
    const car = g.drivenCar;
    car.group.position.set(target.position.x, 0, target.position.z - 14);
    car.heading = 0;
    car.group.rotation.y = 0;
    car.speed = 0;
    return { hpBefore: car.hp };
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(5000);
  await page.keyboard.up('KeyW');
  const ramAfter = await page.evaluate(() => {
    const g = window.__game;
    const target = g.cars.find((c) => c.name === 'PALM RUNNER');
    const car = g.drivenCar;
    const d = Math.hypot(car.position.x - target.position.x, car.position.z - target.position.z);
    return { dist: d.toFixed(1), hp: car.hp, speed: car.speed.toFixed(1), carZ: car.position.z.toFixed(1), tgtZ: target.position.z.toFixed(1) };
  });
  check('A3b: driven car collides with parked car (not pass through)', Number(ramAfter.dist) > 2.5 || Number(ramAfter.hp) < ramResult.hpBefore,
    `gap ${ramAfter.dist}m, hp ${ramAfter.hp} (was ${ramResult.hpBefore}), speed ${ramAfter.speed}, car z=${ramAfter.carZ} vs target z=${ramAfter.tgtZ}`);
  await page.screenshot({ path: '/home/hatch/workspace/makefun/gta6-01/player-a3.png' });

  const crashBefore = await page.evaluate(() => {
    const g = window.__game;
    const car = g.drivenCar;
    car.group.position.set(-26, 0, -100);
    car.heading = Math.PI;
    car.group.rotation.y = Math.PI;
    car.speed = 0;
    car.hp = 100;
    return { hp: car.hp };
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(6000);
  await page.keyboard.up('KeyW');
  const crashAfter = await page.evaluate(() => {
    const g = window.__game;
    const car = g.drivenCar;
    return { hp: car.hp, speed: car.speed.toFixed(1), z: car.position.z.toFixed(1), health: g.health, burning: car.burning };
  });
  check('A4: crashing into a building at speed damages the car', crashAfter.hp < crashBefore.hp, `hp ${crashBefore.hp} -> ${crashAfter.hp}, speed ${crashAfter.speed}, z=${crashAfter.z}, player health ${crashAfter.health}, burning=${crashAfter.burning}`);

  await page.evaluate(() => {
    const g = window.__game;
    const car = g.drivenCar;
    car.group.position.set(0, 0, -150);
    car.heading = Math.PI;
    car.group.rotation.y = Math.PI;
    car.speed = 0;
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(5000);
  await page.keyboard.up('KeyW');
  const edge = await page.evaluate(() => ({ z: window.__game.drivenCar.position.z.toFixed(1), speed: window.__game.drivenCar.speed.toFixed(1) }));
  await page.screenshot({ path: '/home/hatch/workspace/makefun/gta6-01/player-north-edge.png' });
  note(`A5: north edge — car stopped at z=${edge.z} (clamp -162), speed ${edge.speed}. Screenshot player-north-edge.png shows whether there's a visible barrier`);

  await page.evaluate(() => {
    const g = window.__game;
    const car = g.drivenCar;
    car.group.position.set(0, 0, 80);
    car.heading = 0;
    car.group.rotation.y = 0;
    car.speed = 0;
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(5000);
  await page.keyboard.up('KeyW');
  const shore = await page.evaluate(() => ({ z: window.__game.drivenCar.position.z.toFixed(1), speed: window.__game.drivenCar.speed.toFixed(1) }));
  await page.screenshot({ path: '/home/hatch/workspace/makefun/gta6-01/player-shore.png' });
  note(`A6: shoreline — car stopped at z=${shore.z} (clamp 96), speed ${shore.speed}. Screenshot player-shore.png`);
  await page.close();
}

// ============ SESSION B: chaos run ============
if (WANT.has('B')) {
  const page = await freshPage();
  await startGame(page);
  await page.waitForSelector('#phone-panel:not(.hidden)', { timeout: 45000 });
  await page.click('#phone-accept');
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const target = window.__game.missions.target;
    window.__game.player.group.position.set(target.x, 0, target.z);
  });
  await page.waitForTimeout(3000);
  const m1 = await page.evaluate(() => ({ done: window.__game.missions.doneCount(), pistol: window.__game.combat.ammoForHud()[1].locked === false }));
  check('B0: mission 1 done, pistol unlocked', m1.done === 1 && m1.pistol, `done=${m1.done} pistolUnlocked=${m1.pistol}`);
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__game.wanted.setStars(3); });
  await page.waitForTimeout(3000);
  const hpStart = await page.evaluate(() => window.__game.health);
  const units3 = await page.evaluate(() => window.__game.police.units(window.__game.player.position).length);
  await page.waitForTimeout(15000);
  const hpEnd = await page.evaluate(() => ({ health: window.__game.health, state: window.__game.state, stars: window.__game.wanted.stars }));
  note(`B1: at 3 stars in a car, ${units3} police units; health ${hpStart} -> ${hpEnd.health} over ~15s real time, state=${hpEnd.state}, stars=${hpEnd.stars}`);
  check('B1: 3-star police shooting does not insta-kill a stationary player', hpEnd.state !== 'down', `state=${hpEnd.state} health=${hpEnd.health}`);

  await page.waitForTimeout(3000);
  const count3 = await page.evaluate(() => ({
    pursuit: window.__game.police.pursuit.length,
    roadblock: window.__game.police.roadblock.length,
    heli: window.__game.police.helicopter !== null,
  }));
  await page.evaluate(() => { window.__game.wanted.setStars(5); });
  await page.waitForTimeout(3000);
  const count5 = await page.evaluate(() => ({
    pursuit: window.__game.police.pursuit.length,
    roadblock: window.__game.police.roadblock.length,
    heli: window.__game.police.helicopter !== null,
  }));
  check('B2: 5 stars brings a bigger police response than 3 stars',
    count5.pursuit > count3.pursuit || count5.roadblock > count3.roadblock,
    `3★: ${count3.pursuit} pursuit + ${count3.roadblock} roadblock + heli=${count3.heli}; 5★: ${count5.pursuit} pursuit + ${count5.roadblock} roadblock + heli=${count5.heli}`);
  await page.evaluate(() => { window.__game.wanted.setStars(0); });
  await page.waitForTimeout(4000);

  await page.evaluate(() => {
    const g = window.__game;
    const npc = g.traffic.cars[0];
    const car = g.drivenCar;
    car.hp = 100;
    npc.car.hp = 100;
    car.group.position.set(npc.car.position.x, 0, npc.car.position.z - 16);
    car.heading = 0;
    car.group.rotation.y = 0;
    car.speed = 0;
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(5000);
  await page.keyboard.up('KeyW');
  const ramTrafficAfter = await page.evaluate(() => {
    const g = window.__game;
    return { myHp: g.drivenCar.hp, npcHp: g.traffic.cars[0].car.hp, speed: g.drivenCar.speed.toFixed(1) };
  });
  check('B3: ramming a traffic car damages cars (both take a hit)', ramTrafficAfter.myHp < 100 || ramTrafficAfter.npcHp < 100,
    `my hp=${ramTrafficAfter.myHp}, traffic hp=${ramTrafficAfter.npcHp}, speed=${ramTrafficAfter.speed}`);

  await page.evaluate(() => { window.__game.wanted.setStars(1); });
  await page.waitForTimeout(5000);
  const ghost = await page.evaluate(() => {
    const g = window.__game;
    const unit = g.police.pursuit[0];
    if (!unit) return { none: true };
    const car = g.drivenCar;
    car.group.position.set(unit.car.position.x, 0, unit.car.position.z - 8);
    car.heading = 0;
    car.group.rotation.y = 0;
    car.speed = 0;
    return { policeX: unit.car.position.x.toFixed(1), policeZ: unit.car.position.z.toFixed(1) };
  });
  if (!ghost.none) {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(4000);
    await page.keyboard.up('KeyW');
    const ghostAfter = await page.evaluate(() => {
      const g = window.__game;
      const unit = g.police.pursuit[0];
      if (!unit) return { gone: true };
      const car = g.drivenCar;
      const d = Math.hypot(car.position.x - unit.car.position.x, car.position.z - unit.car.position.z);
      return { dist: d.toFixed(1), myZ: car.position.z.toFixed(1), policeZ: unit.car.position.z.toFixed(1), speed: car.speed.toFixed(1) };
    });
    check('B4: driven car collides with pursuit police car (not pass through)', ghostAfter.gone || Number(ghostAfter.dist) > 2.5,
      ghostAfter.gone ? 'police unit despawned mid-test' : `gap ${ghostAfter.dist}m, my z=${ghostAfter.myZ} vs police z=${ghostAfter.policeZ}, speed=${ghostAfter.speed}`);
  } else {
    note('B4: skipped — no pursuit unit spawned');
  }
  await page.close();
}

// ============ SESSION C: Pay'n'Spray auto-charge ============
if (WANT.has('C')) {
  const page = await freshPage();
  await startGame(page);
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  const sprayBefore = await page.evaluate(() => {
    const g = window.__game;
    g.setMoney(1000);
    g.wanted.setStars(1);
    const car = g.drivenCar;
    car.hp = 95;
    car.group.position.set(104, 0, -70);
    car.heading = 0;
    car.group.rotation.y = 0;
    car.speed = 0;
    return { money: g.money, hp: car.hp, stars: g.wanted.stars };
  });
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(4000);
  await page.keyboard.up('KeyW');
  const sprayAfter = await page.evaluate(() => ({
    money: window.__game.money, hp: window.__game.drivenCar.hp, stars: window.__game.wanted.stars,
    msg: document.getElementById('hud-message').textContent,
  }));
  check('C1: Pay\'n\'Spray does NOT auto-charge $200 for a 5-HP scratch just by driving through',
    sprayAfter.money === sprayBefore.money,
    `money $${sprayBefore.money} -> $${sprayAfter.money}, hp ${sprayBefore.hp} -> ${sprayAfter.hp}, stars ${sprayBefore.stars} -> ${sprayAfter.stars}, msg="${sprayAfter.msg}"`);
  await page.close();
}

// ============ SESSION D: save scummer + mission soft-lock ============
if (WANT.has('D')) {
  const page = await freshPage();
  await startGame(page);
  await page.waitForSelector('#phone-panel:not(.hidden)', { timeout: 45000 });
  await page.click('#phone-accept');
  await page.waitForTimeout(400);
  const softlock = await page.evaluate(() => {
    const g = window.__game;
    g.applySave({ money: 1250, rep: 0, missionsDone: 0, weaponsOwned: ['fists'], tapesCollected: 0, playerX: 0, playerZ: 0 });
    const statuses = g.missions.statusList().map((m) => `${m.number}:${m.status}`).join(' ');
    return { curIdx: g.missions.curIdx, statuses };
  });
  note(`D1: after loading an older save mid-mission — curIdx=${softlock.curIdx}, statuses: ${softlock.statuses}`);
  await page.keyboard.press('KeyM');
  await page.waitForTimeout(500);
  const acceptVisible = await page.evaluate(() => [...document.querySelectorAll('.mission-accept')].map((b) => b.dataset.mission));
  note(`D1: ACCEPT buttons visible in mission list while a mission is active: [${acceptVisible.join(', ')}]`);
  if (acceptVisible.length > 0) {
    await page.evaluate(() => document.querySelector('.mission-accept').click());
    await page.waitForTimeout(400);
    const after = await page.evaluate(() => ({
      curIdx: window.__game.missions.curIdx,
      statuses: window.__game.missions.statusList().map((m) => `${m.number}:${m.status}`).join(' '),
    }));
    const activeCount = after.statuses.split(' ').filter((s) => s.endsWith(':active')).length;
    check('D1: accepting a mission while one is active does not orphan the first', activeCount <= 1,
      `curIdx=${after.curIdx}, statuses: ${after.statuses}`);
  } else {
    check('D1: no ACCEPT button while a mission is active (no orphan possible)', true, 'no accept buttons shown');
  }
  await page.close();
}

// ============ SESSION E: button masher + edge cases ============
if (WANT.has('E')) {
  const page = await freshPage();
  await startGame(page);
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(300);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(3000);
  const speedBefore = await page.evaluate(() => window.__game.drivenCar.speed);
  await page.keyboard.up('KeyW');
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(500);
  const exitState = await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars[0];
    return { carSpeed: car.speed, playerVisible: g.player.group.visible, state: g.state };
  });
  note(`E1: exit moving car at ${speedBefore.toFixed(1)} m/s — car speed after exit: ${exitState.carSpeed} (GTA: car keeps rolling)`);
  check('E1: exiting a moving car does not crash or soft-lock', exitState.state === 'play' && exitState.playerVisible === true);

  await page.waitForSelector('#phone-panel:not(.hidden)', { timeout: 45000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const paused = await page.evaluate(() => window.__game.state);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const resumed = await page.evaluate(() => window.__game.state);
  check('E2: pause/resume during phone briefing works', paused === 'pause' && resumed === 'play', `paused=${paused} resumed=${resumed}`);

  const keys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'KeyF', 'KeyM', 'KeyR', 'KeyH', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Escape'];
  for (let i = 0; i < 30; i += 1) {
    await page.keyboard.press(keys[i % keys.length]);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(1000);
  const mashState = await page.evaluate(() => ({ state: window.__game.state }));
  check('E3: 30 random key presses do not crash or soft-lock', ['play', 'pause'].includes(mashState.state), `state=${mashState.state}`);
  await page.close();
}

// ============ SESSION F: die / get busted DURING a mission ============
if (WANT.has('F')) {
  const page = await freshPage();
  await startGame(page);
  await page.waitForSelector('#phone-panel:not(.hidden)', { timeout: 45000 });
  await page.click('#phone-accept');
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__game.damagePlayer(150); });
  await page.waitForTimeout(1000);
  const down = await page.evaluate(() => ({
    state: window.__game.state,
    title: document.getElementById('down-title').textContent,
    missionStatus: window.__game.missions.statusList()[0].status,
    curIdx: window.__game.missions.curIdx,
  }));
  check('F1: dying during a mission shows WASTED and fails the mission cleanly',
    down.state === 'down' && down.title === 'WASTED' && down.curIdx === -1 && down.missionStatus === 'pending',
    `state=${down.state} title=${down.title} mission=${down.missionStatus} curIdx=${down.curIdx}`);
  if (down.state === 'down') await page.click('#down-button');
  await page.waitForTimeout(500);
  const recovered = await page.evaluate(() => ({ state: window.__game.state, health: window.__game.health }));
  check('F1: CONTINUE after WASTED returns to play with full health', recovered.state === 'play' && recovered.health === 100,
    `state=${recovered.state} health=${recovered.health}`);
  const reoffered = await page.evaluate(() => new Promise((resolve) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      if (!document.getElementById('phone-panel').classList.contains('hidden')) {
        clearInterval(iv);
        resolve(Math.round(performance.now() - t0));
      }
    }, 100);
    setTimeout(() => { clearInterval(iv); resolve(-1); }, 30000);
  }));
  check('F2: failed mission is re-offered after ~5s', reoffered > 0 && reoffered < 15000, `re-offered after ${reoffered}ms`);
  await page.close();
}

// ============ SESSION G: helicopter + armour ============
if (WANT.has('G')) {
  const page = await freshPage();
  await startGame(page);
  await page.evaluate(() => { window.__game.wanted.setStars(3); });
  await page.waitForTimeout(4000);
  const heli = await page.evaluate(() => {
    const g = window.__game;
    const h = g.police.helicopter;
    return { exists: h !== null, pos: h ? { x: h.group.position.x.toFixed(0), z: h.group.position.z.toFixed(0) } : null };
  });
  note(`G1: helicopter exists at 3 stars: ${heli.exists} at (${heli.pos?.x}, ${heli.pos?.z}). It is NOT in combatTargets (code check) — player cannot shoot it down.`);
  check('G1: helicopter can be shot down (GTA expectation)', false, 'heli not a combat target — invulnerable');
  const armour = await page.evaluate(() => document.getElementById('hud-armour-fill').style.width);
  note(`G2: armour bar width = "${armour}" — no armour mechanic exists in the game (bar is decorative, always empty)`);
  await page.close();
}

check('zero console/page errors across all sessions', errors.length === 0, errors.length ? errors.join(' | ') : '');
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
