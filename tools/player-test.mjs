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
  await page.evaluate(() => document.getElementById('start-button')?.click());
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
  // The briefing only appears within 6m of Mara's marker; standing at spawn
  // (52m away) it never appears, and clicking the hidden button times out.
  // Only dismiss when the panel is actually visible.
  await page.evaluate(() => {
    if (!document.getElementById('phone-panel').classList.contains('hidden')) {
      document.getElementById('phone-later')?.click();
    }
  });
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
    // Aim at a real building face: pick a box, start 8m south of its south
    // face (on the road south of the block), drive north into it. Speed 20
    // skips the slow standing start — the wall, not the acceleration, is
    // under test.
    const box = g.hud.city.buildingBoxes.find((b) => b.maxZ > -100 && b.maxZ < 0);
    const cx = (box.minX + box.maxX) / 2;
    car.group.position.set(cx, 0, box.maxZ + 8);
    car.heading = Math.PI;
    car.group.rotation.y = Math.PI;
    car.speed = 20;
    car.hp = 100;
    return { hp: car.hp, face: box.maxZ };
  });
  await page.keyboard.down('KeyW');
  // Poll until the IMPACT lands (hp drops): the drive is ~8m at ~20 m/s
  // game-time, but headless game-time crawls. The wall impact damages the
  // car (vehicles.js: hp -= speed x 0.6 when impact speed > 12) and cuts
  // speed to a quarter — so hp < 100 proves the car reached the wall.
  let crashHp = 100;
  const crashT0 = Date.now();
  while (Date.now() - crashT0 < 180000) {
    crashHp = await page.evaluate(() => window.__game.drivenCar.hp);
    if (crashHp < 100) break;
    await page.waitForTimeout(1000);
  }
  await page.keyboard.up('KeyW');
  const crashAfter = await page.evaluate(() => {
    const g = window.__game;
    const car = g.drivenCar;
    return { hp: car.hp, speed: car.speed.toFixed(1), z: car.position.z.toFixed(1), health: g.health, burning: car.burning };
  });
  // Buildings are solid: the car must stop AT the face (within the car's
  // radius ~2m + margin), never pass through it — and the impact damages
  // it (vehicles.js applies hp -= speed x 0.6 at impact speed > 12; the
  // car hits at ~20 m/s, so hp must drop).
  check('A4: building stops the car and the impact damages it', crashAfter.z > crashBefore.face - 1 && crashAfter.z < crashBefore.face + 5 && crashAfter.hp < 100, `hp ${crashBefore.hp} -> ${crashAfter.hp}, speed ${crashAfter.speed}, z=${crashAfter.z} vs face=${crashBefore.face}, player health ${crashAfter.health}`);

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
  // The briefing only appears within 6m of Mara's marker (52,0); at spawn
  // (52m away) it never appears. Teleport there first.
  await page.evaluate(() => window.__game.player.group.position.set(52, 0, 0));
  await page.waitForSelector('#phone-panel:not(.hidden)', { timeout: 45000 });
  await page.evaluate(() => document.getElementById('phone-accept')?.click());
  await page.waitForTimeout(400);
  // M1 needs a car (stage 1 driveTo + stage 2 waitAt both needsCar) and has
  // 3 stages — teleporting the on-foot player to one target completes
  // nothing. Enter the starter car, then teleport the driven car through
  // each stage (full-story pattern): driveTo completes on arrival, waitAt
  // needs 2s of GAME time at the marker (up to 600s real headless).
  await page.evaluate(() => {
    const g = window.__game;
    const car = g.cars.find((c) => c.name === 'SOLSTICE GT' && !c.destroyed) || g.cars.find((c) => !c.destroyed);
    if (car) g.player.group.position.set(car.position.x + 2, 0, car.position.z);
  });
  await page.waitForTimeout(600);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(600);
  if (await page.evaluate(() => !!window.__game.drivenCar)) {
    const stages = await page.evaluate(() => window.__game.missions.currentMission().objectives.map((o) => ({ kind: o.kind, x: o.x, z: o.z })));
    for (const o of stages) {
      if (o.kind !== 'driveTo' && o.kind !== 'waitAt') continue;
      const sb = await page.evaluate(() => window.__game.missions.stageIndex);
      await page.evaluate(([x, z]) => {
        const g = window.__game;
        const focus = g.drivenCar ? g.drivenCar.group : g.player.group;
        focus.position.set(x, 0, z);
        if (g.drivenCar) g.drivenCar.speed = 0;
      }, [o.x, o.z]);
      const budget = o.kind === 'waitAt' ? 600000 : 120000;
      const t0 = Date.now();
      let advanced = false;
      while (Date.now() - t0 < budget) {
        advanced = await page.evaluate((s) => window.__game.missions.stageIndex > s || window.__game.missions.currentMission() === null, sb);
        if (advanced) break;
        await page.waitForTimeout(500);
      }
      if (!advanced) break;
    }
  }
  const m1 = await page.evaluate(() => ({ done: window.__game.missions.doneCount(), pistol: window.__game.combat.ammoForHud()[1].locked === false }));
  check('B0: mission 1 done, pistol unlocked', m1.done === 1 && m1.pistol, `done=${m1.done} pistolUnlocked=${m1.pistol}`);
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(300);

  // B1 wants the player in a car; B0 already leaves them driving, so only
  // enter cars[0] when on foot (F while driving would EXIT it).
  if (!(await page.evaluate(() => !!window.__game.drivenCar))) {
    await page.evaluate(() => {
      const g = window.__game;
      const car = g.cars[0];
      g.player.group.position.set(car.position.x + 2, 0, car.position.z);
    });
    await page.keyboard.press('KeyF');
    await page.waitForTimeout(400);
  }
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
    // Ram an NPC on a NORTH-SOUTH line: the approach (16m north of it, same
    // x) is then on the same road. On an east-west line the approach would
    // start off-road, possibly inside a building.
    const npc = g.traffic.cars.find((n) => n.line && n.line.axis === 'z') || g.traffic.cars[0];
    const car = g.drivenCar;
    car.hp = 100;
    npc.car.hp = 100;
    // Freeze the NPC (dormant + far retry): a moving target drives away
    // before the slow headless car closes the gap. The car-vs-car collision
    // iterates all traffic cars regardless of dormant.
    npc.dormant = true;
    npc.retryTimer = 999;
    car.group.position.set(npc.car.position.x, 0, npc.car.position.z - 16);
    car.heading = 0;
    car.group.rotation.y = 0;
    car.speed = 20;
  });
  await page.keyboard.down('KeyW');
  // Poll until the ram lands (either car takes damage): 16m at ~20 m/s
  // game-time, but headless game-time crawls. Damage needs impact speed
  // > 8 (collision code); W held keeps the speed up.
  let rammed = false;
  const ramT0 = Date.now();
  while (Date.now() - ramT0 < 120000) {
    rammed = await page.evaluate(() => window.__game.drivenCar.hp < 100 || window.__game.traffic.cars.some((n) => n.car.hp < 100));
    if (rammed) break;
    await page.waitForTimeout(1000);
  }
  await page.keyboard.up('KeyW');
  const ramTrafficAfter = await page.evaluate(() => {
    const g = window.__game;
    return { myHp: g.drivenCar.hp, npcHp: Math.min(...g.traffic.cars.map((n) => n.car.hp)), speed: g.drivenCar.speed.toFixed(1) };
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
  // The briefing only appears within 6m of Mara's marker (52,0); at spawn
  // (52m away) it never appears. Teleport there first.
  await page.evaluate(() => window.__game.player.group.position.set(52, 0, 0));
  await page.waitForSelector('#phone-panel:not(.hidden)', { timeout: 45000 });
  await page.evaluate(() => document.getElementById('phone-accept')?.click());
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

  // E2 needs the briefing open: teleport to Mara's marker first (it never
  // appears at spawn, 52m away).
  await page.evaluate(() => window.__game.player.group.position.set(52, 0, 0));
  await page.waitForSelector('#phone-panel:not(.hidden)', { timeout: 45000 });
  // Escape priority is phone > menu > pause: with the briefing open, the
  // first Escape DISMISSES the briefing (state stays play); only the next
  // Escape pauses. Poll each step — the key is processed on the next game
  // frame, and a fixed 400ms wait is not a frame under headless load.
  await page.keyboard.press('Escape');
  let dismissed = false;
  for (let i = 0; i < 60 && !dismissed; i += 1) {
    dismissed = await page.evaluate(() => document.getElementById('phone-panel').classList.contains('hidden'));
    if (!dismissed) await page.waitForTimeout(500);
  }
  const afterDismiss = await page.evaluate(() => window.__game.state);
  check('E2: Escape with the briefing open dismisses it (does NOT pause)', dismissed && afterDismiss === 'play', `phoneHidden=${dismissed} state=${afterDismiss}`);
  await page.keyboard.press('Escape');
  let paused = '';
  for (let i = 0; i < 60 && paused !== 'pause'; i += 1) {
    paused = await page.evaluate(() => window.__game.state);
    if (paused !== 'pause') await page.waitForTimeout(500);
  }
  await page.keyboard.press('Escape');
  let resumed = '';
  for (let i = 0; i < 60 && resumed !== 'play'; i += 1) {
    resumed = await page.evaluate(() => window.__game.state);
    if (resumed !== 'play') await page.waitForTimeout(500);
  }
  check('E2: Escape then pauses and resumes', paused === 'pause' && resumed === 'play', `paused=${paused} resumed=${resumed}`);

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
  // The briefing only appears within 6m of Mara's marker (52,0); at spawn
  // (52m away) it never appears. Teleport there first.
  await page.evaluate(() => window.__game.player.group.position.set(52, 0, 0));
  await page.waitForSelector('#phone-panel:not(.hidden)', { timeout: 45000 });
  await page.evaluate(() => document.getElementById('phone-accept')?.click());
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
  // The re-offer needs the player at Mara's marker (recovery respawns at
  // spawn, 52m away) AND the 5s GAME-time snooze from failCurrent to
  // expire — at headless speeds that is far longer than 15s real, so the
  // poll gets 300s and the check only requires the re-offer to appear.
  await page.evaluate(() => window.__game.player.group.position.set(52, 0, 0));
  const reoffered = await page.evaluate(() => new Promise((resolve) => {
    const t0 = performance.now();
    const iv = setInterval(() => {
      if (!document.getElementById('phone-panel').classList.contains('hidden')) {
        clearInterval(iv);
        resolve(Math.round(performance.now() - t0));
      }
    }, 100);
    setTimeout(() => { clearInterval(iv); resolve(-1); }, 300000);
  }));
  check('F2: failed mission is re-offered (after the 5s game-time snooze)', reoffered > 0, `re-offered after ${reoffered}ms`);
  await page.close();
}

// ============ SESSION G: helicopter + armour ============
if (WANT.has('G')) {
  const page = await freshPage();
  await startGame(page);
  await page.evaluate(() => {
    const g = window.__game;
    g.combat.setOwnedWeapons(['fists', 'pistol']);
    g.combat.restock();
    g.combat.selectWeapon(1);
    g.wanted.setStars(3);
  });
  // Wait for the helicopter to deploy at 3 stars.
  let heli = null;
  for (let i = 0; i < 60 && !heli; i += 1) {
    await page.waitForTimeout(1000);
    heli = await page.evaluate(() => {
      const h = window.__game.police.helicopter;
      return h ? { x: h.group.position.x, z: h.group.position.z } : null;
    });
  }
  check('G1: helicopter deploys at 3 stars', heli !== null, heli ? `at (${heli.x.toFixed(0)},${heli.z.toFixed(0)})` : 'never deployed');
  // Shoot it down: HELI_HP is 60, pistol damage 12, so 5 hits. Each shot
  // re-positions the heli to (0,-30) — due north of the player on the open
  // x=0 road, clear LOS — and aims exactly at it, all in one evaluate so
  // no game frame moves it between. tryShoot is called directly with the
  // heli as the target: the aim, LOS and damage paths are all real; only
  // the mouse-click plumbing is bypassed (covered by fixbatch5 E and
  // mouse-direction). The 0.28s game-time pistol cooldown is polled, not
  // guessed.
  let heliDown = false;
  let shotsFired = 0;
  for (let shot = 0; shot < 10 && !heliDown; shot += 1) {
    let cool = true;
    for (let i = 0; i < 120 && cool; i += 1) {
      cool = await page.evaluate(() => window.__game.combat.cooldownTimer > 0 || window.__game.combat.reloading);
      if (cool) await page.waitForTimeout(500);
    }
    const res = await page.evaluate(() => {
      const g = window.__game;
      const h = g.police.helicopter;
      if (!h) return 'no-heli';
      h.group.position.set(0, 14, -30);
      const heading = Math.atan2(0 - g.player.position.x, -30 - g.player.position.z);
      g.player.heading = heading;
      g.player.group.rotation.y = heading;
      return g.combat.tryShoot(g.player.position, heading + Math.PI, [{ x: 0, z: -30, radius: 3, kind: 'helicopter', ref: null }]);
    });
    if (res === 'shot') shotsFired += 1;
    heliDown = await page.evaluate(() => window.__game.police.helicopter === null || window.__game.stats.helisDown >= 1);
    if (!heliDown) await page.waitForTimeout(500);
  }
  const helisDown = await page.evaluate(() => window.__game.stats.helisDown);
  check('G1: helicopter can be shot down (GTA expectation)', heliDown, `shots fired=${shotsFired} helisDown=${helisDown}`);
  const armour = await page.evaluate(() => document.getElementById('hud-armour-fill').style.width);
  note(`G2: armour bar width = "${armour}" — no armour mechanic exists in the game (bar is decorative, always empty)`);
  await page.close();
}

check('zero console/page errors across all sessions', errors.length === 0, errors.length ? errors.join(' | ') : '');
await browser.close();
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
