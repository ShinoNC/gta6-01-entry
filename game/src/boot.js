// Boot: the async world build that runs after the module loads. Textures
// load first, then the city, traffic and pedestrians, missions, and the
// remaining systems, yielding a frame between the heavy phases so the
// title paints and the loading label updates instead of one long frozen
// block. The 28 MB of GLBs load async with placeholders and never block
// this chain. When the build finishes, boot enables the title buttons,
// publishes window.__game (the debug/staging handle) and resolves — the
// entry file starts the game loop from there.
import * as THREE from 'three';
import { G, $, nextFrame, setBootPhase } from './context.js';
import { SPAWN_X, SPAWN_Z, SPRAY_X, SPRAY_Z, SHOP_X, SHOP_Z, GUNSHOT_WITNESS_RANGE } from './tuning.js';
import { buildCity, districtNameAt, signMaterialFor } from './city.js';
import { createPlayer } from './player.js';
import { createCars } from './vehicles.js';
import { Traffic } from './traffic.js';
import { Pedestrians } from './pedestrians.js';
import { Beachgoers } from './beach.js';
import { Basketball } from './basketball.js';
import { Gangs } from './gangs.js';
import { Wanted } from './wanted.js';
import { Police } from './police.js';
import { Missions, MISSIONS_IN_STORY, buildBeacon } from './missions.js';
import { Effects } from './effects.js';
import { Businesses } from './business.js';
import { Combat } from './combat.js';
import { GameAudio } from './audio.js';
import { ChaseCamera } from './camera.js';
import { Hud } from './hud.js';
import { Dialogue } from './dialogue.js';
import { Tapes } from './tapes.js';
import { SideJobs } from './sidejobs.js';
import { Weather } from './weather.js';
import { Robbery } from './robbery.js';
import { loadTextures } from './textures.js';
import { earn, repLevel, recordCrime, crimeWitnessed, applySettings, applyQuality, awardAchievements } from './helpers.js';
import { damagePlayer, damageCar, endRun } from './gameplay.js';
import { openMenu, closeMenu, mapScreenState } from './menus.js';
import { snapshotSave, applySave } from './savegame.js';
import { applyLook } from './look.js';
import { saveGame, loadGame, latestSaveSlot, loadLook } from './save.js';

async function boot() {
  const loaded = await loadTextures();
  G.textures = loaded;
  // Yield between the heavy phases so the title paints and the
  // loading label updates instead of one 10s+ frozen block. The
  // 28 MB of GLBs load async with placeholders and never block
  // this chain; the lag was the synchronous world build.
  setBootPhase('LOADING CITY…');
  await nextFrame();
  G.city = buildCity(G.scene, G.textures, G.rng);
  G.sprayBeacon = buildBeacon(G.scene, 0x2ad0c4);
  G.sprayBeacon.group.position.set(SPRAY_X, 0, SPRAY_Z);
  G.sprayBeacon.group.visible = true;
  // SUNSET CUTS barbershop: a small pink storefront with a barber pole
  // and a beacon. Its windows glow at night like the buildings'.
  const shopGroup = new THREE.Group();
  const shopBody = new THREE.Mesh(
    new THREE.BoxGeometry(4, 3.5, 3),
    new THREE.MeshLambertMaterial({ color: 0xff5aa8 }),
  );
  shopBody.position.y = 1.75;
  shopBody.castShadow = true;
  shopBody.receiveShadow = true;
  shopGroup.add(shopBody);
  const poleColours = [0xff2a3a, 0xffffff, 0xff2a3a, 0xffffff, 0xff2a3a];
  for (let i = 0; i < 5; i += 1) {
    const ring = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.4, 8),
      new THREE.MeshLambertMaterial({ color: poleColours[i] }),
    );
    ring.position.y = 0.6 + i * 0.4;
    ring.position.x = -1.5;
    ring.position.z = -1;
    shopGroup.add(ring);
  }
  shopGroup.position.set(SHOP_X, 0, SHOP_Z);
  G.scene.add(shopGroup);
  G.city.buildingBoxes.push({ minX: SHOP_X - 2, maxX: SHOP_X + 2, minZ: SHOP_Z - 1.5, maxZ: SHOP_Z + 1.5 });
  G.shopBeacon = buildBeacon(G.scene, 0xff5aa8);
  G.shopBeacon.group.position.set(SHOP_X, 0, SHOP_Z);
  G.shopBeacon.group.visible = true;
  G.shopWindowMat = new THREE.MeshBasicMaterial({ color: 0xffd978, transparent: true, opacity: 0 });
  for (const wx of [-1, 1]) {
    const shopWindow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.2), G.shopWindowMat);
    shopWindow.position.set(SHOP_X + wx, 1.8, SHOP_Z - 1.53);
    shopWindow.rotation.y = Math.PI;
    G.scene.add(shopWindow);
  }
  G.shopSignMat = signMaterialFor('SUNSET CUTS');
  const shopSign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), G.shopSignMat);
  shopSign.position.set(SHOP_X, 3.0, SHOP_Z - 1.53);
  shopSign.rotation.y = Math.PI;
  G.scene.add(shopSign);
  setBootPhase('LOADING TRAFFIC…');
  await nextFrame();
  G.player = createPlayer(G.scene, SPAWN_X, SPAWN_Z);
  G.cars = createCars(G.scene, G.textures);
  G.cars[0].owned = true;
  G.traffic = new Traffic(G.scene, G.textures, G.rng);
  G.pedestrians = new Pedestrians(G.scene, G.rng, () => {
    const cries = ['AHH!', 'SOMEBODY HELP!', 'RUN!'];
    G.hud.showMessage(cries[Math.floor(Math.random() * 3)], 1.5);
  });
  G.beachgoers = new Beachgoers(G.scene, G.rng);
  G.basketball = new Basketball(G.scene, G.rng, (n) => G.hud.showMessage(`SWISH! ${n} basket${n === 1 ? '' : 's'}`, 2));
  for (const box of G.basketball.colliders()) G.city.buildingBoxes.push(box);
  G.gangs = new Gangs(G.scene, G.rng, {
    onTaunt(text) { G.hud.showMessage(text, 2.5); },
    onPunch(damage) { damagePlayer(damage); },
  });
  G.wanted = new Wanted();
  G.police = new Police(G.scene, G.textures, G.city, G.rng);
  setBootPhase('LOADING MISSIONS…');
  await nextFrame();
  G.missions = new Missions(G.scene, {
    onScriptedHeat(stars) {
      G.wanted.setStars(Math.max(G.wanted.stars, stars));
      G.hud.showMessage(`THE HEAT IS ON — ${G.wanted.stars} stars on you`, 3);
    },
    onMissionStarted(mission, index) {
      G.freeObj = mission.objectives[0].label;
      G.hud.showMessage(`MISSION ${index + 1}/${MISSIONS_IN_STORY} — ${mission.name}`, 3);
      G.dialogue.cue('go');
    },
    onObjectiveComplete() {
      G.audio.click();
    },
    onMissionComplete(mission, index) {
      earn(mission.rewardMoney);
      G.rep = G.rep + mission.rewardRep;
      G.health = 100;
      if (index === 0) G.combat.unlockWeapon('pistol');
      if (repLevel() >= 3) G.combat.unlockWeapon('shotgun');
      G.combat.restock();
      const rewardLine = `+$${mission.rewardMoney.toLocaleString('en-US')} · +${mission.rewardRep} REP`;
      if (mission.finale) {
        G.hud.showPassed('KING OF THE KEYS', mission.name, [rewardLine, 'THE KEYS ARE YOURS, ROOK']);
      } else if (mission.rewardWeapon) {
        G.combat.unlockWeapon(mission.rewardWeapon);
        G.hud.showPassed('MISSION PASSED', mission.name, [rewardLine, 'SMG UNLOCKED']);
      } else {
        const bonus = index === 0 ? 'PISTOL UNLOCKED' : '';
        G.hud.showPassed('MISSION PASSED', mission.name, [rewardLine, bonus]);
      }
      G.audio.chime();
      G.dialogue.cue('done');
      saveGame(G.activeSlot, snapshotSave());
      if (index === MISSIONS_IN_STORY - 1) {
        G.freeObj = 'STORY COMPLETE — the Keys are yours. Free roam!';
      }
      const next = G.missions.pendingMission;
      if (next) {
        const giver = next.giver.split(' ')[0];
        G.hud.showMessage(`${giver} has a job for you — head to the gold marker`, 6);
      }
    },
  });
  G.effects = new Effects(G.scene);
  G.businesses = new Businesses(G.scene);
  G.combat = new Combat(G.scene, {
    los: (from, to) => G.police.hasLineOfSight(from, to),
    onShot() {
      G.audio.gunshot();
      G.gunshotAt = { x: G.player.position.x, z: G.player.position.z };
      G.pedestrians.scareFrom(G.player.position.x, G.player.position.z, 28);
      // Gunfire earns a star only when witnessed — police in line of
      // sight, or a ped close enough to hear it (gunshots carry: 30m,
      // wider than the 20m carjacking witness radius). Firing alone
      // in the open earns nothing.
      const witness = G.police.canSeePlayer(G.player.position) || G.pedestrians.peds.some((ped) => {
        if (ped.dormant || ped.knockedTimer > 0) return false;
        const px = ped.mesh.group.position.x - G.player.position.x;
        const pz = ped.mesh.group.position.z - G.player.position.z;
        return Math.hypot(px, pz) < GUNSHOT_WITNESS_RANGE;
      });
      if (witness) {
        const crime = G.wanted.commitCrime('shoot');
        if (crime) {
          recordCrime();
          G.hud.showMessage(`${crime} — witness called it in`, 2);
        }
      }
    },
    onHitPedestrian(ped, lethal) {
      if (ped.beach) {
        // Beachgoer or lifeguard: a hit knocks them down (3s for a
        // punch, 20s for a gunshot); beachgoers flee when they get up.
        const seconds = lethal ? 20 : 3;
        if (ped.lifeguard) G.beachgoers.knockDownLifeguard(ped.lifeguard, G.player.position.x, G.player.position.z, seconds);
        else G.beachgoers.knockDown(ped, G.player.position.x, G.player.position.z, seconds);
        if (lethal) G.stats.pedsDown = G.stats.pedsDown + 1;
      } else if (ped.gang !== undefined) {
        G.gangs.onAttacked(ped, lethal);
        if (lethal) G.stats.pedsDown = G.stats.pedsDown + 1;
      } else if (lethal) {
        G.pedestrians.knockDown(ped, G.player.position.x, G.player.position.z, 20);
        G.stats.pedsDown = G.stats.pedsDown + 1;
      } else {
        G.pedestrians.fleeFrom(ped, G.player.position.x, G.player.position.z);
      }
      // Only a lethal hit earns a star — and only when witnessed.
      // A punch just makes the ped flee.
      if (lethal && crimeWitnessed(20)) {
        const crime = G.wanted.commitCrime('hitPedestrian');
        if (crime) {
          recordCrime();
          G.hud.showMessage(crime, 2);
        }
      }
    },
    onHitCar(car, damage) {
      damageCar(car, damage || 12);
    },
    onDamage(worldPos, amount) {
      const v = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z).project(G.camera);
      if (v.z > 1) return;
      const sx = (v.x * 0.5 + 0.5) * window.innerWidth;
      const sy = (-v.y * 0.5 + 0.5) * window.innerHeight;
      G.hud.spawnDamageNumber(sx, sy, `-${amount}`);
    },
    onAmmoPickup(district) {
      G.armour = Math.min(100, G.armour + 50);
      G.hud.showMessage(`AMMO + ARMOUR RESTOCKED — ${district} crate`, 2.5);
      G.audio.click();
    },
    onHitGetaway() {
      G.robbery.shotByPlayer();
    },
    onHitHelicopter(_ref, damage) {
      const heli = G.police.helicopter;
      const pos = heli ? { x: heli.group.position.x, z: heli.group.position.z } : null;
      if (G.police.damageHelicopter(damage || 12) && pos) {
        G.effects.burstSparks(pos.x, 8, pos.z, 24);
        G.effects.puffSmoke(pos.x, 8, pos.z, 8);
        G.audio.gunshot();
        G.stats.helisDown = G.stats.helisDown + 1;
        G.hud.showMessage('HELICOPTER DOWN!', 4, true);
        G.wanted.setStars(Math.min(5, G.wanted.stars + 1));
        recordCrime();
      }
    },
  }, G.effects);
  G.combat.setPlayer(G.player);
  setBootPhase('LOADING WORLD…');
  await nextFrame();
  G.audio = new GameAudio();
  applySettings();
  G.chaseCamera = new ChaseCamera(G.camera);
  G.chaseCamera.city = G.city; // camera pulls in when a building blocks the view
  G.hud = new Hud(G.city);
  G.hud.onWaypoint = (x, z) => {
    G.waypoint = { x, z };
    G.hud.showMessage('WAYPOINT SET');
    G.hud.renderMapScreen(mapScreenState());
  };
  G.dialogue = new Dialogue(G.hud);
  G.tapes = new Tapes(G.scene, G.rng);
  G.sideJobs = new SideJobs(G.scene, G.rng, {
    onOffered(job) {
      const spot = districtNameAt(job.pickup.x, job.pickup.z);
      const line = job.type === 'taxi' ? `TAXI FARE SPOTTED — pick up at ${spot}` : `DELIVERY FOUND — package at ${spot}`;
      G.hud.showMessage(line, 4);
    },
    onNeedCar() {
      G.hud.showMessage('Get in a car to pick up the fare', 2.5);
    },
    onPickedUp(job) {
      const spot = districtNameAt(job.dropoff.x, job.dropoff.z);
      const line = job.type === 'taxi' ? `FARE ON BOARD — drop at ${spot}` : `PACKAGE COLLECTED — deliver to ${spot}`;
      G.hud.showMessage(line, 3);
    },
    onComplete(job) {
      earn(job.rewardMoney);
      G.rep = G.rep + job.rewardRep;
      G.stats.jobsDone = G.stats.jobsDone + 1;
      const label = job.type === 'taxi' ? 'FARE DELIVERED' : 'DELIVERY COMPLETE';
      G.hud.showMessage(`${label} — $${job.rewardMoney} + ${job.rewardRep} REP`, 4, true);
      G.audio.chime();
    },
  });
  G.weather = new Weather(G.scene, G.rng);
  G.robbery = new Robbery(G.scene, G.textures, G.city, G.rng, G.police, {
    onStart() {
      G.hud.showMessage('BANK ROBBERY — Stop the getaway car! $500 REWARD', 5, true);
      G.dialogue.say('pd', 'All units: bank robbery in progress. Black sedan fleeing — intercept it.', 5);
    },
    onStopped(byPlayer) {
      if (byPlayer) {
        earn(500);
        G.rep = G.rep + 50;
        G.stats.robberiesStopped = G.stats.robberiesStopped + 1;
        G.hud.showMessage('GETAWAY STOPPED — $500 REWARD + 50 REP', 5, true);
        G.audio.chime();
      } else {
        G.hud.showMessage('POLICE CAUGHT THE GETAWAY — no reward for you', 4, true);
      }
    },
    onEscaped() {
      G.hud.showMessage('THE GETAWAY ESCAPED', 5, true);
    },
  });
  G.robbery.prewarm();
  G.hud.setObjective('Press ENTER or click NEW GAME to play');
  G.activeSlot = latestSaveSlot() || 1;
  applyLook(loadLook() || {});
  // No blocking model preload: on slow connections even the reduced
  // 9 MB title set takes ~10s. Models already started loading when
  // buildCity ran (swapInGlb + the tower module preload) and keep
  // streaming behind the title — by the time the player presses NEW
  // GAME most have arrived, and a hitch on the static title screen
  // matters far less than a 10s wait before it appears.
  // Boot complete: the game loop starts below, so the title buttons
  // are safe to use now. The title orbit renders at pixel ratio 1:
  // it is a backdrop behind the UI overlay, so full resolution is
  // wasted fill rate on mobile — startGame() restores the quality
  // preset when play begins.
  G.booted = true;
  // Title uses the quality preset's pixel ratio, not 1: forcing 1
  // on a high-DPI phone upscales the image 2-3x and looks blurry.
  applyQuality();
  $('start-button').textContent = 'NEW GAME';
  $('start-button').disabled = false;
  $('load-button').disabled = false;
  window.__game = {
    scene: G.scene,
    camera: G.camera,
    renderer: G.renderer,
    get state() {
      return G.state;
    },
    get player() {
      return G.player;
    },
    get cars() {
      return G.cars;
    },
    get drivenCar() {
      return G.drivenCar;
    },
    get money() {
      return G.money;
    },
    get rep() {
      return G.rep;
    },
    get health() {
      return G.health;
    },
    damagePlayer,
    damageCar,
    endRun,
    setMoney(v) {
      G.money = v;
    },
    setRep(v) {
      G.rep = v;
    },
    traffic: G.traffic,
    pedestrians: G.pedestrians,
    get walkers() {
      return G.walkers;
    },
    beachgoers: G.beachgoers,
    gangs: G.gangs,
    wanted: G.wanted,
    police: G.police,
    missions: G.missions,
    combat: G.combat,
    headlight: G.headlight,
    openMenu,
    closeMenu,
    recordCrime,
    get menuTab() {
      return G.menuTab;
    },
    get waypoint() {
      return G.waypoint;
    },
    shop: { x: SHOP_X, z: SHOP_Z },
    dialogue: G.dialogue,
    tapes: G.tapes,
    sideJobs: G.sideJobs,
    weather: G.weather,
    robbery: G.robbery,
    audio: G.audio,
    effects: G.effects,
    businesses: G.businesses,
    input: G.input,
    chaseCamera: G.chaseCamera,
    get stats() {
      return G.stats;
    },
    get garage() {
      return G.garage;
    },
    get gameMinutes() {
      return G.gameMinutes;
    },
    setGameMinutes(v) {
      G.gameMinutes = v;
    },
    get achievements() {
      return G.unlockedAchievements;
    },
    earn,
    awardAchievements,
    hud: G.hud,
    save: { saveGame, loadGame },
    snapshotSave,
    applySave,
    heliOnScreen() {
      if (!G.police.helicopter) return null;
      const projected = G.police.helicopter.group.position.clone().project(G.camera);
      return { x: projected.x, y: projected.y, behind: projected.z > 1 };
    },
  };
}

export { boot };
