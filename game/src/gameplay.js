// Moment-to-moment gameplay: getting in and out of cars (including
// carjacking and police-car theft), hurting the player and cars, the
// WASTED/BUSTED run end, burning cars, and the target list combat shoots
// at. Everything here reads the shared context; the per-frame update loop
// in the entry file calls into it.
import { G, $ } from './context.js';
import { ENTER_CAR_RANGE } from './tuning.js';
import { HOSPITAL_SPAWN } from './city.js';
import { addWalker } from './walkers.js';
import { recordCrime } from './helpers.js';
import { applyGarageToCar, closeMissionScreen, closeEmpireScreen, closeMapScreen, closeGarageScreen } from './menus.js';

function nearestCar(position, range = ENTER_CAR_RANGE) {
  let best = null;
  let bestDist = range;
  const consider = (car) => {
    if (car.destroyed) return;
    // Distance to the car's nearest point, not its centre: a car is 4.2m
    // long, so a player standing at the bumper is ~2.1m closer than the
    // centre distance says. The prompt and F must match what the player
    // sees — a car that looks 1-2m away must be grabbable. (Live check #6:
    // F said "No car nearby" at the M1 pickup with cars visibly next to
    // the player; centre distance was the gap between seeing and grabbing.)
    const dx = position.x - car.position.x;
    const dz = position.z - car.position.z;
    const sin = Math.sin(car.heading);
    const cos = Math.cos(car.heading);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    // Per-vehicle extents: a bus is 8m long, a bike barely 2m — the
    // grab box must match the vehicle, not a sedan-shaped guess.
    const hw = car.halfWidth || 0.95;
    const hl = car.halfLength || 2.1;
    const cx = Math.max(-hw, Math.min(hw, lx));
    const cz = Math.max(-hl, Math.min(hl, lz));
    const dist = Math.hypot(lx - cx, lz - cz);
    if (dist < bestDist) {
      bestDist = dist;
      best = car;
    }
  };
  for (const car of G.cars) consider(car);
  for (const npc of G.traffic.cars) consider(npc.car);
  for (const unit of [...G.police.pursuit, ...G.police.roadblock, ...G.police.patrol]) consider(unit.car);
  return best;
}

function enterCar(car) {
  G.drivenCar = car;
  car.driven = true;
  G.chaseCamera.snapTo(car.heading);
  applyGarageToCar(car);
  G.player.jumpY = 0;
  G.player.jumpV = 0;
  G.player.group.visible = false;
  // On a bike the rider stays visible, seated — the traffic rider (if
  // any) gets out and flees on foot, and the player takes their place.
  if (car.style === 'bike') {
    G.player.setBikePose(true);
    G.player.group.visible = true;
  }
  const npcIndex = G.traffic.cars.findIndex((npc) => npc.car === car);
  let wasCarjacking = false;
  if (npcIndex >= 0) {
    wasCarjacking = true;
    const ejected = G.traffic.ejectOccupant(G.traffic.cars[npcIndex]);
    if (ejected) {
      const cry = car.style === 'bike' ? 'Hey! My bike!' : 'Hey! My car!';
      addWalker(ejected.group, 'flee', cry, ejected.walker);
    }
    G.traffic.cars.splice(npcIndex, 1);
    // The replacement NPC spawns next frame, not this one: buildNpc
    // builds a full car + driver synchronously, and doing it in the
    // same frame as the car-entry camera swing caused a visible hitch.
    setTimeout(() => { G.traffic.cars.push(G.traffic.buildNpc(G.scene, G.rng)); }, 0);
    G.cars.push(car);
    car.speed = 0;
  }
  // Stealing a police car: the officer gets out and chases on foot
  // instead of vanishing (the force spawns a replacement), keep the car
  // — lightbar and all — and yank it to a stop.
  let wasPolice = false;
  for (const list of [G.police.pursuit, G.police.roadblock, G.police.patrol]) {
    const unitIndex = list.findIndex((unit) => unit.car === car);
    if (unitIndex < 0) continue;
    if (list[unitIndex].officer) {
      const officer = list[unitIndex].officer;
      list[unitIndex].officer = null;
      addWalker(officer.group, 'chase', null, officer);
    }
    list.splice(unitIndex, 1);
    G.cars.push(car);
    car.speed = 0;
    wasPolice = true;
    break;
  }
  if (!car.owned) {
    car.owned = true;
    G.stats.carsStolen = G.stats.carsStolen + 1;
    // GTA-style: only a carjacking (taking a car WITH its driver) or
    // stealing a police car earns a star — and only if witnessed (a cop
    // with line of sight, or a pedestrian within 20m). Taking a parked
    // car is free: no victim, no call, just the message.
    const seen = wasPolice || G.police.canSeePlayer(G.player.position) || G.pedestrians.peds.some((ped) => {
      if (ped.knockedTimer > 0) return false;
      const px = ped.mesh.group.position.x - G.player.position.x;
      const pz = ped.mesh.group.position.z - G.player.position.z;
      return Math.hypot(px, pz) < 20;
    });
    const crime = (wasCarjacking || wasPolice) && seen ? G.wanted.commitCrime('steal') : '';
    if (crime) recordCrime();
    let msg = `VEHICLE STOLEN: ${car.name}`;
    if (crime) {
      msg += ` — ${crime}`;
      if (!wasPolice) msg += ' — witness called it in';
    }
    G.hud.showMessage(msg, 3);
  } else {
    G.hud.showMessage(`ENTERED ${car.name} — W to drive, S to brake`);
  }
}

function exitCar() {
  const car = G.drivenCar;
  G.drivenCar = null;
  car.driven = false;
  if (car.style === 'bike') G.player.setBikePose(false);
  // Bailing at speed does NOT stop the car dead: it rolls on with its
  // momentum (a non-driven car with speed keeps updating). The player
  // steps out to the SIDE, not in front/behind, and the just-exited car
  // cannot hit them for 1s — the old speed = 0 was only there because
  // the 2.5m spawn sat inside the 2.6m hit range.
  car._exitImmuneUntil = G.elapsed + 1;
  const sideX = car.position.x + Math.cos(car.heading) * 2.5;
  const sideZ = car.position.z - Math.sin(car.heading) * 2.5;
  G.player.group.position.set(sideX, 0, sideZ);
  G.player.group.visible = true;
  G.hud.showMessage('ON FOOT — WASD to walk, F near a car to drive');
}

function damagePlayer(amount) {
  if (G.state !== 'play') return;
  const absorbed = Math.min(G.armour, amount);
  G.armour = G.armour - absorbed;
  G.health = G.health - (amount - absorbed);
  G.lastHurtAt = G.elapsed;
  if (G.health <= 0) endRun('WASTED');
}

function endRun(kind) {
  if (G.state !== 'play') return;
  G.state = 'down';
  G.hud.hideBriefing();
  G.phoneVisible = false;
  if (G.missionOpen) closeMissionScreen();
  if (G.empireOpen) closeEmpireScreen();
  if (G.mapOpen) closeMapScreen();
  if (G.garageOpen) closeGarageScreen();
  G.dialogue.el.classList.add('hidden');
  G.dialogue.until = 0;
  $('hud-message').classList.remove('visible');
  $('hud-police').classList.add('hidden');
  const fine = Math.floor(G.money * 0.1);
  G.money = G.money - fine;
  G.missions.failCurrent();
  G.wanted.setStars(0);
  G.police.clearAll();
  G.reachedFive = false;
  G.health = 100;
  G.arrestTimer = 0;
  if (G.drivenCar) {
    G.drivenCar.driven = false;
    G.drivenCar.speed = 0;
    G.drivenCar = null;
  }
  G.player.group.visible = true;
  G.player.jumpY = 0;
  G.player.jumpV = 0;
  const wasted = kind === 'WASTED';
  const respawnX = wasted ? HOSPITAL_SPAWN.x : -104;
  const respawnZ = wasted ? HOSPITAL_SPAWN.z : -104;
  G.player.group.position.set(respawnX, 0, respawnZ);
  G.player.downTimer = 0;
  G.player.group.rotation.x = 0;
  $('down-title').textContent = kind;
  $('down-sub').textContent = wasted ? `Hospital bill $${fine.toLocaleString('en-US')}` : `Fine $${fine.toLocaleString('en-US')}`;
  G.hud.hideMessage();
  $('down-screen').classList.remove('hidden');
}

function damageCar(car, amount) {
  if (!car || car.hp <= 0 || car.name === 'SUNSET COUPE') return;
  car.hp = car.hp - amount;
  if (car.hp <= 0 && !car.burning) {
    car.burning = true;
    car.burnTimer = 3;
  }
}

function updateBurning(car, dt) {
  if (car.destroyed) return;
  if (!car.burning) {
    if (car.hp < 30 && car.hp > 0 && Math.random() < dt * 2) G.effects.puffSmoke(car.position.x, 1, car.position.z);
    return;
  }
  if (car.driven && !car.warned) {
    car.warned = true;
    G.hud.showMessage(`${car.name} IS ON FIRE — get out!`, 3);
  }
  car.burnTimer = car.burnTimer - dt;
  G.effects.puffSmoke(car.position.x, 1.2, car.position.z);
  if (Math.random() < dt * 6) G.effects.burstSparks(car.position.x, 1, car.position.z, 4);
  if (car.burnTimer > 0) return;
  car.burning = false;
  car.destroyed = true;
  G.effects.burstSparks(car.position.x, 1, car.position.z, 24);
  G.effects.puffSmoke(car.position.x, 1.5, car.position.z, 8);
  G.audio.gunshot();
  if (car.driven) exitCar();
  const playerDist = Math.hypot(G.player.position.x - car.position.x, G.player.position.z - car.position.z);
  if (playerDist < 9) damagePlayer(70);
  G.scene.remove(car.group);
  const ni = G.traffic.cars.findIndex((npc) => npc.car === car);
  if (ni >= 0) {
    G.traffic.cars.splice(ni, 1);
    G.traffic.cars.push(G.traffic.buildNpc(G.scene, G.rng));
  }
}

function combatTargets() {
  const targets = [];
  const addPerson = (x, z, ref) => targets.push({ x, z, radius: 0.9, kind: 'pedestrian', ref });
  for (const ped of G.pedestrians.peds) {
    if (ped.knockedTimer > 0) continue;
    addPerson(ped.mesh.group.position.x, ped.mesh.group.position.z, ped);
  }
  // Gang members are hittable by punch and gunshot like peds; onHitPedestrian
  // tells them apart by ped.gang.
  for (const m of G.gangs.members) {
    if (m.dormant || m.knockedTimer > 0) continue;
    addPerson(m.mesh.group.position.x, m.mesh.group.position.z, m);
  }
  // Beachgoers and lifeguards are hittable like peds; onHitPedestrian
  // tells them apart by ped.beach.
  for (const person of G.beachgoers.people) {
    if (person.state === 'dormant' || person.knockedTimer > 0) continue;
    addPerson(person.mesh.group.position.x, person.mesh.group.position.z, person);
  }
  for (const lg of G.beachgoers.lifeguards) {
    if (lg.knockedTimer > 0) continue;
    addPerson(lg.group.position.x, lg.group.position.z, { beach: true, lifeguard: lg });
  }
  const carTarget = (car, kind) => {
    if (car.destroyed || car === G.drivenCar) return;
    targets.push({ x: car.position.x, z: car.position.z, radius: 2.2, kind, ref: car });
  };
  for (const car of G.cars) carTarget(car, 'car');
  for (const npc of G.traffic.cars) carTarget(npc.car, 'car');
  for (const unit of [...G.police.pursuit, ...G.police.roadblock, ...G.police.patrol]) carTarget(unit.car, 'police');
  if (G.robbery.active && !G.robbery.getaway.stopped) {
    const getaway = G.robbery.getaway.car.position;
    targets.push({ x: getaway.x, z: getaway.z, radius: 2.2, kind: 'getaway', ref: G.robbery.getaway });
  }
  if (G.police.helicopter) {
    const hp = G.police.helicopter.group.position;
    targets.push({ x: hp.x, z: hp.z, radius: 3, kind: 'helicopter', ref: null });
  }
  return targets;
}

export {
  nearestCar, enterCar, exitCar, damagePlayer, endRun, damageCar,
  updateBurning, combatTargets,
};
