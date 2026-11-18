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
import { saveGame, loadGame, saveSlotSummaries, latestSaveSlot, saveLook, loadLook } from './save.js';
const SPAWN_X = 0;
const SPAWN_Z = 0;
const START_MONEY = 1250;
const ENTER_CAR_RANGE = 5;
const SHOT_DRIVE_SECONDS = 3.2;
const SHOT_CHASE_SECONDS = 2.5;
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
let city, player, cars, chaseCamera, hud, traffic, pedestrians, wanted, police, missions, combat, dialogue, tapes, sideJobs, weather, robbery, audio, effects;
let drivenCar = null, money = START_MONEY, rep = 0, prevStars = 0, skidSeconds = 0, driftChain = 0, nearMissAt = -99, elapsed = 0, health = 100, armour = 0;
let arrestTimer = 0, lastHurtAt = -99, downKind = '';
let soundOn = true, musicOn = true, titleOrbitAngle = 0, shotTimer = 0, shotReady = false;
let missionOpen = false, optionsOpen = false, phoneVisible = false, gunshotAt = null;
let freeObj = 'Explore Solaris Keys — press F near a car to drive it';
const titleScreen = $('title-screen');
const pauseScreen = $('pause-screen');
const optionsScreen = $('options-screen');
function repLevel() { return 1 + Math.floor(rep / REP_PER_LEVEL); }
function clockLine() {
  const total = CLOCK_START_MINUTES + elapsed * CLOCK_MINUTES_PER_SECOND;
  const day = 1 + Math.floor(total / 1440);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(Math.floor(total % 60)).padStart(2, '0');
  return `DAY ${day} ${hh}:${mm}`;
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
  };
}
function applySave(data) {
  money = data.money;
  rep = data.rep;
  missions.setCompleted(data.missionsDone);
  combat.setOwnedWeapons(data.weaponsOwned || ['fists', 'pistol']);
  tapes.setCollected(data.tapesCollected || 0);
  if (data.look) applyLook(data.look);
  player.group.position.set(data.playerX, 0, data.playerZ);
}
function startGame() {
  state = 'play';
  document.body.classList.remove('on-title');
  titleScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  optionsScreen.classList.add('hidden');
  optionsOpen = false;
  audio.unlock();
  hud.setObjective(freeObj);
}
function togglePause() {
  if (state === 'play') {
    state = 'pause';
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
  hud.renderMissionList(missions.statusList(), missions.stageIndex);
  hud.showMissionScreen();
  missionOpen = true;
}
function closeMissionScreen() {
  hud.hideMissionScreen();
  missionOpen = false;
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
on('mission-close-button', closeMissionScreen);
on('mission-list', (event) => {
  const button = event.target.closest('.mission-accept');
  if (!button) return;
  const index = Number.parseInt(button.dataset.mission, 10);
  closeMissionScreen();
  hud.hideBriefing();
  phoneVisible = false;
  missions.startMission(index);
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
  return best;
}
function enterCar(car) {
  drivenCar = car;
  car.driven = true;
  player.group.visible = false;
  const npcIndex = traffic.cars.findIndex((npc) => npc.car === car);
  if (npcIndex >= 0) {
    traffic.cars.splice(npcIndex, 1);
    traffic.cars.push(traffic.buildNpc(scene, rng));
    cars.push(car);
  }
  if (!car.owned) {
    car.owned = true;
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
  car.speed = 0;
  player.group.position.set(car.position.x + 2.5, 0, car.position.z);
  player.group.visible = true;
  hud.showMessage('ON FOOT — WASD to walk, F near a car to drive');
}
function damagePlayer(amount) {
  if (state !== 'play') return;
  health -= amount;
  lastHurtAt = elapsed;
  if (health <= 0) endRun('WASTED');
}
function endRun(kind) {
  if (state !== 'play') return;
  downKind = kind;
  state = 'down';
  hud.hideBriefing();
  phoneVisible = false;
  if (missionOpen) closeMissionScreen();
  dialogue.el.classList.add('hidden');
  dialogue.until = 0;
  $('hud-message').classList.remove('visible');
  $('hud-police').classList.add('hidden');
  const fine = Math.floor(money * 0.1);
  money -= fine;
  missions.failCurrent();
  wanted.setStars(0);
  health = 100;
  arrestTimer = 0;
  if (drivenCar) {
    drivenCar.driven = false;
    drivenCar.speed = 0;
    drivenCar = null;
  }
  player.group.visible = true;
  const wasted = kind === 'WASTED';
  player.group.position.set(wasted ? 52 : -104, 0, wasted ? 26 : -104);
  $('down-title').textContent = kind;
  $('down-sub').textContent = wasted ? `Hospital bill $${fine.toLocaleString('en-US')} — the Keys PD lost your trail` : `Fine $${fine.toLocaleString('en-US')} — the Keys PD lost your trail`;
  $('down-screen').classList.remove('hidden');
}
function recoverFromDown() {
  $('down-screen').classList.add('hidden');
  downKind = '';
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
  return targets;
}
function stageShot() {
  if (shotName === 'core') {
    startGame();
    enterCar(cars[0]);
    hud.showMessage('SOLARIS KEYS — free roam', 300, true);
  } else if (shotName === 'chase') {
    startGame();
    money = 15250;
    rep = 650;
    const car = cars[2];
    car.group.position.set(-26, 0, 0);
    car.heading = Math.PI / 2;
    car.group.rotation.y = Math.PI / 2;
    enterCar(car);
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
  } else if (shotName === 'foot') {
    startGame();
    player.group.position.set(-52, 0, 78);
    player.heading = -Math.PI / 6;
    player.group.rotation.y = -Math.PI / 6;
    missions.snoozeBriefing(30);
  } else if (shotName === 'mission') {
    startGame();
    missions.setCompleted(3);
    missions.forceStart(3);
    openMissionScreen();
  }
}
function update(dt) {
  if (input.pressed('Enter') && state === 'title' && !optionsOpen) startGame();
  if (input.pressed('Enter') && state === 'down') recoverFromDown();
  if (input.pressed('Enter') && phoneVisible && state === 'play') acceptBriefing();
  if (input.pressed('Escape')) {
    if (optionsOpen) closeOptions();
    else if (missionOpen) closeMissionScreen();
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
  elapsed += dt;
  if (wanted.stars === 0 && health < 50 && elapsed - lastHurtAt > 5) health = Math.min(50, health + dt * 3);
  if (input.pressed('KeyM') && !phoneVisible) {
    if (missionOpen) closeMissionScreen();
    else openMissionScreen();
  }
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
  if (input.pressed('KeyF')) {
    if (drivenCar) exitCar();
    else {
      const car = nearestCar(player.position);
      if (car) enterCar(car);
      else hud.showMessage('No car nearby — walk closer to one and press F');
    }
  }
  const autoDrive = (shotName === 'core' || shotName === 'chase') && drivenCar;
  const drivingInput = autoDrive
    ? { moveAxes: () => ({ forward: 1, strafe: 0 }), isDown: () => false }
    : input;
  if (drivenCar) {
    drivenCar.update(dt, drivingInput, city, weather.grip);
    chaseCamera.update(dt, drivenCar.position, drivenCar.heading, true, input, combat.recoil, police.helicopter ? 2 : 0);
    if (drivenCar.skidding) {
      const backX = drivenCar.position.x - Math.sin(drivenCar.heading) * 1.4;
      const backZ = drivenCar.position.z - Math.cos(drivenCar.heading) * 1.4;
      effects.puffSmoke(backX, 0.4, backZ);
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
        money += bonus;
        hud.showMessage(`DRIFT x${driftChain} +$${bonus}`, 1.2);
      }
    } else {
      skidSeconds = 0;
      driftChain = 0;
    }
  } else {
    player.update(dt, input, chaseCamera.yaw, city);
    chaseCamera.update(dt, player.position, player.heading, false, input, combat.recoil, police.helicopter ? 2 : 0);
  }
  city.update(dt);
  effects.update(dt);
  if (input.pressed('Space') || input.tap) {
    if (!drivenCar) {
      player.heading = Math.atan2(-Math.sin(chaseCamera.yaw), -Math.cos(chaseCamera.yaw));
      player.group.rotation.y = player.heading;
    }
    const origin = drivenCar ? drivenCar.position : player.position;
    const aim = drivenCar ? drivenCar.heading + Math.PI : chaseCamera.yaw;
    const result = combat.tryShoot(origin, aim, combatTargets());
    if (result === 'empty') hud.showMessage('NO AMMO — finish a mission to restock');
    else if (result === 'reloading') hud.showMessage('RELOADING…');
  }
  combat.update(dt, player.position);
  const obstacles = [];
  if (drivenCar) obstacles.push({ x: drivenCar.position.x, z: drivenCar.position.z });
  for (const npc of traffic.cars) obstacles.push({ x: npc.car.position.x, z: npc.car.position.z });
  for (const position of police.allCarPositions()) obstacles.push(position);
  traffic.update(dt, obstacles);
  if (drivenCar && Math.abs(drivenCar.speed) > PEDESTRIAN_HIT_MIN_SPEED) {
    for (const ped of pedestrians.peds) {
      if (ped.knockedTimer > 0) continue;
      const pos = ped.mesh.group.position;
      if (Math.hypot(pos.x - drivenCar.position.x, pos.z - drivenCar.position.z) < PEDESTRIAN_HIT_RANGE) {
        pedestrians.knockDown(ped, drivenCar.position.x, drivenCar.position.z);
        const crime = wanted.commitCrime('hitPedestrian');
        hud.showMessage(crime || 'PEDESTRIAN HIT!');
      }
    }
  }
  if (drivenCar) {
    for (const npc of traffic.cars) {
      const gap = Math.hypot(npc.car.position.x - drivenCar.position.x, npc.car.position.z - drivenCar.position.z);
      if (gap < 3) {
        traffic.shove(npc);
        drivenCar.speed *= 0.55;
      } else if (gap < 5.5 && Math.abs(drivenCar.speed) > 20 && elapsed - nearMissAt > 3) {
        nearMissAt = elapsed;
        money += 100;
        hud.showMessage('NEAR MISS +$100', 1.2);
      }
    }
    for (const unit of police.roadblock) {
      if (Math.hypot(unit.car.position.x - drivenCar.position.x, unit.car.position.z - drivenCar.position.z) < 2.8) {
        drivenCar.speed *= 0.4;
        effects.burstSparks(drivenCar.position.x, 0.8, drivenCar.position.z, 4);
      }
    }
    if (Math.hypot(drivenCar.position.x - SPRAY_X, drivenCar.position.z - SPRAY_Z) < SPRAY_RANGE && money >= SPRAY_PRICE && (drivenCar.hp < 100 || wanted.stars > 0)) {
      money -= SPRAY_PRICE;
      drivenCar.hp = 100;
      drivenCar.burning = false;
      drivenCar.warned = false;
      wanted.setStars(0);
      hud.showMessage("PAY'N'SPRAY — car repaired, heat cleared ($200)", 3);
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
      if (Math.random() < POLICE_HIT_CHANCE) damagePlayer(POLICE_SHOT_DAMAGE);
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
  prevStars = wanted.stars;
  missions.update(dt, {
    playerPos: focus.position,
    drivenCar,
    cars,
    wantedStars: wanted.stars,
  });
  sideJobs.update(dt, { focusPos: focus.position, driving: Boolean(drivenCar) });
  weather.update(dt, focus.position);
  robbery.update(dt, { playerPos: focus.position });
  tapes.update(dt, focus.position, (count) => {
    money += 25;
    hud.showMessage(`SUNSET TAPE ${count}/${TAPE_COUNT} +$25`, 2);
  });
  dialogue.update();
  const briefing = missions.pendingBriefing;
  if (briefing && !phoneVisible && !missionOpen) {
    hud.showBriefing(briefing.mission, briefing.index);
    phoneVisible = true;
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
    eventBlip: robbery.blip,
    policeBlips: police.allCarPositions(),
    trafficBlips: traffic.cars.map((npc) => ({ x: npc.car.position.x, z: npc.car.position.z })),
    ammoCrates: combat.ammoCratesForHud(),
    timeSeconds: performance.now() / 1000,
  });
  if (!shotReady) {
    shotTimer += dt;
    const readyAt =
      shotName === 'core' ? SHOT_DRIVE_SECONDS : shotName === 'chase' ? SHOT_CHASE_SECONDS : shotName === 'foot' ? SHOT_FOOT_SECONDS : shotName === 'mission' ? SHOT_MISSION_SECONDS : Infinity;
    if (shotTimer >= readyAt) {
      shotReady = true;
      window.__shotReady = true;
    }
  }
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
        money += mission.rewardMoney;
        rep += mission.rewardRep;
        health = 100;
        if (index === 0) combat.unlockWeapon('pistol');
        if (repLevel() >= 3) combat.unlockWeapon('shotgun');
        combat.restock();
        if (mission.finale) {
          hud.showMessage(`KING OF THE KEYS — $${mission.rewardMoney.toLocaleString('en-US')} · THE KEYS ARE YOURS, ROOK`, 5, true);
        } else if (mission.rewardWeapon) {
          combat.unlockWeapon(mission.rewardWeapon);
          hud.showMessage(`MISSION COMPLETE — $${mission.rewardMoney.toLocaleString('en-US')} + SMG UNLOCKED`, 4, true);
        } else {
          hud.showMessage(`MISSION COMPLETE — $${mission.rewardMoney.toLocaleString('en-US')} + ${mission.rewardRep} REP${index === 0 ? ' + PISTOL UNLOCKED' : ''}`, 4, true);
        }
        audio.chime();
        dialogue.cue('done');
        saveGame(AUTOSAVE_SLOT, snapshotSave());
        if (index === MISSIONS_IN_STORY - 1) {
          freeObj = 'STORY COMPLETE — the Keys are yours. Free roam!';
        }
      },
    });
    effects = new Effects(scene);
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
        if (lethal) pedestrians.knockDown(ped, player.position.x, player.position.z, 20);
        else pedestrians.fleeFrom(ped, player.position.x, player.position.z);
        const crime = wanted.commitCrime('hitPedestrian');
        if (crime) hud.showMessage(crime, 2);
      },
      onHitCar(car) {
        damageCar(car, 12);
      },
      onAmmoPickup(district) {
        hud.showMessage(`AMMO RESTOCKED — ${district} crate`, 2.5);
        audio.click();
      },
      onHitGetaway() {
        robbery.shotByPlayer();
      },
    }, effects);
    audio = new GameAudio();
    chaseCamera = new ChaseCamera(camera);
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
        money += job.rewardMoney;
        rep += job.rewardRep;
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
          money += 500;
          rep += 50;
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
    const latestSlot = latestSaveSlot();
    if (latestSlot) {
      const saved = saveSlotSummaries()[latestSlot - 1];
      $('continue-button').classList.remove('hidden');
      $('continue-summary').textContent =
        `Saved game (slot ${latestSlot}): $${saved.money.toLocaleString('en-US')} · ${saved.missionsDone}/${MISSIONS_IN_STORY} missions done`;
    }
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