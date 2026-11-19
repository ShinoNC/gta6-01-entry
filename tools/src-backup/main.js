import * as THREE from 'three';
import { makeRng } from './random.js';
import { loadTextures } from './textures.js';
import { Input } from './input.js';
import { buildCity, districtNameAt } from './city.js';
import { createPlayer } from './player.js';
import { createCars } from './vehicles.js';
import { ChaseCamera } from './camera.js';
import { Hud } from './hud.js';
import { Traffic } from './traffic.js';
import { Pedestrians, SKIN_COLOURS, HAIR_COLOURS, SHIRT_COLOURS } from './pedestrians.js';
import { Wanted } from './wanted.js';
import { Police } from './police.js';
import { Missions, MISSIONS_IN_STORY, buildBeacon } from './missions.js';
import { Combat } from './combat.js';
import { Dialogue } from './dialogue.js';
import { Tapes, TAPE_COUNT } from './tapes.js';
import { SideJobs } from './sidejobs.js';
import { Weather } from './weather.js';
import { Robbery } from './robbery.js';
import { GameAudio } from './audio.js';
import { Effects } from './effects.js';
import { Businesses, ACHIEVEMENTS, checkAchievements, freshStats } from './business.js';
import { saveGame, loadGame, saveSlotSummaries, latestSaveSlot, saveLook, loadLook } from './save.js';
const SPAWN_X = 0;
const SPAWN_Z = 0;
const START_MONEY = 1250;
const ENTER_CAR_RANGE = 5;
const SHOT_CHASE_SECONDS = 0.8;
const SHOT_FOOT_SECONDS = 2;
const SHOT_MISSION_SECONDS = 0.6;
const REP_PER_LEVEL = 200;
const REP_RANKS = ['ROOKIE', 'HUSTLER', 'WHEELMAN', 'BAY HUSTLER', 'KINGPIN'];
const CLOCK_START_MINUTES = 18 * 60 + 50;
const CLOCK_MINUTES_PER_SECOND = 0.5;
const AUTOSAVE_SLOT = 1;
const PEDESTRIAN_HIT_RANGE = 2.1;
const PEDESTRIAN_HIT_MIN_SPEED = 2;
const SPRAY_X = 104, SPRAY_Z = -52, SPRAY_PRICE = 200, SPRAY_RANGE = 9;
const ARREST_RANGE = 3.5, ARREST_SECONDS = 3, POLICE_HIT_CHANCE = 0.3, POLICE_SHOT_DAMAGE = 8;
const LOCK_HINTS = ['', 'complete MISSION 1', 'complete MISSION 3', 'reach REP 3'];
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot') || '';
const seed = Number.parseInt(params.get('seed') || '1', 10) || 1;
const $ = (id) => document.getElementById(id);
const on = (id, fn) => $(id).addEventListener('click', fn);
const NO_INPUT = { moveAxes: () => ({ forward: 0, strafe: 0 }), isDown: () => false };
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
const input = new Input();
const rng = makeRng(seed);
let state = 'title';
let city, player, cars, chaseCamera, hud, traffic, pedestrians, wanted, police, missions, combat, dialogue, tapes, sideJobs, weather, robbery, audio, effects, businesses;
let drivenCar = null, money = START_MONEY, rep = 0, prevStars = 0, skidSeconds = 0, driftChain = 0, nearMissAt = -99, elapsed = 0, health = 100, armour = 0;
let gameMinutes = CLOCK_START_MINUTES;
let arrestTimer = 0, lastHurtAt = -99, reachedFive = false;
let soundOn = true, musicOn = true, titleOrbitAngle = 0, shotTimer = 0, shotReady = false;
let missionOpen = false, empireOpen = false, mapOpen = false, garageOpen = false, optionsOpen = false, phoneVisible = false, gunshotAt = null;
let garage = { engine: false, armour: false, nitro: false };
let stats = freshStats();
let unlockedAchievements = [];
let freeObj = 'Mara has a job for you — head to the gold marker';
const titleScreen = $('title-screen');
const pauseScreen = $('pause-screen');
const optionsScreen = $('options-screen');
function repLevel() { return 1 + Math.floor(rep / REP_PER_LEVEL); }
function completionPct() {
  return Math.round(
    (50 * missions.doneCount()) / MISSIONS_IN_STORY +
      (15 * tapes.collected) / TAPE_COUNT +
      (20 * businesses.ownedCount()) / 3 +
      (15 * unlockedAchievements.length) / ACHIEVEMENTS.length,
  );
}
function playTimeLine() {
  const totalMinutes = Math.floor(elapsed / 60);
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0 ? `${hours}h ${totalMinutes % 60}m played` : `${totalMinutes}m played`;
}
function earn(amount) {
  money += amount;
  stats.moneyEarned += amount;
}
function awardAchievements() {
  stats.businessesOwned = businesses ? businesses.ownedCount() : 0;
  for (const achievement of checkAchievements(stats, unlockedAchievements)) {
    unlockedAchievements.push(achievement.id);
    earn(achievement.reward);
    hud.showMessage(`ACHIEVEMENT — ${achievement.name} +$${achievement.reward.toLocaleString('en-US')}`, 4, true);
    audio.chime();
  }
}
function clockLine() {
  const total = gameMinutes;
  const day = 1 + Math.floor(total / 1440);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(Math.floor(total % 60)).padStart(2, '0');
  return `DAY ${day} ${hh}:${mm}`;
}
function nightFactor() {
  const mins = gameMinutes % 1440;
  if (mins >= 1260 || mins < 300) return 1;
  if (mins < 360) return 1 - (mins - 300) / 60;
  if (mins < 1200) return 0;
  return (mins - 1200) / 60;
}
function repText() {
  const level = repLevel();
  const rank = REP_RANKS[Math.min(level, REP_RANKS.length) - 1];
  return `REP ${level} · ${rank} ${rep % REP_PER_LEVEL}/${REP_PER_LEVEL} XP`;
}
const LOOK_OPTIONS = { hair: [0, 1, 2, 5, 3].map((i) => HAIR_COLOURS[i]), shirt: [0, 1, 2, 7].map((i) => SHIRT_COLOURS[i]), skin: SKIN_COLOURS };
const LOOK_NAMES = { hair: ['BLACK', 'BROWN', 'BLOND', 'RED', 'SILVER'], shirt: ['ROSE', 'BLUE', 'GOLD', 'TEAL'], skin: ['TAN', 'HONEY', 'DARK', 'FAIR'] };
let look = { hair: 0, shirt: 0, skin: 0 };
function applyLook(next) {
  look = { ...look, ...next };
  for (const key of ['hair', 'shirt', 'skin']) {
    look[key] = Math.max(0, Math.min(LOOK_OPTIONS[key].length - 1, look[key] | 0));
  }
  if (player) {
    player.setAppearance({
      hair: LOOK_OPTIONS.hair[look.hair],
      shirt: LOOK_OPTIONS.shirt[look.shirt],
      skin: LOOK_OPTIONS.skin[look.skin],
    });
  }
  saveLook(look);
  for (const key of ['hair', 'shirt', 'skin']) {
    const row = $(`${key}-swatches`);
    if (row) [...row.children].forEach((el, i) => el.classList.toggle('sel', i === look[key]));
  }
}
function buildSwatches() {
  for (const key of ['hair', 'shirt', 'skin']) {
    const row = $(`${key}-swatches`);
    LOOK_OPTIONS[key].forEach((color, i) => {
      const btn = document.createElement('button');
      btn.className = 'swatch';
      btn.style.background = `#${color.toString(16).padStart(6, '0')}`;
      btn.title = LOOK_NAMES[key][i];
      btn.addEventListener('click', () => applyLook({ [key]: i }));
      row.appendChild(btn);
    });
  }
}
function snapshotSave() {
  return {
    money,
    rep,
    missionsDone: missions.doneCount(),
    weaponsOwned: combat.ownedWeaponIds(),
    tapesCollected: tapes.collected,
    look: { ...look },
    playerX: player.position.x,
    playerZ: player.position.z,
    businesses: businesses.serialize(),
    stats: { ...stats },
    achievements: [...unlockedAchievements],
    playSeconds: Math.floor(elapsed),
    garage: { ...garage },
  };
}
function applySave(data) {
  money = data.money;
  rep = data.rep;
  if (drivenCar) {
    drivenCar.driven = false;
    drivenCar.speed = 0;
    drivenCar = null;
    player.group.visible = true;
  }
  missions.failCurrent();
  missions.setCompleted(data.missionsDone);
  combat.setOwnedWeapons(data.weaponsOwned || ['fists', 'pistol']);
  tapes.setCollected(data.tapesCollected || 0);
  businesses.reset();
  if (data.businesses) businesses.restore(data.businesses);
  stats = { ...freshStats(), ...(data.stats || {}) };
  unlockedAchievements = Array.isArray(data.achievements) ? [...data.achievements] : [];
  elapsed = data.playSeconds || 0;
  garage = { engine: false, armour: false, nitro: false, ...(data.garage || {}) };
  if (data.look) applyLook(data.look);
  health = 100;
  armour = 0;
  wanted.setStars(0);
  reachedFive = false;
  player.jumpY = 0;
  player.jumpV = 0;
  player.group.position.set(data.playerX, 0, data.playerZ);
}
function startGame() {
  state = 'play';
  document.body.classList.remove('on-title');
  titleScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  optionsScreen.classList.add('hidden');
  optionsOpen = false;
  if (empireOpen) closeEmpireScreen();
  audio.unlock();
  hud.setObjective(freeObj);
}
function togglePause() {
  if (state === 'play') {
    state = 'pause';
    input.exitLock();
    pauseScreen.classList.remove('hidden');
  } else if (state === 'pause') {
    startGame();
  }
}
function openOptions() {
  titleScreen.classList.add('hidden');
  optionsScreen.classList.remove('hidden');
  optionsOpen = true;
  refreshOptionsLabels();
}
function closeOptions() {
  optionsScreen.classList.add('hidden');
  optionsOpen = false;
  titleScreen.classList.remove('hidden');
}
function refreshOptionsLabels() {
  $('sound-toggle').textContent = `SOUND: ${soundOn ? 'ON' : 'OFF'}`;
  $('music-toggle').textContent = `MUSIC: ${musicOn ? 'ON' : 'OFF'}`;
  $('radio-option').textContent = `RADIO: ${audio.radioStationName()}`;
}
function openMissionScreen() {
  if (empireOpen) closeEmpireScreen();
  if (mapOpen) closeMapScreen();
  if (garageOpen) closeGarageScreen();
  input.exitLock();
  hud.renderMissionList(missions.statusList(), missions.stageIndex, completionPct(), playTimeLine());
  hud.showMissionScreen();
  missionOpen = true;
}
function closeMissionScreen() {
  hud.hideMissionScreen();
  missionOpen = false;
}
function openEmpireScreen() {
  if (missionOpen) closeMissionScreen();
  if (mapOpen) closeMapScreen();
  if (garageOpen) closeGarageScreen();
  input.exitLock();
  hud.renderEmpireScreen(businesses, stats, ACHIEVEMENTS, unlockedAchievements, money, repLevel(), completionPct(), playTimeLine());
  hud.showEmpireScreen();
  empireOpen = true;
}
function closeEmpireScreen() {
  hud.hideEmpireScreen();
  empireOpen = false;
}
function openMapScreen() {
  if (missionOpen) closeMissionScreen();
  if (empireOpen) closeEmpireScreen();
  if (garageOpen) closeGarageScreen();
  input.exitLock();
  const focus = drivenCar || player;
  hud.renderMapScreen({
    playerPos: focus.position,
    playerHeading: drivenCar ? drivenCar.heading : player.heading,
    cars,
    driving: Boolean(drivenCar),
    missionTarget: missions.target,
    policeBlips: police.allCarPositions(),
    timeSeconds: performance.now() / 1000,
    trafficBlips: traffic.cars.map((npc) => ({ x: npc.car.position.x, z: npc.car.position.z })),
    ammoCrates: combat.ammoCratesForHud(),
    sideJobTarget: sideJobs.target,
    eventBlip: robbery.blip,
    businessBlips: businesses.blips(),
    sprayPos: { x: SPRAY_X, z: SPRAY_Z },
  });
  hud.showMapScreen();
  mapOpen = true;
}
function closeMapScreen() {
  hud.hideMapScreen();
  mapOpen = false;
}
function openGarageScreen() {
  if (missionOpen) closeMissionScreen();
  if (empireOpen) closeEmpireScreen();
  if (mapOpen) closeMapScreen();
  input.exitLock();
  hud.renderGarageScreen(garage, money, drivenCar, wanted.stars);
  hud.showGarageScreen();
  garageOpen = true;
}
function closeGarageScreen() {
  hud.hideGarageScreen();
  garageOpen = false;
}
function applyGarageToCar(car) {
  if (garage.engine && !car._tuned) {
    car.maxSpeed *= 1.15;
    car.accel *= 1.15;
    car._tuned = true;
  }
  if (garage.armour && !car._armoured) {
    car.maxHp = 200;
    if (car.hp >= 100) car.hp = 200;
    car._armoured = true;
  }
  car.nitro = garage.nitro;
}
function acceptBriefing() {
  const briefing = missions.pendingBriefing;
  if (!briefing) return;
  hud.hideBriefing();
  phoneVisible = false;
  missions.startMission(briefing.index);
}
buildSwatches();
on('start-button', startGame);
on('down-button', recoverFromDown);
on('resume-button', startGame);
on('restart-button', () => window.location.reload());
on('options-button', openOptions);
on('options-back', closeOptions);
on('sound-toggle', () => {
  soundOn = !soundOn;
  audio.setSoundEnabled(soundOn);
  refreshOptionsLabels();
});
on('music-toggle', () => {
  musicOn = !musicOn;
  audio.setMusicEnabled(musicOn);
  refreshOptionsLabels();
});
on('radio-option', () => {
  audio.nextStation();
  refreshOptionsLabels();
});
on('continue-button', () => {
  const slot = latestSaveSlot() || AUTOSAVE_SLOT;
  const data = loadGame(slot);
  if (data) applySave(data);
  startGame();
});
on('save-button', () => {
  saveGame(AUTOSAVE_SLOT, snapshotSave());
  hud.showMessage('GAME SAVED — SLOT 1');
});
on('missions-button', () => {
  startGame();
  openMissionScreen();
});
on('empire-button', () => {
  startGame();
  openEmpireScreen();
});
on('mission-close-button', closeMissionScreen);
on('empire-close-button', closeEmpireScreen);
on('map-close-button', closeMapScreen);
on('garage-close-button', closeGarageScreen);
on('garage-list', (event) => {
  const button = event.target.closest('.garage-buy');
  if (!button || !drivenCar) return;
  const action = button.dataset.action;
  if (action === 'repair') {
    if (money < SPRAY_PRICE) return;
    money -= SPRAY_PRICE;
    drivenCar.hp = drivenCar.maxHp;
    drivenCar.burning = false;
    drivenCar.warned = false;
    wanted.setStars(0);
    hud.showMessage("PAY'N'SPRAY — car repaired, heat cleared ($200)", 3);
  } else {
    const prices = { engine: 4000, armour: 3000, nitro: 3000 };
    if (garage[action] || money < prices[action]) return;
    money -= prices[action];
    garage[action] = true;
    applyGarageToCar(drivenCar);
    if (action === 'armour') {
      drivenCar.maxHp = 200;
      drivenCar.hp = 200;
    }
    hud.showMessage(`${action.toUpperCase()} INSTALLED — every car you drive from now on`, 4, true);
  }
  audio.chime();
  openGarageScreen();
  saveGame(AUTOSAVE_SLOT, snapshotSave());
});
on('empire-list', (event) => {
  const buyButton = event.target.closest('.empire-buy');
  const upgradeButton = event.target.closest('.empire-upgrade');
  if (buyButton) {
    const index = Number.parseInt(buyButton.dataset.index, 10);
    const def = businesses.defs[index];
    if (businesses.canBuy(index, money, repLevel()) !== 'ok') return;
    money -= def.price;
    businesses.buy(index);
    stats.businessesOwned = businesses.ownedCount();
    hud.showMessage(`${def.name} IS YOURS — income starts now`, 4, true);
    audio.chime();
    awardAchievements();
    openEmpireScreen();
    saveGame(AUTOSAVE_SLOT, snapshotSave());
  } else if (upgradeButton) {
    const index = Number.parseInt(upgradeButton.dataset.index, 10);
    const def = businesses.defs[index];
    if (businesses.canUpgrade(index, money) !== 'ok') return;
    money -= businesses.upgradeCost(index);
    businesses.upgrade(index);
    hud.showMessage(`${def.name} UPGRADED — LV ${businesses.state[index].level}`, 4, true);
    audio.chime();
    openEmpireScreen();
    saveGame(AUTOSAVE_SLOT, snapshotSave());
  }
});
on('phone-accept', acceptBriefing);
on('phone-later', () => {
  hud.hideBriefing();
  phoneVisible = false;
  missions.snoozeBriefing(20);
});
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
function nearestCar(position) {
  let best = null;
  let bestDist = ENTER_CAR_RANGE;
  const consider = (car) => {
    if (car.destroyed) return;
    const dist = Math.hypot(car.position.x - position.x, car.position.z - position.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = car;
    }
  };
  for (const car of cars) consider(car);
  for (const npc of traffic.cars) consider(npc.car);
  for (const unit of [...police.pursuit, ...police.roadblock]) consider(unit.car);
  return best;
}
function enterCar(car) {
  drivenCar = car;
  car.driven = true;
  applyGarageToCar(car);
  player.jumpY = 0;
  player.jumpV = 0;
  player.group.visible = false;
  const npcIndex = traffic.cars.findIndex((npc) => npc.car === car);
  if (npcIndex >= 0) {
    traffic.cars.splice(npcIndex, 1);
    traffic.cars.push(traffic.buildNpc(scene, rng));
    cars.push(car);
    car.speed = 0;
  }
  // Stealing a police car: drop the unit (the force spawns a replacement),
  // keep the car — lightbar and all — and yank it to a stop.
  for (const list of [police.pursuit, police.roadblock]) {
    const unitIndex = list.findIndex((unit) => unit.car === car);
    if (unitIndex >= 0) {
      list.splice(unitIndex, 1);
      cars.push(car);
      car.speed = 0;
      break;
    }
  }
  if (!car.owned) {
    car.owned = true;
    stats.carsStolen += 1;
    const crime = wanted.commitCrime('steal');
    hud.showMessage(`VEHICLE STOLEN: ${car.name}${crime ? ' — ' + crime : ''}`, 3);
  } else {
    hud.showMessage(`ENTERED ${car.name} — W to drive, S to brake`);
  }
}
function exitCar() {
  const car = drivenCar;
  drivenCar = null;
  car.driven = false;
  if (car.destroyed) car.speed = 0;
  player.group.position.set(car.position.x + 2.5, 0, car.position.z);
  player.group.visible = true;
  hud.showMessage('ON FOOT — WASD to walk, F near a car to drive');
}
function damagePlayer(amount) {
  if (state !== 'play') return;
  const absorbed = Math.min(armour, amount);
  armour -= absorbed;
  health -= amount - absorbed;
  lastHurtAt = elapsed;
  if (health <= 0) endRun('WASTED');
}
function endRun(kind) {
  if (state !== 'play') return;
  state = 'down';
  input.exitLock();
  hud.hideBriefing();
  phoneVisible = false;
  if (missionOpen) closeMissionScreen();
  if (empireOpen) closeEmpireScreen();
  if (mapOpen) closeMapScreen();
  if (garageOpen) closeGarageScreen();
  dialogue.el.classList.add('hidden');
  dialogue.until = 0;
  $('hud-message').classList.remove('visible');
  $('hud-police').classList.add('hidden');
  const fine = Math.floor(money * 0.1);
  money -= fine;
  missions.failCurrent();
  wanted.setStars(0);
  reachedFive = false;
  health = 100;
  arrestTimer = 0;
  if (drivenCar) {
    drivenCar.driven = false;
    drivenCar.speed = 0;
    drivenCar = null;
  }
  player.group.visible = true;
  player.jumpY = 0;
  player.jumpV = 0;
  const wasted = kind === 'WASTED';
  player.group.position.set(wasted ? 52 : -104, 0, wasted ? 26 : -104);
  player.downTimer = 0;
  player.group.rotation.x = 0;
  $('down-title').textContent = kind;
  $('down-sub').textContent = wasted ? `Hospital bill $${fine.toLocaleString('en-US')} — the Keys PD lost your trail` : `Fine $${fine.toLocaleString('en-US')} — the Keys PD lost your trail`;
  $('down-screen').classList.remove('hidden');
}
function recoverFromDown() {
  $('down-screen').classList.add('hidden');
  startGame();
}
function damageCar(car, amount) {
  if (!car || car.hp <= 0 || car.name === 'SUNSET COUPE') return;
  car.hp -= amount;
  if (car.hp <= 0 && !car.burning) {
    car.burning = true;
    car.burnTimer = 3;
  }
}
function updateBurning(car, dt) {
  if (car.destroyed) return;
  if (!car.burning) {
    if (car.hp < 30 && car.hp > 0 && Math.random() < dt * 2) effects.puffSmoke(car.position.x, 1, car.position.z);
    return;
  }
  if (car.driven && !car.warned) {
    car.warned = true;
    hud.showMessage(`${car.name} IS ON FIRE — get out!`, 3);
  }
  car.burnTimer -= dt;
  effects.puffSmoke(car.position.x, 1.2, car.position.z);
  if (Math.random() < dt * 6) effects.burstSparks(car.position.x, 1, car.position.z, 4);
  if (car.burnTimer > 0) return;
  car.burning = false;
  car.destroyed = true;
  effects.burstSparks(car.position.x, 1, car.position.z, 24);
  effects.puffSmoke(car.position.x, 1.5, car.position.z, 8);
  audio.gunshot();
  if (car.driven) exitCar();
  if (Math.hypot(player.position.x - car.position.x, player.position.z - car.position.z) < 9) damagePlayer(70);
  scene.remove(car.group);
  const ni = traffic.cars.findIndex((npc) => npc.car === car);
  if (ni >= 0) {
    traffic.cars.splice(ni, 1);
    traffic.cars.push(traffic.buildNpc(scene, rng));
  }
}
function combatTargets() {
  const targets = [];
  for (const ped of pedestrians.peds) {
    if (ped.knockedTimer > 0) continue;
    targets.push({ x: ped.mesh.group.position.x, z: ped.mesh.group.position.z, radius: 0.9, kind: 'pedestrian', ref: ped });
  }
  const carTarget = (car, kind) => {
    if (car.destroyed || car === drivenCar) return;
    targets.push({ x: car.position.x, z: car.position.z, radius: 2.2, kind, ref: car });
  };
  for (const car of cars) carTarget(car, 'car');
  for (const npc of traffic.cars) carTarget(npc.car, 'car');
  for (const unit of [...police.pursuit, ...police.roadblock]) carTarget(unit.car, 'police');
  if (robbery.active && !robbery.getaway.stopped) {
    const getaway = robbery.getaway.car.position;
    targets.push({ x: getaway.x, z: getaway.z, radius: 2.2, kind: 'getaway', ref: robbery.getaway });
  }
  if (police.helicopter) {
    const hp = police.helicopter.group.position;
    targets.push({ x: hp.x, z: hp.z, radius: 3, kind: 'helicopter', ref: null });
  }
  return targets;
}
function stageShot() {
  if (shotName === 'chase') {
    startGame();
    money = 15250;
    rep = 650;
    const car = cars[2];
    car.group.position.set(-26, 0, 0);
    car.heading = Math.PI / 2;
    car.group.rotation.y = Math.PI / 2;
    enterCar(car);
    car.speed = 30;
    missions.setCompleted(5);
    missions.forceStart(5);
    combat.setOwnedWeapons(['fists', 'pistol', 'smg', 'shotgun']);
    combat.restock();
    tapes.setCollected(3);
    police.stageChase(car.position, car.heading);
    dialogue.say('juno', 'Alarms are back! Lose them before they box you in.', 300);
    prevStars = wanted.stars;
    const avenue = traffic.lines.find((line) => line.axis === 'x' && line.at === 0);
    for (const [i, direction, along] of [
      [0, 1, 30],
      [1, 1, 70],
      [2, -1, 110],
    ]) {
      const npc = traffic.cars[i];
      npc.line = avenue;
      npc.direction = direction;
      npc.along = along;
      traffic.placeOnRoad(npc);
    }
  } else if (shotName === 'combat') {
    startGame();
    gameMinutes = 22 * 60 + 30;
    money = 8500;
    rep = 450;
    combat.setOwnedWeapons(['fists', 'pistol']);
    combat.restock();
    combat.selectWeapon(1);
    missions.setCompleted(2);
    missions.snoozeBriefing(30);
    player.group.position.set(0, 0, 26);
    player.heading = Math.PI;
    player.group.rotation.y = Math.PI;
    const avenue = traffic.lines.find((line) => line.axis === 'z' && line.at === 0);
    for (const [i, d, a] of [[0, 1, -10], [1, 1, -30], [2, -1, 70]]) {
      const npc = traffic.cars[i];
      npc.line = avenue;
      npc.direction = d;
      npc.along = a;
      traffic.placeOnRoad(npc);
    }
    for (const [i, s, a] of [[0, -1, 10], [1, 1, 2], [2, -1, -8], [3, 1, 44]]) {
      const ped = pedestrians.peds[i];
      ped.line = avenue;
      ped.side = s;
      ped.along = a;
      pedestrians.placeOnSidewalk(ped);
    }
    dialogue.say('juno', 'Night run. Pistol out, eyes open.', 300);
  } else if (shotName === 'empire') {
    startGame();
    money = 25000;
    rep = 900;
    elapsed = 2 * 3600 + 34 * 60;
    missions.setCompleted(5);
    businesses.buy(0);
    businesses.upgrade(0);
    businesses.buy(1);
    businesses.state[0].pending = 2400;
    businesses.state[1].pending = 6000;
    tapes.setCollected(7);
    Object.assign(stats, { carsStolen: 12, pedsDown: 4, moneyEarned: 32000, kmDriven: 48.5, escapes5: 1, helisDown: 2, robberiesStopped: 3, jobsDone: 6, businessesOwned: 2 });
    unlockedAchievements = ['firstWheels', 'carThief', 'ghost'];
    openEmpireScreen();
  }
}
function update(dt) {
  if (input.pressed('Enter') && state === 'title' && !optionsOpen) startGame();
  if (input.pressed('Enter') && state === 'down') recoverFromDown();
  if (input.pressed('Enter') && phoneVisible && state === 'play') acceptBriefing();
  if (input.pressed('Escape')) {
    if (optionsOpen) closeOptions();
    else if (missionOpen) closeMissionScreen();
    else if (empireOpen) closeEmpireScreen();
    else if (mapOpen) closeMapScreen();
    else if (garageOpen) closeGarageScreen();
    else if (state === 'play' || state === 'pause') togglePause();
  }
  if (state === 'title') {
    titleOrbitAngle += dt * 0.05;
    const radius = 150;
    camera.position.set(Math.sin(titleOrbitAngle) * radius, 55, Math.cos(titleOrbitAngle) * radius);
    camera.lookAt(0, 0, -20);
    city.update(dt);
    return;
  }
  if (state === 'pause' || state === 'down') return;
  if (input.pressed('KeyM') && !phoneVisible) {
    if (missionOpen) closeMissionScreen();
    else openMissionScreen();
  }
  if (input.pressed('KeyB') && !phoneVisible) {
    if (empireOpen) closeEmpireScreen();
    else openEmpireScreen();
  }
  if (input.pressed('KeyN') && !phoneVisible) {
    if (mapOpen) closeMapScreen();
    else openMapScreen();
  }
  if (!shotReady) {
    shotTimer += dt;
    const readyAt =
      shotName === 'chase' ? SHOT_CHASE_SECONDS : shotName === 'combat' ? SHOT_FOOT_SECONDS : shotName === 'empire' ? SHOT_MISSION_SECONDS : Infinity;
    if (shotTimer >= readyAt) {
      shotReady = true;
      window.__shotReady = true;
    }
  }
  if (missionOpen || empireOpen || mapOpen || garageOpen) return;
  elapsed += dt;
  const night = nightFactor();
  gameMinutes += dt * CLOCK_MINUTES_PER_SECOND * (1 + 2 * night);
  city.setNight(night);
  weather.night = night;
  if (wanted.stars === 0 && health < 50 && elapsed - lastHurtAt > 5) health = Math.min(50, health + dt * 3);
  if (input.pressed('KeyR')) {
    hud.showMessage(`RADIO — ${audio.nextStation()}`, 2);
  }
  if (input.pressed('KeyH') && drivenCar) {
    audio.horn();
  }
  for (const [index, code] of ['Digit1', 'Digit2', 'Digit3', 'Digit4'].entries()) {
    if (input.pressed(code)) {
      const result = combat.selectWeapon(index);
      if (result === 'locked') {
        hud.showMessage(`${combat.ammoForHud()[index].name} locked — ${LOCK_HINTS[index]} to unlock it`);
      }
    }
  }
  const wheelSteps = input.consumeWheel();
  if (wheelSteps !== 0) {
    const weaponName = combat.cycleWeapon(wheelSteps > 0 ? 1 : -1);
    if (weaponName) hud.showMessage(`WEAPON — ${weaponName}`, 1.2);
  }
  if (input.pressed('KeyF') && player.downTimer <= 0) {
    if (drivenCar) exitCar();
    else {
      const car = nearestCar(player.position);
      if (car) enterCar(car);
      else hud.showMessage('No car nearby — walk closer to one and press F');
    }
  }
  const autoDrive = shotName === 'chase' && drivenCar;
  const drivingInput = autoDrive
    ? { moveAxes: () => ({ forward: 1, strafe: 0 }), isDown: () => false }
    : input;
  if (drivenCar) {
    drivenCar.update(dt, drivingInput, city, weather.grip);
    stats.kmDriven += (Math.abs(drivenCar.speed) * dt) / 1000;
    chaseCamera.update(dt, drivenCar.position, drivenCar.heading, true, input, combat.recoil, police.helicopter ? 2 : 0);
    if (drivenCar.skidding) {
      const backX = drivenCar.position.x - Math.sin(drivenCar.heading) * 1.4;
      const backZ = drivenCar.position.z - Math.cos(drivenCar.heading) * 1.4;
      effects.puffSmoke(backX, 0.4, backZ);
    }
    if (drivenCar.boosting) {
      const backX = drivenCar.position.x - Math.sin(drivenCar.heading) * 2.2;
      const backZ = drivenCar.position.z - Math.cos(drivenCar.heading) * 2.2;
      effects.burstSparks(backX, 0.5, backZ, 3);
    }
    if (drivenCar.impact > 0.7) {
      const noseX = drivenCar.position.x + Math.sin(drivenCar.heading) * 2.1;
      const noseZ = drivenCar.position.z + Math.cos(drivenCar.heading) * 2.1;
      effects.burstSparks(noseX, 0.8, noseZ, 6);
      damagePlayer(3);
      drivenCar.impact = 0.5;
    }
    if (drivenCar.skidding) {
      skidSeconds += dt;
      if (skidSeconds > 0.5) {
        skidSeconds = 0;
        driftChain += 1;
        const bonus = 50 * driftChain;
        earn(bonus);
        hud.showMessage(`DRIFT x${driftChain} +$${bonus}`, 1.2);
      }
    } else {
      skidSeconds = 0;
      driftChain = 0;
    }
  } else {
    player.update(dt, input, chaseCamera.yaw, city);
    chaseCamera.update(dt, player.position, player.heading, false, input, combat.recoil, police.helicopter ? 2 : 0);
    const hitByCar = (car, speed) => {
      if (!car || car.destroyed) return;
      const dx = player.position.x - car.position.x;
      const dz = player.position.z - car.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= 2.6 || dist < 0.01) return;
      player.group.position.set(car.position.x + (dx / dist) * 2.6, 0, car.position.z + (dz / dist) * 2.6);
      if (speed < 2 || elapsed - (car._hitAt || -99) < 1) return;
      car._hitAt = elapsed;
      damagePlayer(Math.min(25, Math.round(3 + speed)));
      player.knockDown(0.8);
      combat.recoil = Math.min(1, combat.recoil + 0.5);
      hud.showMessage('HIT BY A CAR!', 2);
    };
    for (const car of cars) hitByCar(car, car.speed);
    for (const npc of traffic.cars) hitByCar(npc.car, npc.speed);
    for (const unit of [...police.pursuit, ...police.roadblock]) hitByCar(unit.car, unit.car.speed);
  }
  for (const car of cars) {
    if (!car.driven && !car.destroyed && Math.abs(car.speed) > 0.05) car.update(dt, NO_INPUT, city, 1);
  }
  city.update(dt);
  effects.update(dt);
  if (input.tap && player.downTimer <= 0) {
    if (!drivenCar) {
      player.heading = Math.atan2(-Math.sin(chaseCamera.yaw), -Math.cos(chaseCamera.yaw));
      player.group.rotation.y = player.heading;
    }
    const origin = drivenCar ? drivenCar.position : player.position;
    const aim = drivenCar ? drivenCar.heading + Math.PI : chaseCamera.yaw;
    const result = combat.tryShoot(origin, aim, combatTargets());
    if (result === 'empty') hud.showMessage('NO AMMO — finish a mission to restock');
    else if (result === 'reloading') hud.showMessage('RELOADING…');
    else if (result === 'punch' || result === 'whiff') {
      if (!drivenCar) player.punch();
      audio.punchSound(result === 'punch');
    }
  }
  combat.update(dt, player.position);
  const obstacles = [];
  if (drivenCar) obstacles.push({ x: drivenCar.position.x, z: drivenCar.position.z });
  else obstacles.push({ x: player.position.x, z: player.position.z });
  for (const npc of traffic.cars) obstacles.push({ x: npc.car.position.x, z: npc.car.position.z });
  for (const position of police.allCarPositions()) obstacles.push(position);
  traffic.update(dt, obstacles);
  if (drivenCar && Math.abs(drivenCar.speed) > PEDESTRIAN_HIT_MIN_SPEED) {
    for (const ped of pedestrians.peds) {
      if (ped.knockedTimer > 0) continue;
      const pos = ped.mesh.group.position;
      if (Math.hypot(pos.x - drivenCar.position.x, pos.z - drivenCar.position.z) < PEDESTRIAN_HIT_RANGE) {
        pedestrians.knockDown(ped, drivenCar.position.x, drivenCar.position.z);
        stats.pedsDown += 1;
        const crime = wanted.commitCrime('hitPedestrian');
        hud.showMessage(crime || 'PEDESTRIAN HIT!');
      }
    }
  }
  if (drivenCar) {
    const fwdX = Math.sin(drivenCar.heading);
    const fwdZ = Math.cos(drivenCar.heading);
    for (const npc of traffic.cars) {
      const gap = Math.hypot(npc.car.position.x - drivenCar.position.x, npc.car.position.z - drivenCar.position.z);
      const lateral = Math.abs((npc.car.position.x - drivenCar.position.x) * fwdZ - (npc.car.position.z - drivenCar.position.z) * fwdX);
      if (gap < 3 && lateral < 2.2) {
        traffic.shove(npc);
        drivenCar.speed *= 0.55;
      } else if (gap < 5.5 && Math.abs(drivenCar.speed) > 20 && elapsed - nearMissAt > 3) {
        nearMissAt = elapsed;
        earn(100);
        hud.showMessage('NEAR MISS +$100', 1.2);
      }
    }
    const collideWith = (other, push) => {
      if (!other || other.destroyed || other === drivenCar) return;
      const dx = drivenCar.position.x - other.position.x;
      const dz = drivenCar.position.z - other.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= 4 || dist < 0.01) return;
      if (Math.abs(dx * fwdZ - dz * fwdX) > 2.2) return;
      if (push) {
        drivenCar.position.x = other.position.x + (dx / dist) * 4;
        drivenCar.position.z = other.position.z + (dz / dist) * 4;
      }
      const speed = Math.abs(drivenCar.speed);
      if (speed > 8) {
        const dmg = (speed - 8) * 0.8;
        damageCar(drivenCar, dmg);
        damageCar(other, dmg);
        effects.burstSparks(drivenCar.position.x, 0.8, drivenCar.position.z, 6);
        damagePlayer(3);
      }
      drivenCar.speed *= 0.3;
    };
    for (const car of cars) collideWith(car, true);
    for (const npc of traffic.cars) collideWith(npc.car, true);
    for (const unit of police.roadblock) collideWith(unit.car, true);
    for (const unit of police.pursuit) collideWith(unit.car, false);
    if (Math.hypot(drivenCar.position.x - SPRAY_X, drivenCar.position.z - SPRAY_Z) < SPRAY_RANGE) {
      hud.showMessage("PAY'N'SPRAY — press E for the garage (repair $200 · upgrades)", 0.6);
      if (input.pressed('KeyE')) openGarageScreen();
    }
    if (robbery.active && !robbery.getaway.stopped) {
      const getawayPos = robbery.getaway.car.position;
      const ramGap = Math.hypot(getawayPos.x - drivenCar.position.x, getawayPos.z - drivenCar.position.z);
      if (ramGap < 3.4 && Math.abs(drivenCar.speed) > 8 && robbery.ramByPlayer()) {
        effects.burstSparks(getawayPos.x, 0.8, getawayPos.z, 8);
        drivenCar.speed *= 0.6;
        hud.showMessage('RAMMED THE GETAWAY!', 1.5);
      }
    }
  }
  pedestrians.update(dt, city, drivenCar, gunshotAt);
  gunshotAt = null;
  for (const car of cars) updateBurning(car, dt);
  for (const npc of traffic.cars) updateBurning(npc.car, dt);
  for (const unit of [...police.pursuit, ...police.roadblock]) updateBurning(unit.car, dt);
  const focus = drivenCar || player;
  const focusHeading = drivenCar ? drivenCar.heading : player.heading;
  police.update(dt, {
    playerPos: focus.position,
    playerHeading: focusHeading,
    driving: Boolean(drivenCar),
    drivenCar,
    wantedStars: wanted.stars,
    onPoliceShot(from, to) {
      combat.fireTracer({ x: from.x, y: 1.4, z: from.z }, { x: to.x, y: 1.2, z: to.z });
      audio.gunshot();
      const hitChance = wanted.stars >= 5 ? 0.4 : wanted.stars >= 4 ? 0.35 : POLICE_HIT_CHANCE;
      if (Math.random() < hitChance) damagePlayer(POLICE_SHOT_DAMAGE);
    },
  });
  if (wanted.stars >= 1 && wanted.stars <= 2 && !drivenCar) {
    if (police.nearestDistance(player.position) < ARREST_RANGE) {
      arrestTimer += dt;
      if (arrestTimer > 1) hud.showMessage('POLICE ARE GRABBING YOU — RUN!', 1);
      if (arrestTimer >= ARREST_SECONDS) endRun('BUSTED');
    } else arrestTimer = 0;
  } else arrestTimer = 0;
  wanted.update(dt, police.canSeePlayer(focus.position), police.helicopter !== null);
  if (wanted.stars > prevStars) dialogue.cue('heat');
  if (wanted.stars === 5) reachedFive = true;
  if (wanted.stars === 0 && reachedFive && prevStars === 1) stats.escapes5 += 1;
  if (wanted.stars === 0) reachedFive = false;
  prevStars = wanted.stars;
  missions.update(dt, {
    playerPos: focus.position,
    drivenCar,
    cars,
    wantedStars: wanted.stars,
  });
  sideJobs.update(dt, { focusPos: focus.position, driving: Boolean(drivenCar) });
  businesses.update(dt);
  const collectIndex = businesses.nearestCollectable(focus.position);
  if (collectIndex >= 0) {
    const def = businesses.defs[collectIndex];
    const pending = Math.floor(businesses.state[collectIndex].pending);
    hud.showMessage(`${def.name} — collect $${pending.toLocaleString('en-US')} (press E)`, 0.6);
    if (input.pressed('KeyE')) {
      const amount = businesses.collect(collectIndex);
      earn(amount);
      hud.showMessage(`${def.name} — collected $${amount.toLocaleString('en-US')}`, 3);
      audio.chime();
    }
  }
  awardAchievements();
  weather.update(dt, focus.position);
  robbery.update(dt, { playerPos: focus.position });
  tapes.update(dt, focus.position, (count) => {
    earn(25);
    hud.showMessage(`SUNSET TAPE ${count}/${TAPE_COUNT} +$25`, 2);
  });
  dialogue.update();
  const nextMission = missions.pendingMission;
  if (nextMission && !missions.currentMission()) {
    freeObj = `${nextMission.giver.split(' ')[0]} has a job for you — head to the gold marker`;
  }
  const briefing = missions.pendingBriefing;
  if (briefing && !phoneVisible && !missionOpen) {
    hud.showBriefing(briefing.mission, briefing.index);
    phoneVisible = true;
    input.exitLock();
    audio.click();
  }
  audio.setEngine(drivenCar ? Math.abs(drivenCar.speed) / 38 : 0, Boolean(drivenCar));
  audio.setSiren(police.nearestDistance(focus.position));
  audio.update(dt);
  hud.update({
    playerPos: focus.position,
    heading: focusHeading,
    speedKmh: drivenCar ? Math.abs(drivenCar.speed) * 3.6 : 0,
    money,
    wanted: wanted.stars,
    health,
    armour,
    cars,
    driving: Boolean(drivenCar),
    carName: drivenCar ? drivenCar.name : '',
    carClass: drivenCar ? (drivenCar.name === 'SOLSTICE GT' ? 'SPORTS' : drivenCar.style.toUpperCase()) : '',
    carHp: drivenCar ? drivenCar.hp : 0,
    carMaxHp: drivenCar ? drivenCar.maxHp || 100 : 100,
    missionLine: missions.currentMission() ? missions.progressLine() : sideJobs.statusLine() || missions.progressLine(),
    objective: missions.nextObjectiveLine() || sideJobs.objectiveLine() || freeObj,
    nextLine: missions.nextLine(),
    clockText: clockLine(),
    weatherText: weather.label,
    tapes: `${tapes.collected}/${TAPE_COUNT}`,
    policeUnits: police.units(focus.position),
    weapons: combat.ammoForHud(),
    radioStation: audio.nowPlaying(),
    repText: repText(),
    hiding: wanted.hiding,
    hideProgress: wanted.hideProgress,
    missionTarget: missions.target,
    sideJobTarget: sideJobs.target,
    businessBlips: businesses.blips(),
    eventBlip: robbery.blip,
    policeBlips: police.allCarPositions(),
    trafficBlips: traffic.cars.map((npc) => ({ x: npc.car.position.x, z: npc.car.position.z })),
    ammoCrates: combat.ammoCratesForHud(),
    timeSeconds: performance.now() / 1000,
  });
}
const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
  input.endFrame();
}
loadTextures()
  .then((textures) => {
    city = buildCity(scene, textures, rng);
    const sprayBeacon = buildBeacon(scene, 0x2ad0c4);
    sprayBeacon.group.position.set(SPRAY_X, 0, SPRAY_Z);
    sprayBeacon.group.visible = true;
    player = createPlayer(scene, SPAWN_X, SPAWN_Z);
    cars = createCars(scene, textures);
    cars[0].owned = true;
    traffic = new Traffic(scene, textures, rng);
    pedestrians = new Pedestrians(scene, rng, () => {
      hud.showMessage(['AHH!', 'SOMEBODY HELP!', 'RUN!'][Math.floor(Math.random() * 3)], 1.5);
    });
    wanted = new Wanted();
    police = new Police(scene, textures, city, rng);
    missions = new Missions(scene, {
      onScriptedHeat(stars) {
        wanted.setStars(stars);
        hud.showMessage(`THE HEAT IS ON — ${stars} stars on you`, 3);
      },
      onMissionStarted(mission, index) {
        freeObj = mission.objectives[0].label;
        hud.showMessage(`MISSION ${index + 1}/${MISSIONS_IN_STORY} — ${mission.name}`, 3);
        dialogue.cue('go');
      },
      onObjectiveComplete() {
        audio.click();
      },
      onMissionComplete(mission, index) {
        earn(mission.rewardMoney);
        rep += mission.rewardRep;
        health = 100;
        if (index === 0) combat.unlockWeapon('pistol');
        if (repLevel() >= 3) combat.unlockWeapon('shotgun');
        combat.restock();
        const rewardLine = `+$${mission.rewardMoney.toLocaleString('en-US')} · +${mission.rewardRep} REP`;
        if (mission.finale) {
          hud.showPassed('KING OF THE KEYS', mission.name, [rewardLine, 'THE KEYS ARE YOURS, ROOK']);
        } else if (mission.rewardWeapon) {
          combat.unlockWeapon(mission.rewardWeapon);
          hud.showPassed('MISSION PASSED', mission.name, [rewardLine, 'SMG UNLOCKED']);
        } else {
          hud.showPassed('MISSION PASSED', mission.name, [rewardLine, index === 0 ? 'PISTOL UNLOCKED' : '']);
        }
        audio.chime();
        dialogue.cue('done');
        saveGame(AUTOSAVE_SLOT, snapshotSave());
        if (index === MISSIONS_IN_STORY - 1) {
          freeObj = 'STORY COMPLETE — the Keys are yours. Free roam!';
        }
        const next = missions.pendingMission;
        if (next) hud.showMessage(`${next.giver.split(' ')[0]} has a job for you — head to the gold marker`, 6);
      },
    });
    effects = new Effects(scene);
    businesses = new Businesses(scene);
    combat = new Combat(scene, {
      onShot() {
        audio.gunshot();
        gunshotAt = { x: player.position.x, z: player.position.z };
        pedestrians.scareFrom(player.position.x, player.position.z, 28);
        const witness = pedestrians.peds.some((ped) => ped.knockedTimer <= 0 && Math.hypot(ped.mesh.group.position.x - player.position.x, ped.mesh.group.position.z - player.position.z) < 20);
        if (witness) wanted.lastShootStarAt = -99;
        const crime = wanted.commitCrime('shoot');
        if (crime) hud.showMessage(witness ? `${crime} — witness called it in` : crime, 2);
      },
      onHitPedestrian(ped, lethal) {
        if (lethal) {
          pedestrians.knockDown(ped, player.position.x, player.position.z, 20);
          stats.pedsDown += 1;
        } else pedestrians.fleeFrom(ped, player.position.x, player.position.z);
        const crime = wanted.commitCrime('hitPedestrian');
        if (crime) hud.showMessage(crime, 2);
      },
      onHitCar(car, damage) {
        damageCar(car, damage || 12);
      },
      onDamage(worldPos, amount) {
        const v = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z).project(camera);
        if (v.z > 1) return;
        hud.spawnDamageNumber((v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight, `-${amount}`);
      },
      onAmmoPickup(district) {
        armour = Math.min(100, armour + 50);
        hud.showMessage(`AMMO + ARMOUR RESTOCKED — ${district} crate`, 2.5);
        audio.click();
      },
      onHitGetaway() {
        robbery.shotByPlayer();
      },
      onHitHelicopter(_ref, damage) {
        const heli = police.helicopter;
        const pos = heli ? { x: heli.group.position.x, z: heli.group.position.z } : null;
        if (police.damageHelicopter(damage || 12) && pos) {
          effects.burstSparks(pos.x, 8, pos.z, 24);
          effects.puffSmoke(pos.x, 8, pos.z, 8);
          audio.gunshot();
          stats.helisDown += 1;
          hud.showMessage('HELICOPTER DOWN!', 4, true);
          wanted.setStars(Math.min(5, wanted.stars + 1));
        }
      },
    }, effects);
    audio = new GameAudio();
    chaseCamera = new ChaseCamera(camera);
    chaseCamera.city = city; // camera pulls in when a building blocks the view
    hud = new Hud(city);
    dialogue = new Dialogue();
    tapes = new Tapes(scene, rng);
    sideJobs = new SideJobs(scene, rng, {
      onOffered(job) {
        const spot = districtNameAt(job.pickup.x, job.pickup.z);
        hud.showMessage(job.type === 'taxi' ? `TAXI FARE SPOTTED — pick up at ${spot}` : `DELIVERY FOUND — package at ${spot}`, 4);
      },
      onNeedCar() {
        hud.showMessage('Get in a car to pick up the fare', 2.5);
      },
      onPickedUp(job) {
        const spot = districtNameAt(job.dropoff.x, job.dropoff.z);
        hud.showMessage(job.type === 'taxi' ? `FARE ON BOARD — drop at ${spot}` : `PACKAGE COLLECTED — deliver to ${spot}`, 3);
      },
      onComplete(job) {
        earn(job.rewardMoney);
        rep += job.rewardRep;
        stats.jobsDone += 1;
        hud.showMessage(`${job.type === 'taxi' ? 'FARE DELIVERED' : 'DELIVERY COMPLETE'} — $${job.rewardMoney} + ${job.rewardRep} REP`, 4, true);
        audio.chime();
      },
    });
    weather = new Weather(scene, rng);
    robbery = new Robbery(scene, textures, city, rng, police, {
      onStart() {
        hud.showMessage('BANK ROBBERY — Stop the getaway car! $500 REWARD', 5, true);
        dialogue.say('pd', 'All units: bank robbery in progress. Black sedan fleeing — intercept it.', 5);
      },
      onStopped(byPlayer) {
        if (byPlayer) {
          earn(500);
          rep += 50;
          stats.robberiesStopped += 1;
          hud.showMessage('GETAWAY STOPPED — $500 REWARD + 50 REP', 5, true);
          audio.chime();
        } else {
          hud.showMessage('POLICE CAUGHT THE GETAWAY — no reward for you', 4, true);
        }
      },
      onEscaped() {
        hud.showMessage('THE GETAWAY ESCAPED', 3, true);
      },
    });
    hud.setObjective('Press ENTER or click NEW GAME to play');
    const summaries = saveSlotSummaries();
    $('continue-summary').textContent = `SAVES — ${summaries.map((s) => (s.empty ? `${s.slot}: EMPTY` : `${s.slot}: $${s.money.toLocaleString('en-US')} · ${s.missionsDone}/${MISSIONS_IN_STORY} jobs`)).join(' · ')}`;
    if (latestSaveSlot()) $('continue-button').classList.remove('hidden');
    applyLook(loadLook() || {});
    stageShot();
    window.__game = {
      scene,
      camera,
      get state() {
        return state;
      },
      get player() {
        return player;
      },
      get cars() {
        return cars;
      },
      get drivenCar() {
        return drivenCar;
      },
      get money() {
        return money;
      },
      get rep() {
        return rep;
      },
      get health() {
        return health;
      },
      damagePlayer,
      damageCar,
      endRun,
      setMoney(v) {
        money = v;
      },
      setRep(v) {
        rep = v;
      },
      traffic,
      pedestrians,
      wanted,
      police,
      missions,
      combat,
      dialogue,
      tapes,
      sideJobs,
      weather,
      robbery,
      audio,
      effects,
      businesses,
      input,
      chaseCamera,
      get stats() {
        return stats;
      },
      get garage() {
        return garage;
      },
      get gameMinutes() {
        return gameMinutes;
      },
      setGameMinutes(v) {
        gameMinutes = v;
      },
      get achievements() {
        return unlockedAchievements;
      },
      earn,
      awardAchievements,
      hud,
      save: { saveGame, loadGame },
      snapshotSave,
      applySave,
      heliOnScreen() {
        if (!police.helicopter) return null;
        const projected = police.helicopter.group.position.clone().project(camera);
        return { x: projected.x, y: projected.y, behind: projected.z > 1 };
      },
    };
    if (shotName === 'title') window.__shotReady = true;
    loop();
  })
  .catch((error) => {
    $('load-error').textContent = `Failed to load: ${error.message}`;
    $('load-error').classList.remove('hidden');
    throw error;
  });