// Save snapshots: what a slot stores (money, rep, progress, look, the
// driven car, the active mission, businesses, stats, garage) and how a
// load re-applies it. The driven car survives a reload — a parked car
// with the same name is teleported to the saved spot, a traffic or
// police car is recreated — and the player is put back in it.
import { G } from './context.js';
import { CLOCK_START_MINUTES } from './tuning.js';
import { MISSIONS_IN_STORY } from './missions.js';
import { freshStats } from './business.js';
import { createCar, createBike } from './vehicles.js';
import { enterCar } from './gameplay.js';
import { applyLook } from './look.js';

function snapshotSave() {
  const ride = G.drivenCar;
  const savedCar = ride ? { name: ride.name, style: ride.style, hp: ride.hp, x: ride.position.x, z: ride.position.z, heading: ride.heading } : null;
  const active = G.missions.curIdx >= 0 ? { index: G.missions.curIdx, stage: G.missions.stageIndex, clock: G.missions.missionClock } : null;
  return {
    money: G.money,
    rep: G.rep,
    missionsDone: G.missions.doneCount(),
    weaponsOwned: G.combat.ownedWeaponIds(),
    tapesCollected: G.tapes.collected,
    look: { ...G.look },
    playerX: ride ? ride.position.x : G.player.position.x,
    playerZ: ride ? ride.position.z : G.player.position.z,
    heading: ride ? ride.heading : G.player.heading,
    car: savedCar,
    mission: active,
    gameMinutes: G.gameMinutes,
    businesses: G.businesses.serialize(),
    stats: { ...G.stats },
    achievements: [...G.unlockedAchievements],
    playSeconds: Math.floor(G.elapsed),
    garage: { ...G.garage },
  };
}

function restoreDrivenCar(saved) {
  // The driven car survives a reload: a parked car with the same name is
  // teleported to the saved spot; a traffic/police car (no fixed twin in
  // a fresh world) is recreated with the same name and style.
  let car = G.cars.find((candidate) => candidate.name === saved.name && !candidate.destroyed);
  if (car) {
    car.group.position.set(saved.x, 0, saved.z);
    car.heading = saved.heading;
    car.group.rotation.y = saved.heading;
  } else if (saved.style === 'bike') {
    car = createBike(G.scene, saved.name, 0x346edc, saved.x, saved.z, saved.heading);
    G.cars.push(car);
  } else {
    const taxi = saved.name === 'KEYS TAXI';
    const paint = taxi ? G.textures.carTaxi : G.textures.carBlue;
    const trim = taxi ? 0xffc828 : 0x346edc;
    car = createCar(G.scene, G.textures, saved.name, paint, trim, saved.x, saved.z, saved.heading, saved.style || 'sedan');
    G.cars.push(car);
  }
  car.hp = Math.max(1, saved.hp || 100);
  car.maxHp = (car.baseMaxHp || 100) * (G.garage.armour ? 2 : 1);
  car.burning = false;
  car.burnTimer = 0;
  car.speed = 0;
  car.owned = true;
  enterCar(car);
}

function applySave(data) {
  G.money = data.money;
  G.rep = data.rep;
  if (G.drivenCar) {
    G.drivenCar.driven = false;
    G.drivenCar.speed = 0;
    G.drivenCar = null;
    G.player.group.visible = true;
  }
  G.missions.failCurrent();
  G.missions.setCompleted(data.missionsDone);
  const active = data.mission;
  if (active && active.index >= 0 && active.index < MISSIONS_IN_STORY) {
    G.missions.restoreActive(active.index, active.stage || 0, active.clock || 0);
  }
  G.combat.setOwnedWeapons(data.weaponsOwned || ['fists', 'pistol']);
  G.tapes.setCollected(data.tapesCollected || 0);
  G.businesses.reset();
  if (data.businesses) G.businesses.restore(data.businesses);
  G.stats = { ...freshStats(), ...(data.stats || {}) };
  G.unlockedAchievements = Array.isArray(data.achievements) ? [...data.achievements] : [];
  G.elapsed = data.playSeconds || 0;
  G.gameMinutes = data.gameMinutes || CLOCK_START_MINUTES;
  G.garage = { engine: false, armour: false, nitro: false, ...(data.garage || {}) };
  if (data.look) applyLook(data.look);
  G.health = 100;
  G.armour = 0;
  G.wanted.setStars(0);
  G.reachedFive = false;
  G.player.jumpY = 0;
  G.player.jumpV = 0;
  G.player.heading = data.heading || 0;
  G.player.group.rotation.y = G.player.heading;
  G.player.group.position.set(data.playerX, 0, data.playerZ);
  if (data.car) restoreDrivenCar(data.car);
}

export { snapshotSave, restoreDrivenCar, applySave };
