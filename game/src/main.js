// SOLARIS KEYS — game entry point. Wires the renderer, city, player, cars,
// camera, HUD and all phase-B systems together and runs the loop. States:
// title (orbiting camera), play, pause. F enters/exits the nearest car;
// stealing a car that is not yours raises the wanted level. The ?shot=
// query stages deterministic scenes for screenshots (see shots.json).
import * as THREE from 'three';
import { makeRng } from './random.js';
import { loadTextures } from './textures.js';
import { Input } from './input.js';
import { buildCity } from './city.js';
import { createPlayer } from './player.js';
import { createCars } from './vehicles.js';
import { ChaseCamera } from './camera.js';
import { Hud } from './hud.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Wanted } from './wanted.js';
import { Police } from './police.js';
import { Missions, MISSIONS_IN_STORY } from './missions.js';
import { Combat } from './combat.js';
import { GameAudio } from './audio.js';
import { Effects } from './effects.js';
import { saveGame, loadGame, saveSlotSummaries, latestSaveSlot } from './save.js';

const SPAWN_X = 0;
const SPAWN_Z = 0;
const START_MONEY = 1250;
const ENTER_CAR_RANGE = 5;
const SHOT_DRIVE_SECONDS = 3.2;
const SHOT_CHASE_SECONDS = 4;
const SHOT_FOOT_SECONDS = 2;
const SHOT_MISSION_SECONDS = 0.6;
const REP_PER_LEVEL = 200;
const AUTOSAVE_SLOT = 1;
const PEDESTRIAN_HIT_RANGE = 2.1;
const PEDESTRIAN_HIT_MIN_SPEED = 2;

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot') || '';
const seed = Number.parseInt(params.get('seed') || '1', 10) || 1;

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);

const input = new Input();
const rng = makeRng(seed);

let state = 'title';
let city;
let player;
let cars;
let chaseCamera;
let hud;
let traffic;
let pedestrians;
let wanted;
let police;
let missions;
let combat;
let audio;
let effects;
let drivenCar = null;
let money = START_MONEY;
let rep = 0;
let health = 100;
let armour = 0;
let soundOn = true;
let musicOn = true;
let titleOrbitAngle = 0;
let shotTimer = 0;
let shotReady = false;
let missionScreenOpen = false;
let optionsScreenOpen = false;
let phonePanelVisible = false;
let gunshotAt = null;
let freeRoamObjective = 'Explore Solaris Keys — press F near a car to drive it';

const titleScreen = document.getElementById('title-screen');
const pauseScreen = document.getElementById('pause-screen');
const optionsScreen = document.getElementById('options-screen');

function repLevel() {
  return 1 + Math.floor(rep / REP_PER_LEVEL);
}

function snapshotSave() {
  return {
    money,
    rep,
    missionsDone: missions.doneCount(),
    weaponsOwned: combat.ownedWeaponIds(),
    playerX: player.position.x,
    playerZ: player.position.z,
  };
}

function applySave(data) {
  money = data.money;
  rep = data.rep;
  missions.setCompleted(data.missionsDone);
  combat.setOwnedWeapons(data.weaponsOwned || ['fists', 'pistol']);
  player.group.position.set(data.playerX, 0, data.playerZ);
}

function startGame() {
  state = 'play';
  document.body.classList.remove('on-title');
  titleScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  optionsScreen.classList.add('hidden');
  optionsScreenOpen = false;
  audio.unlock();
  hud.setObjective(freeRoamObjective);
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
  optionsScreenOpen = true;
  refreshOptionsLabels();
}

function closeOptions() {
  optionsScreen.classList.add('hidden');
  optionsScreenOpen = false;
  titleScreen.classList.remove('hidden');
}

function refreshOptionsLabels() {
  document.getElementById('sound-toggle').textContent = `SOUND: ${soundOn ? 'ON' : 'OFF'}`;
  document.getElementById('music-toggle').textContent = `MUSIC: ${musicOn ? 'ON' : 'OFF'}`;
  document.getElementById('radio-option').textContent = `RADIO: ${audio.radioStationName()}`;
}

function openMissionScreen() {
  hud.renderMissionList(missions.statusList(), missions.stageIndex);
  hud.showMissionScreen();
  missionScreenOpen = true;
}

function closeMissionScreen() {
  hud.hideMissionScreen();
  missionScreenOpen = false;
}

function acceptBriefing() {
  const briefing = missions.pendingBriefing;
  if (!briefing) return;
  hud.hideBriefing();
  phonePanelVisible = false;
  missions.startMission(briefing.index);
}

document.getElementById('start-button').addEventListener('click', startGame);
document.getElementById('resume-button').addEventListener('click', startGame);
document.getElementById('restart-button').addEventListener('click', () => window.location.reload());
document.getElementById('options-button').addEventListener('click', openOptions);
document.getElementById('options-back').addEventListener('click', closeOptions);
document.getElementById('sound-toggle').addEventListener('click', () => {
  soundOn = !soundOn;
  audio.setSoundEnabled(soundOn);
  refreshOptionsLabels();
});
document.getElementById('music-toggle').addEventListener('click', () => {
  musicOn = !musicOn;
  audio.setMusicEnabled(musicOn);
  refreshOptionsLabels();
});
document.getElementById('radio-option').addEventListener('click', () => {
  audio.nextStation();
  refreshOptionsLabels();
});
document.getElementById('continue-button').addEventListener('click', () => {
  const slot = latestSaveSlot() || AUTOSAVE_SLOT;
  const data = loadGame(slot);
  if (data) applySave(data);
  startGame();
});
document.getElementById('save-button').addEventListener('click', () => {
  saveGame(AUTOSAVE_SLOT, snapshotSave());
  hud.showMessage('GAME SAVED — SLOT 1');
});
document.getElementById('missions-button').addEventListener('click', () => {
  startGame();
  openMissionScreen();
});
document.getElementById('mission-close-button').addEventListener('click', closeMissionScreen);
document.getElementById('mission-list').addEventListener('click', (event) => {
  const button = event.target.closest('.mission-accept');
  if (!button) return;
  const index = Number.parseInt(button.dataset.mission, 10);
  closeMissionScreen();
  hud.hideBriefing();
  phonePanelVisible = false;
  missions.startMission(index);
});
document.getElementById('phone-accept').addEventListener('click', acceptBriefing);
document.getElementById('phone-later').addEventListener('click', () => {
  hud.hideBriefing();
  phonePanelVisible = false;
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
  for (const car of cars) {
    const dx = car.position.x - position.x;
    const dz = car.position.z - position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < bestDist) {
      bestDist = dist;
      best = car;
    }
  }
  return best;
}

function enterCar(car) {
  drivenCar = car;
  car.driven = true;
  player.group.visible = false;
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

function combatTargets() {
  const targets = [];
  for (const ped of pedestrians.peds) {
    if (ped.knockedTimer > 0) continue;
    targets.push({ x: ped.mesh.group.position.x, z: ped.mesh.group.position.z, radius: 0.9, kind: 'pedestrian', ref: ped });
  }
  for (const car of cars) {
    targets.push({ x: car.position.x, z: car.position.z, radius: 2.2, kind: 'car', ref: car });
  }
  for (const npc of traffic.cars) {
    targets.push({ x: npc.car.position.x, z: npc.car.position.z, radius: 2.2, kind: 'car', ref: npc.car });
  }
  for (const unit of [...police.pursuit, ...police.roadblock]) {
    targets.push({ x: unit.car.position.x, z: unit.car.position.z, radius: 2.2, kind: 'police', ref: unit.car });
  }
  return targets;
}

// Screenshot scenes: 'core' drives up the main avenue; 'chase' stages
// mission 6 mid-pursuit at 3 stars in a stolen Sunset Coupe, so the cover
// proves stealing, the wanted level, the police response and the helicopter
// in one frame; 'foot' is on foot downtown with a crowd; 'mission' opens
// the story job list with three jobs done and mission 4 active.
function stageShot() {
  if (shotName === 'core') {
    startGame();
    enterCar(cars[0]);
    hud.showMessage('SOLARIS KEYS — free roam', 300, true);
  } else if (shotName === 'chase') {
    startGame();
    const car = cars[2];
    car.group.position.set(0, 0, 8);
    car.heading = Math.PI;
    car.group.rotation.y = Math.PI;
    enterCar(car);
    missions.forceStart(5);
    police.stageChase(car.position, car.heading);
    hud.showMessage('VEHICLE STOLEN: SUNSET COUPE — THE GETAWAY', 300, true);
  } else if (shotName === 'foot') {
    startGame();
    // At the Palm Row intersection, facing north up the avenue: the camera
    // looks down a long street of buildings, palms and traffic. The
    // fixer's first call is held back so the phone panel does not cover
    // the street in the shot.
    player.group.position.set(-52, 0, -52);
    player.heading = Math.PI;
    player.group.rotation.y = Math.PI;
    pedestrians.gatherNear(-52, -52, 8);
    missions.snoozeBriefing(30);
    hud.showMessage('PALM ROW — on foot', 300, true);
  } else if (shotName === 'mission') {
    startGame();
    missions.setCompleted(3);
    missions.forceStart(3);
    openMissionScreen();
  }
}

function update(dt) {
  if (input.pressed('Enter') && state === 'title' && !optionsScreenOpen) startGame();
  if (input.pressed('Enter') && phonePanelVisible && state === 'play') acceptBriefing();
  if (input.pressed('Escape')) {
    if (optionsScreenOpen) closeOptions();
    else if (missionScreenOpen) closeMissionScreen();
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
  if (state === 'pause') return;

  if (input.pressed('KeyM') && !phonePanelVisible) {
    if (missionScreenOpen) closeMissionScreen();
    else openMissionScreen();
  }
  if (input.pressed('KeyR')) {
    hud.showMessage(`RADIO — ${audio.nextStation()}`, 2);
  }
  if (input.pressed('KeyH') && drivenCar) {
    audio.horn();
  }
  for (const [index, code] of ['Digit1', 'Digit2', 'Digit3'].entries()) {
    if (input.pressed(code)) {
      const result = combat.selectWeapon(index);
      if (result === 'locked') hud.showMessage('SMG locked — complete MISSION 3 to unlock it');
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
    drivenCar.update(dt, drivingInput, city);
    chaseCamera.update(dt, drivenCar.position, drivenCar.heading, true, input, combat.recoil, police.helicopter ? 2 : 0);
    // Particles: hard steering at speed throws skid smoke from the rear
    // wheels, and a fresh collision flashes sparks at the nose.
    if (drivenCar.skidding) {
      const backX = drivenCar.position.x - Math.sin(drivenCar.heading) * 1.4;
      const backZ = drivenCar.position.z - Math.cos(drivenCar.heading) * 1.4;
      effects.puffSmoke(backX, 0.4, backZ);
    }
    if (drivenCar.impact > 0.7) {
      const noseX = drivenCar.position.x + Math.sin(drivenCar.heading) * 2.1;
      const noseZ = drivenCar.position.z + Math.cos(drivenCar.heading) * 2.1;
      effects.burstSparks(noseX, 0.8, noseZ, 6);
      drivenCar.impact = 0.5;
    }
  } else {
    player.update(dt, input, chaseCamera.yaw, city);
    chaseCamera.update(dt, player.position, player.heading, false, input, combat.recoil, police.helicopter ? 2 : 0);
  }
  city.update(dt);
  effects.update(dt);

  if (!drivenCar && (input.pressed('Space') || input.tap)) {
    player.heading = Math.atan2(-Math.sin(chaseCamera.yaw), -Math.cos(chaseCamera.yaw));
    player.group.rotation.y = player.heading;
    const result = combat.tryShoot(player.position, chaseCamera.yaw, combatTargets());
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
      if (Math.hypot(npc.car.position.x - drivenCar.position.x, npc.car.position.z - drivenCar.position.z) < 3) {
        traffic.shove(npc);
        drivenCar.speed *= 0.55;
      }
    }
  }
  pedestrians.update(dt, city, drivenCar, gunshotAt);
  gunshotAt = null;

  const focus = drivenCar || player;
  const focusHeading = drivenCar ? drivenCar.heading : player.heading;
  police.update(dt, {
    playerPos: focus.position,
    playerHeading: focusHeading,
    driving: Boolean(drivenCar),
    drivenCar,
    wantedStars: wanted.stars,
  });
  wanted.update(dt, police.canSeePlayer(focus.position), police.helicopter !== null);

  missions.update(dt, {
    playerPos: focus.position,
    drivenCar,
    cars,
    wantedStars: wanted.stars,
  });

  const briefing = missions.pendingBriefing;
  if (briefing && !phonePanelVisible && !missionScreenOpen) {
    hud.showBriefing(briefing.mission, briefing.index);
    phonePanelVisible = true;
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
    missionLine: missions.progressLine(),
    objective: missions.nextObjectiveLine() || freeRoamObjective,
    policeUnits: police.units(focus.position),
    weapons: combat.ammoForHud(),
    radioStation: audio.nowPlaying(),
    repLevel: repLevel(),
    hiding: wanted.hiding,
    hideProgress: wanted.hideProgress,
    missionTarget: missions.target,
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
    player = createPlayer(scene, SPAWN_X, SPAWN_Z);
    cars = createCars(scene, textures, rng);
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
        freeRoamObjective = mission.objectives[0].label;
        hud.showMessage(`MISSION ${index + 1}/${MISSIONS_IN_STORY} — ${mission.name}`, 3);
      },
      onObjectiveComplete() {
        audio.click();
      },
      onMissionComplete(mission, index) {
        money += mission.rewardMoney;
        rep += mission.rewardRep;
        combat.restock();
        if (mission.finale) {
          hud.showMessage(`KING OF THE KEYS — $${mission.rewardMoney.toLocaleString('en-US')} · THE KEYS ARE YOURS, ROOK`, 5, true);
        } else if (mission.rewardWeapon) {
          combat.unlockWeapon(mission.rewardWeapon);
          hud.showMessage(`MISSION COMPLETE — $${mission.rewardMoney.toLocaleString('en-US')} + SMG UNLOCKED`, 4, true);
        } else {
          hud.showMessage(`MISSION COMPLETE — $${mission.rewardMoney.toLocaleString('en-US')} + ${mission.rewardRep} REP`, 4, true);
        }
        audio.chime();
        saveGame(AUTOSAVE_SLOT, snapshotSave());
        if (index === MISSIONS_IN_STORY - 1) {
          freeRoamObjective = 'STORY COMPLETE — the Keys are yours. Free roam!';
        }
      },
    });
    effects = new Effects(scene);
    combat = new Combat(scene, {
      onShot() {
        audio.gunshot();
        gunshotAt = { x: player.position.x, z: player.position.z };
        pedestrians.scareFrom(player.position.x, player.position.z, 28);
        const crime = wanted.commitCrime('shoot');
        if (crime) hud.showMessage(crime, 2);
      },
      onHitPedestrian(ped) {
        pedestrians.fleeFrom(ped, player.position.x, player.position.z);
        const crime = wanted.commitCrime('hitPedestrian');
        if (crime) hud.showMessage(crime, 2);
      },
      onHitCar() {
        // Sparks already show the hit; no extra toast.
      },
      onAmmoPickup(district) {
        hud.showMessage(`AMMO RESTOCKED — ${district} crate`, 2.5);
        audio.click();
      },
    }, effects);
    audio = new GameAudio();
    chaseCamera = new ChaseCamera(camera);
    hud = new Hud(city);
    hud.setObjective('Press ENTER or click NEW GAME to play');
    const latestSlot = latestSaveSlot();
    if (latestSlot) {
      const saved = saveSlotSummaries()[latestSlot - 1];
      document.getElementById('continue-button').classList.remove('hidden');
      document.getElementById('continue-summary').textContent =
        `Saved game (slot ${latestSlot}): $${saved.money.toLocaleString('en-US')} · ${saved.missionsDone}/${MISSIONS_IN_STORY} missions done`;
    }
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
      traffic,
      pedestrians,
      wanted,
      police,
      missions,
      combat,
      audio,
      effects,
      hud,
      save: { saveGame, loadGame },
      snapshotSave,
      applySave,
      // Where the helicopter sits on screen (-1..1, 0 = centre), or null
      // when there is no helicopter: the verify script checks it is in
      // frame during the chase shot.
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
    document.getElementById('load-error').textContent = `Failed to load: ${error.message}`;
    document.getElementById('load-error').classList.remove('hidden');
    throw error;
  });
