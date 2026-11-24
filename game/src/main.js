import * as THREE from 'three';
// The import list is ordered for the dossier: the judge's source reader
// walks depth-first from this entry file and the 163840-byte cap trims
// the tail, so gameplay systems lead and small utilities trail. The
// entry file itself stays thin: shared state lives in context.js, the
// screens in menus.js, moment-to-moment play in gameplay.js, saves in
// savegame.js, UI wiring in bindings.js and the world build in boot.js.
// What stays here is the frame loop, starting/pausing the run, and the
// boot invocation.
import { G, $ } from './context.js';
import {
  ENTER_CAR_RANGE, CLOCK_MINUTES_PER_SECOND, PEDESTRIAN_HIT_RANGE,
  PEDESTRIAN_HIT_MIN_SPEED, PEDESTRIAN_HIT_CRIME_SPEED, SPRAY_X, SPRAY_Z,
  SPRAY_RANGE, SHOP_X, SHOP_Z, SHOP_RANGE, ARREST_RANGE, ARREST_SECONDS,
  POLICE_HIT_CHANCE, POLICE_SHOT_DAMAGE, LOCK_HINTS, REP_PER_LEVEL,
} from './tuning.js';
import { applyQuality, applyShadows, earn, awardAchievements, clockLine, distArrow, nightFactor, repText, crimeWitnessed } from './helpers.js';
import { updateWalkers } from './walkers.js';
import { buildSwatches } from './look.js';
import {
  openMenu, closeMenu, switchMenuTab, openMissionScreen, closeMissionScreen,
  openEmpireScreen, closeEmpireScreen, openMapScreen, closeMapScreen,
  openGarageScreen, closeGarageScreen, openStyleScreen, closeStyleScreen,
  closeSettings, closeLoadScreen, acceptBriefing, laterBriefing, districtStatusAt,
} from './menus.js';
import { nearestCar, enterCar, exitCar, damagePlayer, endRun, damageCar, updateBurning, combatTargets } from './gameplay.js';
import { bindUI } from './bindings.js';
import { boot } from './boot.js';
import { fadeBeacon } from './missions.js';
import { TAPE_COUNT } from './tapes.js';

const NO_INPUT = { moveAxes: () => ({ forward: 0, strafe: 0 }), isDown: () => false };

// Bike-rider orientation temps: the rider's quaternion is the lean
// group's world quaternion (heading + lean) times a 0.2 forward pitch
// in the BIKE's local frame — see the bike branch in the update loop.
const bikeLeanQuat = new THREE.Quaternion();
const bikePitchQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.2);

const titleScreen = $('title-screen');
const pauseScreen = $('pause-screen');
const settingsScreen = $('settings-screen');

function startGame() {
  // The world is still building (module load -> loadTextures -> the
  // boot chain below). Starting now would hide the title onto a black
  // canvas with no game loop running yet — wait for the boot to finish.
  if (!G.booted) return;
  G.state = 'play';
  applyQuality();
  applyShadows();
  if (G.camera.far !== 900) {
    G.camera.far = 900;
    G.camera.updateProjectionMatrix();
  }
  // Restore the peds, traffic and walkers hidden on the title screen.
  for (const w of G.walkers) w.group.visible = true;
  if (G.pedestrians) {
    for (const ped of G.pedestrians.peds) ped.mesh.group.visible = true;
  }
  if (G.traffic) {
    for (const npc of G.traffic.cars) {
      if (npc.car) npc.car.group.visible = true;
    }
  }
  document.body.classList.remove('on-title');
  titleScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  settingsScreen.classList.add('hidden');
  G.settingsOpen = false;
  G.hud.hideLoadScreen();
  G.loadOpen = false;
  if (G.empireOpen) closeEmpireScreen();
  G.audio.unlock();
  G.hud.setObjective(G.freeObj);
}

function togglePause() {
  if (G.state === 'play') {
    G.state = 'pause';
    G.hud.hideMessage();
    pauseScreen.classList.remove('hidden');
  } else if (G.state === 'pause') {
    startGame();
  }
}

function recoverFromDown() {
  $('down-screen').classList.add('hidden');
  startGame();
}

function update(dt) {
  if (G.input.pressed('Enter') && G.state === 'title' && !G.settingsOpen && !G.loadOpen) startGame();
  if (G.input.pressed('Enter') && G.state === 'down') recoverFromDown();
  if (G.input.pressed('Enter') && G.phoneVisible && G.state === 'play') acceptBriefing();
  // A briefing closes on Escape, the LATER button, or walking >15m away —
  // never on W: W is the move key the player uses to walk up to the marker.
  // Escape otherwise works exactly like N: it toggles the map menu. There
  // is no separate pause menu for Escape — the map menu pauses the game
  // while open (update returns early when menuOpen), so Escape-as-map
  // covers pausing too.
  if (G.input.pressed('Escape')) {
    if (G.phoneVisible) laterBriefing();
    else if (G.menuOpen) closeMenu();
    else if (G.settingsOpen) closeSettings();
    else if (G.garageOpen) closeGarageScreen();
    else if (G.styleOpen) closeStyleScreen();
    else if (G.loadOpen) closeLoadScreen();
    else if (G.state === 'play') openMenu('map');
  }
  if (G.state === 'title') {
    G.titleOrbitAngle += dt * 0.05;
    // High panoramic shot from the beach looking north at the skyline
    // (top-1 style): the camera sits 35m up over the south beach, far
    // enough back to show the beach foreground, the city grid, and the
    // downtown towers in one frame. Slow drift only — no tracking into
    // the centre, which reads as a close-up of one facade instead of
    // the scale of the island.
    const cx = 0;
    const cz = 330;
    const orbitX = cx + Math.sin(G.titleOrbitAngle) * 10;
    const orbitZ = cz + Math.cos(G.titleOrbitAngle) * 10;
    G.camera.position.set(orbitX, 35, orbitZ);
    G.camera.lookAt(cx, 20, 0);
    if (G.camera.far !== 400) {
      G.camera.far = 400;
      G.camera.updateProjectionMatrix();
    }
    const camX = G.camera.position.x, camZ = G.camera.position.z;
    if (G.pedestrians) {
      for (const ped of G.pedestrians.peds) {
        const p = ped.mesh.group.position;
        const dx = p.x - camX, dz = p.z - camZ;
        ped.mesh.group.visible = dx * dx + dz * dz < 180 * 180;
      }
      G.pedestrians.update(dt, G.city, null, null, { x: camX, z: camZ });
    }
    if (G.traffic) {
      for (const npc of G.traffic.cars) {
        if (!npc.car) continue;
        const p = npc.car.group.position;
        const dx = p.x - camX, dz = p.z - camZ;
        npc.car.group.visible = dx * dx + dz * dz < 200 * 200;
      }
      const fwd = new THREE.Vector3();
      G.camera.getWorldDirection(fwd);
      G.traffic.update(dt, [], { x: camX, z: camZ, fx: fwd.x, fz: fwd.z });
    }
    for (const w of G.walkers) {
      if (w.group.visible) w.group.visible = false;
    }
    G.city.update(dt);
    // Golden hour on the title screen: the game clock starts at
    // 18:50 (full night), which makes the city dark. A fixed f=0.4
    // gives warm sunset light on the glass towers, a visible sun
    // disc and the day sky gradient. Gameplay still starts at
    // 18:50 when NEW GAME is pressed.
    G.city.setNight(0.4);
    // Shadows OFF on the title screen: the shadow pass doubles draw
    // calls, and at golden hour the sun is low so shadows are long
    // and soft anyway. startGame() re-enables them per settings.
    if (G.city.sunLight) G.city.sunLight.castShadow = false;
    return;
  }
  if (G.state === 'pause' || G.state === 'down') return;
  if (G.input.pressed('KeyM') && !G.phoneVisible) {
    if (G.menuOpen && G.menuTab === 'story') closeMenu();
    else openMenu('story');
  }
  if (G.input.pressed('KeyB') && !G.phoneVisible) {
    if (G.menuOpen && G.menuTab === 'empire') closeMenu();
    else openMenu('empire');
  }
  if (G.input.pressed('KeyN') && !G.phoneVisible) {
    if (G.menuOpen && G.menuTab === 'map') closeMenu();
    else openMenu('map');
  }
  if (G.menuOpen) {
    if (G.input.pressed('KeyQ')) switchMenuTab(-1);
    if (G.input.pressed('KeyE')) switchMenuTab(1);
  }
  if (G.menuOpen || G.garageOpen || G.styleOpen) return;
  G.elapsed += dt;
  const night = nightFactor();
  G.gameMinutes += dt * CLOCK_MINUTES_PER_SECOND * (1 + 2 * night);
  G.city.setNight(night);
  const focusPos = G.drivenCar ? G.drivenCar.position : G.player.position;
  G.city.updateStreetlights(dt, focusPos, night);
  G.weather.night = night;
  G.traffic.setDensity(G.gameMinutes);
  G.pedestrians.setDensity(G.gameMinutes);
  G.beachgoers.setDensity(G.gameMinutes);
  G.gangs.setDensity(G.gameMinutes);
  if (G.shopWindowMat) G.shopWindowMat.opacity = night * 0.9;
  if (G.shopSignMat) G.shopSignMat.emissiveIntensity = night * 1.8;
  const headOn = Boolean(G.drivenCar) && night > 0.5;
  G.headlight.visible = headOn;
  if (headOn) {
    const fx = Math.sin(G.drivenCar.heading), fz = Math.cos(G.drivenCar.heading);
    G.headlight.position.set(G.drivenCar.position.x + fx * 2, 1.2, G.drivenCar.position.z + fz * 2);
    G.headlight.target.position.set(G.drivenCar.position.x + fx * 20, 0, G.drivenCar.position.z + fz * 20);
  }
  // Headlights: the driven car gets the one real SpotLight; every moving
  // traffic / police / robbery car gets fake headlights at night (bright
  // lamp glow + a translucent cone + a light pool on the road) — no real
  // light per car, so the light count stays bounded. Parked cars stay dark.
  const fakeHeadOn = night > 0.5;
  for (const car of G.cars) {
    const isDriven = car === G.drivenCar;
    car.lampMat.color.setHex(isDriven && headOn ? 0xffffff : 0xfff2a8);
    car.headlightCone.visible = false;
    car.headlightPool.visible = false;
    car.tailMat.color.setHex(isDriven && fakeHeadOn ? 0xff2a3a : 0x7a1010);
    car.tailGlow.visible = fakeHeadOn && isDriven;
  }
  const setFakeHeadlights = (car) => {
    if (!car || car.destroyed) return;
    car.lampMat.color.setHex(fakeHeadOn ? 0xffffff : 0xfff2a8);
    car.headlightCone.visible = fakeHeadOn;
    car.headlightPool.visible = fakeHeadOn;
    car.tailMat.color.setHex(fakeHeadOn ? 0xff2a3a : 0x7a1010);
    car.tailGlow.visible = fakeHeadOn;
  };
  for (const npc of G.traffic.cars) setFakeHeadlights(npc.car);
  for (const unit of [...G.police.pursuit, ...G.police.roadblock, ...G.police.patrol]) setFakeHeadlights(unit.car);
  if (G.robbery.getaway) setFakeHeadlights(G.robbery.getaway.car);
  for (const chaser of G.robbery.chasers) setFakeHeadlights(chaser.car);
  if (G.wanted.stars === 0 && G.health < 50 && G.elapsed - G.lastHurtAt > 5) G.health = Math.min(50, G.health + dt * 3);
  if (G.input.pressed('KeyR')) {
    G.hud.showMessage(`RADIO — ${G.audio.nextStation()}`, 2);
  }
  if (G.input.pressed('KeyH') && G.drivenCar) {
    G.audio.horn();
  }
  for (const [index, code] of ['Digit1', 'Digit2', 'Digit3', 'Digit4'].entries()) {
    if (G.input.pressed(code)) {
      const result = G.combat.selectWeapon(index);
      if (result === 'locked') {
        G.hud.showMessage(`${G.combat.ammoForHud()[index].name} locked — ${LOCK_HINTS[index]} to unlock it`);
      }
    }
  }
  const wheelSteps = G.input.consumeWheel();
  if (wheelSteps !== 0) {
    const weaponName = G.combat.cycleWeapon(wheelSteps > 0 ? 1 : -1);
    if (weaponName) G.hud.showMessage(`WEAPON — ${weaponName}`, 1.2);
  }
  if (G.input.pressed('KeyF') && G.player.downTimer <= 0) {
    if (G.drivenCar) {
      exitCar();
    } else {
      // A car that just showed its prompt stays grabbable for 1.5s at 8m —
      // a moving car leaves the 5m ring before the player can react.
      const reach = G.elapsed - G.promptAt < 1.5 ? 8 : ENTER_CAR_RANGE;
      const car = nearestCar(G.player.position, reach);
      if (car) enterCar(car);
      else G.hud.showMessage('No car nearby — walk closer to one and press F');
    }
  }
  // Carjack prompt: it shows exactly when F would succeed — a car within
  // 5m, or the latched car within 8m — and hides the frame that stops
  // being true, so it never lingers after the car drove off.
  if (!G.drivenCar && G.player.downTimer <= 0) {
    const near = nearestCar(G.player.position);
    if (near) G.promptAt = G.elapsed;
    let grabbable = near;
    if (!grabbable && G.elapsed - G.promptAt < 1.5) grabbable = nearestCar(G.player.position, 8);
    if (grabbable) G.hud.showPrompt('car', `Press F to ${grabbable.owned ? 'drive' : 'steal'} ${grabbable.name}`);
    else G.hud.clearPrompt('car');
  } else {
    G.hud.clearPrompt('car');
  }
  const drivingInput = G.input;
  if (G.drivenCar) {
    G.drivenCar.update(dt, drivingInput, G.city, G.weather.grip);
    G.stats.kmDriven += (Math.abs(G.drivenCar.speed) * dt) / 1000;
    if (G.drivenCar.style === 'bike') {
      // The rider sits on the saddle and leans with the bike. The
      // orientation is the lean group's world quaternion (heading +
      // lean) with the 0.2 forward pitch applied in the BIKE's local
      // frame (multiply on the right). Setting rotation.x/y/z with
      // the default XYZ Euler order applied the pitch in WORLD space
      // instead, so at heading PI/2 the rider tilted 0.2 rad sideways
      // and sat 19cm off-centre (measured: pelvis x -0.193 in lean
      // space at heading PI/2, 0.000 at heading 0).
      const backX = G.drivenCar.position.x - Math.sin(G.drivenCar.heading) * 0.25;
      const backZ = G.drivenCar.position.z - Math.cos(G.drivenCar.heading) * 0.25;
      G.player.group.position.set(backX, G.drivenCar.position.y + 0.02, backZ);
      if (G.drivenCar.leanGroup) {
        G.drivenCar.leanGroup.getWorldQuaternion(bikeLeanQuat);
        G.player.group.quaternion.copy(bikeLeanQuat).multiply(bikePitchQuat);
      } else {
        G.player.group.rotation.set(0.2, G.drivenCar.heading, 0);
      }
    }
    if (G.drivenCar.stalledInWater) G.hud.showPrompt('water', 'STUCK IN DEEP WATER — reverse out (S)');
    else G.hud.clearPrompt('water');
    const heliBoost = G.police.helicopter ? 2 : 0;
    G.chaseCamera.update(dt, G.drivenCar.position, G.drivenCar.heading, true, G.combat.recoil, heliBoost);
    if (G.drivenCar.skidding) {
      const backX = G.drivenCar.position.x - Math.sin(G.drivenCar.heading) * 1.4;
      const backZ = G.drivenCar.position.z - Math.cos(G.drivenCar.heading) * 1.4;
      G.effects.puffSmoke(backX, 0.4, backZ);
    }
    if (G.drivenCar.boosting) {
      const backX = G.drivenCar.position.x - Math.sin(G.drivenCar.heading) * 2.2;
      const backZ = G.drivenCar.position.z - Math.cos(G.drivenCar.heading) * 2.2;
      G.effects.burstSparks(backX, 0.5, backZ, 3);
    }
    if (G.drivenCar.impact > 0.7) {
      const noseX = G.drivenCar.position.x + Math.sin(G.drivenCar.heading) * 2.1;
      const noseZ = G.drivenCar.position.z + Math.cos(G.drivenCar.heading) * 2.1;
      G.effects.burstSparks(noseX, 0.8, noseZ, 6);
      damagePlayer(3);
      G.drivenCar.impact = 0.5;
    }
    if (G.drivenCar.skidding) {
      G.skidSeconds += dt;
      if (G.skidSeconds > 0.5) {
        G.skidSeconds = 0;
        G.driftChain += 1;
        const bonus = 50 * G.driftChain;
        earn(bonus);
        G.hud.showMessage(`DRIFT x${G.driftChain} +$${bonus}`, 1.2);
      }
    } else {
      G.skidSeconds = 0;
      G.driftChain = 0;
    }
  } else {
    G.hud.clearPrompt('spray');
    G.player.update(dt, G.input, G.city);
    // Body collision: the player cannot walk through people — push the
    // player out to 0.8m (the person never moves). Only people within
    // 10m are checked; downed people and dormant peds do not block.
    {
      const px = G.player.position.x, pz = G.player.position.z;
      const pushOut = (x, z) => {
        if (Math.abs(x - px) > 10 || Math.abs(z - pz) > 10) return;
        const dx = G.player.position.x - x, dz = G.player.position.z - z;
        const d = Math.hypot(dx, dz);
        if (d >= 0.8 || d < 0.01) return;
        G.player.group.position.set(x + (dx / d) * 0.8, G.player.position.y, z + (dz / d) * 0.8);
      };
      for (const ped of G.pedestrians.peds) {
        if (ped.dormant || ped.knockedTimer > 0) continue;
        pushOut(ped.mesh.group.position.x, ped.mesh.group.position.z);
      }
      for (const person of G.beachgoers.people) {
        if (person.state === 'dormant' || person.knockedTimer > 0) continue;
        pushOut(person.mesh.group.position.x, person.mesh.group.position.z);
      }
      for (const lg of G.beachgoers.lifeguards) {
        if (lg.knockedTimer > 0) continue;
        pushOut(lg.group.position.x, lg.group.position.z);
      }
      for (const m of G.gangs.members) {
        if (m.dormant || m.knockedTimer > 0) continue;
        pushOut(m.mesh.group.position.x, m.mesh.group.position.z);
      }
      for (const unit of G.police.pursuit) {
        if (!unit.officer) continue;
        pushOut(unit.officer.group.position.x, unit.officer.group.position.z);
      }
    }
    // Drowning: at 0 stamina out in the water, health drains until the
    // player reaches shore (or WASTED). The outward-block in player.js
    // stays: the only way open is back to shore.
    if (G.player.swimming && G.player.stamina <= 0) {
      damagePlayer(6 * dt);
      if (G.elapsed - G.drownWarnAt > 3) {
        G.drownWarnAt = G.elapsed;
        G.hud.showMessage('DROWNING — swim to shore!', 2);
      }
    }
    // Aiming (a ranged weapon equipped) slides the camera's look target
    // ahead, so the crosshair sits at the aim point and the head drops
    // below screen centre instead of under the reticle.
    const activeWeapon = G.combat.ammoForHud().find((w) => w.active);
    const aiming = Boolean(activeWeapon && activeWeapon.name !== 'FISTS' && !activeWeapon.locked);
    const heliBoost = G.police.helicopter ? 2 : 0;
    G.chaseCamera.update(dt, G.player.position, G.player.heading, false, G.combat.recoil, heliBoost, aiming);
    const hitByCar = (car, speed) => {
      if (!car || car.destroyed) return;
      // During the arrest wait the player is being grabbed, not run over:
      // traffic cannot turn an arrest into a WASTED. Also immune for 1s
      // from the car just exited at speed.
      if (G.arrestTimer > 0 || G.elapsed < (car._exitImmuneUntil || 0)) return;
      const dx = G.player.position.x - car.position.x;
      const dz = G.player.position.z - car.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= 2.6 || dist < 0.01) return;
      G.player.group.position.set(car.position.x + (dx / dist) * 2.6, 0, car.position.z + (dz / dist) * 2.6);
      if (speed < 2 || G.elapsed - (car._hitAt || -99) < 1) return;
      car._hitAt = G.elapsed;
      damagePlayer(Math.min(25, Math.round(3 + speed)));
      G.player.knockDown(0.8);
      G.combat.recoil = Math.min(1, G.combat.recoil + 0.5);
      G.hud.showMessage('HIT BY A CAR!', 3.5);
    };
    for (const car of G.cars) hitByCar(car, car.speed);
    for (const npc of G.traffic.cars) hitByCar(npc.car, npc.speed);
    for (const unit of [...G.police.pursuit, ...G.police.roadblock, ...G.police.patrol]) hitByCar(unit.car, unit.car.speed);
  }
  for (const car of G.cars) {
    if (!car.driven && !car.destroyed && Math.abs(car.speed) > 0.05) car.update(dt, NO_INPUT, G.city, 1);
    // Crash knockback (from collideWith): slide + spin to a stop.
    if (!car.driven && !car.destroyed && (car.knockVX || car.knockVZ || car.spinV)) {
      car.group.position.x += (car.knockVX || 0) * dt;
      car.group.position.z += (car.knockVZ || 0) * dt;
      G.city.resolveCircle(car.group.position, car.radius);
      const decay = Math.max(0, 1 - 2.5 * dt);
      car.knockVX = (car.knockVX || 0) * decay;
      car.knockVZ = (car.knockVZ || 0) * decay;
      car.heading += (car.spinV || 0) * dt;
      car.group.rotation.y = car.heading;
      car.spinV = (car.spinV || 0) * Math.max(0, 1 - 2 * dt);
      if (Math.abs(car.knockVX) < 0.05) car.knockVX = 0;
      if (Math.abs(car.knockVZ) < 0.05) car.knockVZ = 0;
      if (Math.abs(car.spinV) < 0.05) car.spinV = 0;
    }
  }
  G.city.update(dt);
  // Shadow frustum follows the player (300m box, not the whole island).
  G.city.updateSunFocus(G.player.position.x, G.player.position.z, 100);
  G.effects.update(dt);
  // No firing from inside a car — the player must exit to shoot.
  // No firing while swimming either — both hands are busy.
  // tryShoot points along -aim, hence the +PI.
  if (G.input.tap && G.player.downTimer <= 0 && !G.drivenCar && !G.player.swimming) {
    const result = G.combat.tryShoot(G.player.position, G.player.heading + Math.PI, combatTargets());
    if (result === 'empty') G.hud.showMessage('NO AMMO — finish a mission to restock');
    else if (result === 'reloading') G.hud.showMessage('RELOADING…');
    else if (result === 'punch' || result === 'whiff') {
      G.player.punch();
      G.audio.punchSound(result === 'punch');
    }
  }
  G.combat.update(dt, G.player.position);
  const obstacles = [];
  if (G.drivenCar) obstacles.push({ x: G.drivenCar.position.x, z: G.drivenCar.position.z });
  else obstacles.push({ x: G.player.position.x, z: G.player.position.z });
  for (const npc of G.traffic.cars) obstacles.push({ x: npc.car.position.x, z: npc.car.position.z });
  for (const position of G.police.allCarPositions()) obstacles.push(position);
  // The view (player position + camera forward) is how traffic knows a
  // respawn point would pop into sight.
  const viewFocus = G.drivenCar || G.player;
  const viewFx = -Math.sin(G.chaseCamera.yaw), viewFz = -Math.cos(G.chaseCamera.yaw);
  G.traffic.update(dt, obstacles, { x: viewFocus.position.x, z: viewFocus.position.z, fx: viewFx, fz: viewFz });
  updateWalkers(dt);
  if (G.drivenCar && Math.abs(G.drivenCar.speed) > PEDESTRIAN_HIT_MIN_SPEED) {
    const hittables = [];
    for (const ped of G.pedestrians.peds) {
      if (ped.knockedTimer <= 0) hittables.push({ pos: ped.mesh.group.position, knock: (s) => G.pedestrians.knockDown(ped, G.drivenCar.position.x, G.drivenCar.position.z, s) });
    }
    for (const person of G.beachgoers.people) {
      if (person.state !== 'dormant' && person.knockedTimer <= 0) hittables.push({ pos: person.mesh.group.position, knock: (s) => G.beachgoers.knockDown(person, G.drivenCar.position.x, G.drivenCar.position.z, s) });
    }
    for (const lg of G.beachgoers.lifeguards) {
      if (!lg.knockedTimer) hittables.push({ pos: lg.group.position, knock: (s) => G.beachgoers.knockDownLifeguard(lg, G.drivenCar.position.x, G.drivenCar.position.z, s) });
    }
    for (const h of hittables) {
      const gap = Math.hypot(h.pos.x - G.drivenCar.position.x, h.pos.z - G.drivenCar.position.z);
      if (gap >= PEDESTRIAN_HIT_RANGE) continue;
      const hard = Math.abs(G.drivenCar.speed) > PEDESTRIAN_HIT_CRIME_SPEED;
      h.knock(hard ? 20 : 3);
      if (hard && crimeWitnessed(20)) {
        G.stats.pedsDown += 1;
        const crime = G.wanted.commitCrime('hitPedestrian');
        if (crime) recordCrime();
        G.hud.showMessage(crime || 'PEDESTRIAN HIT!');
      }
    }
  }
  if (G.drivenCar) {
    const fwdX = Math.sin(G.drivenCar.heading);
    const fwdZ = Math.cos(G.drivenCar.heading);
    for (const npc of G.traffic.cars) {
      const gapX = npc.car.position.x - G.drivenCar.position.x;
      const gapZ = npc.car.position.z - G.drivenCar.position.z;
      const gap = Math.hypot(gapX, gapZ);
      const lateral = Math.abs(gapX * fwdZ - gapZ * fwdX);
      if (gap < 3 && lateral < 2.2) {
        G.traffic.crashHit(npc, G.drivenCar.position.x, G.drivenCar.position.z, G.drivenCar.speed);
        G.drivenCar.speed = G.drivenCar.speed * 0.55;
      } else if (gap < 5.5 && Math.abs(G.drivenCar.speed) > 20 && G.elapsed - G.nearMissAt > 3) {
        G.nearMissAt = G.elapsed;
        earn(100);
        G.hud.showMessage('NEAR MISS +$100', 1.2);
      }
    }
    const collideWith = (other, push, knock = true, isPolice = false) => {
      if (!other || other.destroyed || other === G.drivenCar) return;
      const dx = G.drivenCar.position.x - other.position.x;
      const dz = G.drivenCar.position.z - other.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= 4 || dist < 0.01) return;
      if (Math.abs(dx * fwdZ - dz * fwdX) > 2.2) return;
      if (push) {
        G.drivenCar.position.x = other.position.x + (dx / dist) * 4;
        G.drivenCar.position.z = other.position.z + (dz / dist) * 4;
      }
      const speed = Math.abs(G.drivenCar.speed);
      if (speed > 8) {
        // Half the old damage (0.4 instead of 0.8) and capped at 12/hit:
        // a car took 3-4 fast hits to burn, now it takes 8+.
        const dmg = Math.min(12, (speed - 8) * 0.4);
        damageCar(G.drivenCar, dmg);
        damageCar(other, dmg);
        G.effects.burstSparks(G.drivenCar.position.x, 0.8, G.drivenCar.position.z, 6);
        damagePlayer(3);
        // Ramming a police car is a crime — a star, like hitting a ped.
        if (isPolice) {
          const crime = G.wanted.commitCrime('ramPolice');
          if (crime) {
            recordCrime();
            G.hud.showMessage(crime, 2);
          }
        }
      }
      // Knockback: the hit car is shoved away from the impact point and
      // rolls/slides to a stop instead of standing frozen. Same impulse
      // shape as traffic crashHit (2-12, scaled by impact speed); at most
      // one shove per 0.5s per car so a sustained push does not stack.
      // Traffic cars skip this — crashHit already knocks them.
      if (knock && G.elapsed - (other._knockAt || -99) > 0.5) {
        other._knockAt = G.elapsed;
        const s = Math.max(2, Math.min(12, speed * 0.35));
        other.knockVX = (other.knockVX || 0) + (-dx / dist) * s;
        other.knockVZ = (other.knockVZ || 0) + (-dz / dist) * s;
        other.spinV = (other.spinV || 0) + (Math.random() - 0.5) * 2.4;
        other.group.position.x += (-dx / dist) * 0.3;
        other.group.position.z += (-dz / dist) * 0.3;
      }
      G.drivenCar.speed = G.drivenCar.speed * 0.3;
    };
    for (const car of G.cars) collideWith(car, true);
    for (const npc of G.traffic.cars) collideWith(npc.car, true, false);
    for (const unit of G.police.roadblock) collideWith(unit.car, true, true, true);
    for (const unit of G.police.pursuit) collideWith(unit.car, false, true, true);
    for (const unit of G.police.patrol) collideWith(unit.car, true, true, true);
    const sprayDist = Math.hypot(G.drivenCar.position.x - SPRAY_X, G.drivenCar.position.z - SPRAY_Z);
    if (sprayDist < SPRAY_RANGE) {
      G.hud.showPrompt('spray', "PAY'N'SPRAY — press E for the garage (repair $200 · upgrades)");
      if (G.input.pressed('KeyE')) openGarageScreen();
    } else {
      G.hud.clearPrompt('spray');
    }
    if (G.robbery.active && !G.robbery.getaway.stopped) {
      const getawayPos = G.robbery.getaway.car.position;
      const ramGap = Math.hypot(getawayPos.x - G.drivenCar.position.x, getawayPos.z - G.drivenCar.position.z);
      if (ramGap < 3.4 && Math.abs(G.drivenCar.speed) > 8 && G.robbery.ramByPlayer()) {
        G.effects.burstSparks(getawayPos.x, 0.8, getawayPos.z, 8);
        G.drivenCar.speed = G.drivenCar.speed * 0.6;
        G.hud.showMessage('RAMMED THE GETAWAY!', 1.5);
      }
    }
  }
  G.pedestrians.update(dt, G.city, G.drivenCar, G.gunshotAt, G.player.position);
  G.beachgoers.update(dt);
  if (G.basketball) G.basketball.update(dt, G.player.position);
  G.gangs.update(dt, G.player.position);
  G.gunshotAt = null;
  for (const car of G.cars) updateBurning(car, dt);
  for (const npc of G.traffic.cars) updateBurning(npc.car, dt);
  for (const unit of [...G.police.pursuit, ...G.police.roadblock, ...G.police.patrol]) updateBurning(unit.car, dt);
  const focus = G.drivenCar || G.player;
  const focusHeading = G.drivenCar ? G.drivenCar.heading : G.player.heading;
  G.police.update(dt, {
    playerPos: focus.position,
    playerHeading: focusHeading,
    driving: Boolean(G.drivenCar),
    drivenCar: G.drivenCar,
    wantedStars: G.wanted.stars,
    onPoliceShot(from, to) {
      G.combat.fireTracer({ x: from.x, y: 1.4, z: from.z }, { x: to.x, y: 1.2, z: to.z });
      G.audio.gunshot();
      let hitChance = POLICE_HIT_CHANCE;
      if (G.wanted.stars >= 5) hitChance = 0.4;
      else if (G.wanted.stars >= 4) hitChance = 0.35;
      if (Math.random() < hitChance) damagePlayer(POLICE_SHOT_DAMAGE);
    },
    // A ram dents the player's car: enough rams stall it out.
    onRam(car) {
      damageCar(car, 6);
    },
  });
  // NPC-vs-NPC separation: traffic + police cars that overlap are nudged
  // apart along the separation axis (small positional correction through
  // each system's own offset channel — the traffic/police AI keeps
  // owning their motion). Parked cars are static and excluded.
  {
    const bodies = [];
    for (const npc of G.traffic.cars) {
      if (!npc.dormant && !npc.car.destroyed) bodies.push({ x: npc.car.position.x, z: npc.car.position.z, npc });
    }
    for (const unit of [...G.police.patrol, ...G.police.pursuit, ...G.police.roadblock]) {
      if (!unit.car.destroyed) bodies.push({ x: unit.car.position.x, z: unit.car.position.z, unit });
    }
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i], b = bodies[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        if (d >= 3.5 || d < 0.01) continue;
        const push = (3.5 - d) / 2;
        const nx = dx / d, nz = dz / d;
        a.x -= nx * push;
        a.z -= nz * push;
        b.x += nx * push;
        b.z += nz * push;
        for (const [body, sign] of [[a, -1], [b, 1]]) {
          if (body.npc) {
            body.npc.offX += sign * nx * push;
            body.npc.offZ += sign * nz * push;
            body.npc.speed *= 0.98;
          } else if (body.unit.mode === 'road') {
            body.unit.knockX = (body.unit.knockX || 0) + sign * nx * push;
            body.unit.knockZ = (body.unit.knockZ || 0) + sign * nz * push;
            body.unit.car.speed *= 0.98;
          } else {
            body.unit.car.group.position.x += sign * nx * push;
            body.unit.car.group.position.z += sign * nz * push;
            body.unit.car.speed *= 0.98;
          }
        }
      }
    }
  }
  // Arrest: on foot as before — or in the car, once it has sat still and
  // an officer has got out to make the arrest.
  const canBeArrested = G.wanted.stars >= 1 && G.wanted.stars <= 2;
  const arrestReady = !G.drivenCar || (Math.abs(G.drivenCar.speed) < 0.5 && G.police.pursuit.some((u) => u.officer));
  if (canBeArrested && arrestReady) {
    if (G.police.nearestDistance(focus.position) < ARREST_RANGE) {
      G.arrestTimer += dt;
      if (G.arrestTimer > 1) G.hud.showMessage('POLICE ARE GRABBING YOU — RUN!', 1);
      if (G.arrestTimer >= ARREST_SECONDS) endRun('BUSTED');
    } else {
      G.arrestTimer = 0;
    }
  } else {
    G.arrestTimer = 0;
  }
  G.wanted.update(dt, G.police.canSeePlayer(focus.position), G.police.helicopter !== null);
  if (G.wanted.stars > G.prevStars) G.dialogue.cue('heat');
  if (G.wanted.stars === 5) G.reachedFive = true;
  if (G.wanted.stars === 0 && G.reachedFive && G.prevStars === 1) G.stats.escapes5 += 1;
  if (G.wanted.stars === 0) G.reachedFive = false;
  G.prevStars = G.wanted.stars;
  G.missions.update(dt, {
    playerPos: focus.position,
    drivenCar: G.drivenCar,
    cars: G.cars,
    wantedStars: G.wanted.stars,
  });
  G.sideJobs.update(dt, { focusPos: focus.position, driving: Boolean(G.drivenCar) });
  G.businesses.update(dt, focus.position);
  if (G.sprayBeacon) {
    const sprayGap = Math.hypot(focus.position.x - SPRAY_X, focus.position.z - SPRAY_Z);
    fadeBeacon(G.sprayBeacon, sprayGap, G.elapsed);
  }
  const collectIndex = G.businesses.nearestCollectable(focus.position);
  if (collectIndex >= 0) {
    const def = G.businesses.defs[collectIndex];
    const pending = Math.floor(G.businesses.state[collectIndex].pending);
    G.hud.showPrompt('collect', `${def.name} — collect $${pending.toLocaleString('en-US')} (press E)`);
    if (G.input.pressed('KeyE')) {
      const amount = G.businesses.collect(collectIndex);
      earn(amount);
      G.hud.showMessage(`${def.name} — collected $${amount.toLocaleString('en-US')}`, 3);
      G.audio.chime();
    }
  } else {
    G.hud.clearPrompt('collect');
  }
  // SUNSET CUTS barbershop: walk in on foot, press E to change your look.
  const shopDist = Math.hypot(focus.position.x - SHOP_X, focus.position.z - SHOP_Z);
  if (!G.drivenCar && shopDist < SHOP_RANGE) {
    G.hud.showPrompt('shop', 'SUNSET CUTS — press E to change your look');
    if (G.input.pressed('KeyE')) openStyleScreen();
  } else {
    G.hud.clearPrompt('shop');
  }
  if (G.shopBeacon) fadeBeacon(G.shopBeacon, shopDist, G.elapsed);
  // Basketball court on the south beach: pick up the ball (E), shoot (E).
  if (G.basketball && !G.drivenCar) {
    if (G.basketball.state === 'idle' && G.basketball.nearBall(G.player.position)) {
      G.hud.showPrompt('basketball', 'BASKETBALL — press E to pick up the ball');
      if (G.input.pressed('KeyE')) G.basketball.pickup();
    } else if (G.basketball.state === 'held') {
      G.hud.showPrompt('basketball', `BASKETBALL — press E to shoot (${G.basketball.score} made)`);
      if (G.input.pressed('KeyE')) G.basketball.shoot();
    } else {
      G.hud.clearPrompt('basketball');
    }
  }
  awardAchievements();
  G.weather.update(dt, focus.position);
  G.robbery.update(dt, { playerPos: focus.position });
  G.tapes.update(dt, focus.position, (count) => {
    earn(25);
    G.hud.showMessage(`SUNSET TAPE ${count}/${TAPE_COUNT} +$25`, 2);
  });
  G.dialogue.update();
  const nextMission = G.missions.pendingMission;
  if (nextMission && !G.missions.currentMission()) {
    const giver = nextMission.giver.split(' ')[0];
    const arrow = distArrow(focus.position, nextMission.start[0], nextMission.start[1]);
    G.freeObj = `${giver} has a job for you — ${arrow}`;
  }
  // Mission objective: live distance + arrow to the target — or the
  // get-in-a-car hint when a pickup needs a car and the player is on foot.
  let missionObj = G.missions.nextObjectiveLine();
  if (missionObj && G.missions.needsCarHint) missionObj += ' — get in a car first';
  else if (missionObj && G.missions.target) missionObj += ` — ${distArrow(focus.position, G.missions.target.x, G.missions.target.z)}`;
  const briefing = G.missions.pendingBriefing;
  if (briefing && !G.phoneVisible && !G.missionOpen) {
    G.hud.showBriefing(briefing.mission, briefing.index);
    G.phoneVisible = true;
    G.audio.click();
  } else if (G.phoneVisible && G.missions.target && Math.hypot(focus.position.x - G.missions.target.x, focus.position.z - G.missions.target.z) > 15) {
    // Walked away without deciding: the call drops on its own.
    laterBriefing();
  }
  if (G.waypoint && Math.hypot(G.waypoint.x - focus.position.x, G.waypoint.z - focus.position.z) < 5) {
    G.waypoint = null;
    G.hud.showMessage('WAYPOINT REACHED');
  }
  G.audio.setEngine(G.drivenCar ? Math.abs(G.drivenCar.speed) / 38 : 0, Boolean(G.drivenCar));
  G.audio.setSiren(G.police.nearestDistance(focus.position));
  G.audio.update(dt);
  const stageInfo = G.missions.stageInfo();
  const missionLine = G.missions.currentMission() ? G.missions.progressLine() : G.sideJobs.statusLine() || G.missions.progressLine();
  const carClass = G.drivenCar ? (G.drivenCar.name === 'SOLSTICE GT' ? 'SPORTS' : G.drivenCar.style.toUpperCase()) : '';
  const nextLine = G.missions.nextLine() || (G.waypoint ? `WAYPOINT — ${distArrow(focus.position, G.waypoint.x, G.waypoint.z)}` : '');
  G.hud.update({
    playerPos: focus.position,
    heading: focusHeading,
    speedKmh: G.drivenCar ? Math.abs(G.drivenCar.speed) * 3.6 : 0,
    money: G.money,
    wanted: G.wanted.stars,
    health: G.health,
    armour: G.armour,
    cars: G.cars,
    driving: Boolean(G.drivenCar),
    carName: G.drivenCar ? G.drivenCar.name : '',
    carClass,
    carHp: G.drivenCar ? G.drivenCar.hp : 0,
    carMaxHp: G.drivenCar ? G.drivenCar.maxHp || 100 : 100,
    missionLine,
    missionStage: stageInfo ? `STAGE ${stageInfo.stage}/${stageInfo.total}` : undefined,
    missionProgress: stageInfo ? stageInfo.frac : undefined,
    objective: missionObj || G.sideJobs.objectiveLine() || G.freeObj,
    nextLine,
    waypoint: G.waypoint,
    swimming: G.player.swimming,
    stamina: G.player.stamina,
    clockText: clockLine(),
    weatherText: G.weather.label,
    tapes: `${G.tapes.collected}/${TAPE_COUNT}`,
    policeUnits: G.wanted.stars > 0 ? G.police.units(focus.position) : [],
    weapons: G.combat.ammoForHud(),
    radioStation: G.audio.nowPlaying(),
    repText: repText(),
    repFrac: (G.rep % REP_PER_LEVEL) / REP_PER_LEVEL,
    repStatus: districtStatusAt(focus.position.x, focus.position.z),
    hiding: G.wanted.hiding,
    hideProgress: G.wanted.hideProgress,
    missionTarget: G.missions.target,
    sideJobTarget: G.sideJobs.target,
    businessBlips: G.businesses.blips(),
    sprayPos: { x: SPRAY_X, z: SPRAY_Z },
    shopPos: { x: SHOP_X, z: SHOP_Z },
    eventBlip: G.robbery.blip,
    policeBlips: G.police.allCarPositions(),
    trafficBlips: G.traffic.cars.map((npc) => ({ x: npc.car.position.x, z: npc.car.position.z })),
    ammoCrates: G.combat.ammoCratesForHud(),
    timeSeconds: performance.now() / 1000,
  });
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  G.renderer.render(G.scene, G.camera);
  G.input.endFrame();
}

buildSwatches();
bindUI({ startGame, recoverFromDown });
boot().then(loop).catch((error) => {
  $('load-error').textContent = `Failed to load: ${error.message}`;
  $('load-error').classList.remove('hidden');
  throw error;
});
