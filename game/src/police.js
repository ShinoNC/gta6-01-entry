import * as THREE from 'three';
import { createCar, waterCap } from './vehicles.js';
import { buildWalkerMesh } from './pedestrians.js';
import { roadLines, headingFor } from './city.js';
import { pick, wrapAngle } from './random.js';

// Every police tuning number lives in this one table, grouped by the
// subsystem it belongs to. These are the live game values — the chase
// feel, the encirclement pressure and the helicopter all hang off them,
// so a value change here is a gameplay change, not a tidy-up.
const TUNE = {
  // A unit notices the player and may open fire inside this range.
  spotRange: 45,
  // Pursuit top speeds: base, four stars, five stars.
  cruise: 50,
  cruiseHot: 51,
  cruiseMax: 52,
  // How fast a pursuit car turns and accelerates.
  turnRate: 2.8,
  accel: 16,
  // Ramming: how close a unit must be, the pause after a hit, and the
  // drag a ram applies to the player's car.
  ramReach: 4.2,
  ramPause: 0.9,
  ramDrag: 3.0,
  // Close-in behaviour: drive straight at the player inside this range,
  // snap back onto a road once the player is further away than that.
  directWithin: 22,
  snapBeyond: 35,
  // Walking speed of an officer on foot.
  officerPace: 5,
  // Roadblocks form this far ahead of the player and are re-laid once
  // the player passes them, or after this many seconds.
  blockAhead: 45,
  blockRefresh: 25,
  // Units hang around this long after the heat dies before despawning.
  despawnAfter: 3,
  // Helicopter: hover distance ahead of the player, sweep width, height,
  // sweep period, hit points and respawn delay after a shoot-down.
  heliAhead: 22,
  heliSway: 5,
  heliHeight: 14,
  heliSweepSecs: 5,
  heliHealth: 60,
  heliReturn: 60,
};

// Radio callsigns, handed out in order while skipping ones already in
// use; the pool wraps around if every callsign is taken at once.
const CALLSIGNS = 'IBIS-43 GULL-1 TARPON-10 OSPREY-7 PELICAN-22 HERON-5 EGRET-9 TERN-3 STORK-8 CRANE-12 FALCON-6 OWL-4 RAVEN-11 HAWK-2 KESTREL-15 CONDOR-20'.split(' ');
const HELI_CALLSIGN = 'HELI-1';

// Pursuit cars per wanted level, indexed 0..5. Five stars has to feel
// like a full encirclement, so the count jumps to ten at the top.
const PURSUIT_BY_STARS = [0, 1, 2, 4, 6, 10];

function carsForStars(stars) {
  let index = stars;
  if (index < 0) index = 0;
  if (index > 5) index = 5;
  return PURSUIT_BY_STARS[index];
}

// VRPD livery artwork, drawn once and shared by every unit: white POLICE
// lettering with a navy outline (it reads on the white stripe, the blue
// body and the navy uniform alike) plus the department shield for the
// doors. Basic materials keep the lettering legible after dark.
let textMat = null;
let badgeMat = null;

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function buildTextMaterial() {
  const canvas = makeCanvas(512, 64);
  const ctx = canvas.getContext('2d');
  ctx.font = 'bold 52px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#1a2a6b';
  ctx.strokeText('POLICE', 256, 34);
  ctx.fillStyle = '#ffffff';
  ctx.fillText('POLICE', 256, 34);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true });
}

function buildBadgeMaterial() {
  const canvas = makeCanvas(64, 64);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1a2a6b';
  ctx.beginPath();
  const rim = [[32, 4], [58, 14], [58, 34]];
  ctx.moveTo(rim[0][0], rim[0][1]);
  for (let i = 1; i < rim.length; i += 1) ctx.lineTo(rim[i][0], rim[i][1]);
  ctx.quadraticCurveTo(58, 54, 32, 60);
  ctx.quadraticCurveTo(6, 54, 6, 34);
  ctx.lineTo(6, 14);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ffd978';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 15px "Courier New", monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('VRPD', 32, 32);
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true });
}

function liveryMaterials() {
  if (!textMat) {
    textMat = buildTextMaterial();
    badgeMat = buildBadgeMaterial();
  }
  return { text: textMat, badge: badgeMat };
}

// Flash glow texture, drawn once and shared by every unit: a white
// radial gradient (hot core fading to transparent) that the red/blue
// sprite materials tint. One texture serves both colours.
let glowTexture = null;

function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const canvas = makeCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
  grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.85)');
  grad.addColorStop(0.6, 'rgba(255, 255, 255, 0.28)');
  grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(canvas);
  return glowTexture;
}

export class Police {
  constructor(scene, textures, city, rng) {
    this.scene = scene;
    this.textures = textures;
    this.city = city;
    this.rng = rng;
    this.lines = roadLines();
    // Crossing coordinates per axis, used by the turn checks: the x
    // positions of the north-south roads and the z positions of the
    // east-west roads.
    this.crossX = [];
    this.crossZ = [];
    for (let i = 0; i < this.lines.length; i += 1) {
      const line = this.lines[i];
      if (line.axis === 'z') this.crossX.push(line.at);
      else this.crossZ.push(line.at);
    }
    this.pursuit = [];
    this.roadblock = [];
    this.roadblockCentre = null;
    this.roadblockTimer = 0;
    this.patrol = [];
    this.stallTimer = 0;
    this.stallCheck = 0;
    this.lastFocusX = 0;
    this.lastFocusZ = 0;
    this.helicopter = null;
    this.heliHp = TUNE.heliHealth;
    this.heliCooldown = 0;
    // Scratch vectors for the helicopter update: three fresh Vector3s a
    // frame fed the GC pauses that used to freeze the game.
    this._heliTarget = new THREE.Vector3();
    this._heliTo = new THREE.Vector3();
    this._heliUp = new THREE.Vector3(0, 1, 0);
    this.lostTimer = 0;
    this.clock = 0;
    this.callsignIndex = 0;
    this._unitSeq = 0;
    this.spawnTimer = 0;
    this.soldierPreloaded = false;
    this.soldierPreloadNext = 0;
  }

  update(dt, context) {
    this.clock += dt;
    const wantedStars = context.wantedStars;
    // Warm the soldier GLB cache at the first star so officers upgrade
    // from the cache instead of a cold load; retry every 5s on failure.
    if (wantedStars >= 1 && !this.soldierPreloaded && this.clock >= this.soldierPreloadNext) {
      this.soldierPreloadNext = this.clock + 5;
      import('./models_loader.js').then((loader) => loader.loadPerson('soldier')).then(() => { this.soldierPreloaded = true; }).catch(() => {});
    }
    this._pruneDestroyed();
    if (wantedStars === 0) {
      this.lostTimer += dt;
      if (this.lostTimer > TUNE.despawnAfter) this.clearAll();
    } else {
      this.lostTimer = 0;
    }
    const wantedPursuit = carsForStars(wantedStars);
    this._updateSpawning(dt, context, wantedPursuit);
    this.heliCooldown = Math.max(0, this.heliCooldown - dt);
    this._updateRoadblockAndHeli(dt, context, wantedStars);
    this._updateStall(dt, context, wantedStars);
    const blinkOn = Math.floor(this.clock * 2.8) % 2 === 0;
    const topSpeed = wantedStars >= 5 ? TUNE.cruiseMax : wantedStars >= 4 ? TUNE.cruiseHot : TUNE.cruise;
    this._drivePatrols(dt, context, blinkOn);
    this._drivePursuit(dt, context, topSpeed, blinkOn);
    for (let i = 0; i < this.roadblock.length; i += 1) {
      const unit = this.roadblock[i];
      this._flashUnit(unit, blinkOn);
      this.applyKnock(unit, dt);
    }
    this._driveHelicopter(dt, context);
  }

  _pruneDestroyed() {
    for (let i = 0; i < this.pursuit.length; i += 1) {
      const unit = this.pursuit[i];
      if (unit.car.destroyed && unit.officer) this.scene.remove(unit.officer.group);
    }
    const alive = [];
    for (let i = 0; i < this.pursuit.length; i += 1) {
      if (!this.pursuit[i].car.destroyed) alive.push(this.pursuit[i]);
    }
    this.pursuit = alive;
    const standing = [];
    for (let i = 0; i < this.roadblock.length; i += 1) {
      if (!this.roadblock[i].car.destroyed) standing.push(this.roadblock[i]);
    }
    this.roadblock = standing;
  }

  _updateSpawning(dt, context, wantedPursuit) {
    const playerPos = context.playerPos;
    const wantedStars = context.wantedStars;
    // Patrols cruise at 0 stars; when heat comes on, the nearest patrol
    // joins the pursuit before fresh units spawn in.
    if (wantedStars === 0) {
      while (this.patrol.length < 3) this.spawnPatrolCar(playerPos);
    }
    // One pursuit car per 0.4s, not all at once: spawning 10 cars in a
    // single frame (clone ~60 materials each + scene setup + first-frame
    // shader compile) froze the game the moment VRPD appeared.
    this.spawnTimer = Math.max(0, this.spawnTimer - dt);
    if (this.pursuit.length < wantedPursuit && this.spawnTimer <= 0) {
      const near = this.nearestPatrol(playerPos);
      if (near && near.dist < 90) this.convertPatrol(near.unit);
      else this.spawnPursuitCar(playerPos, 65);
      this.spawnTimer = 0.4;
    }
    if (wantedStars > 0 || this.lostTimer > TUNE.despawnAfter) {
      while (this.pursuit.length > wantedPursuit) this.removeUnit(this.pursuit.pop());
    }
  }

  _updateRoadblockAndHeli(dt, context, wantedStars) {
    const playerPos = context.playerPos;
    const playerHeading = context.playerHeading;
    if (wantedStars >= 3) {
      if (this.roadblock.length === 0) {
        this.placeRoadblock(playerPos, playerHeading, wantedStars);
      } else {
        this.roadblockTimer += dt;
        const fx = Math.sin(playerHeading);
        const fz = Math.cos(playerHeading);
        const passed = (playerPos.x - this.roadblockCentre.x) * fx + (playerPos.z - this.roadblockCentre.z) * fz > 8;
        if (passed || this.roadblockTimer > TUNE.blockRefresh) {
          this.placeRoadblock(playerPos, playerHeading, wantedStars);
        }
      }
      if (!this.helicopter && this.heliCooldown <= 0) {
        this.heliHp = TUNE.heliHealth;
        this.buildHelicopter();
      }
    } else {
      for (let i = 0; i < this.roadblock.length; i += 1) this.removeUnit(this.roadblock[i]);
      this.roadblock = [];
      this.roadblockCentre = null;
      this.removeHelicopter();
    }
  }

  _updateStall(dt, context, wantedStars) {
    // Stalled pursuit: if the player has not moved for 20s while wanted,
    // call in backup (one extra unit, then again every 10s, up to 6).
    const playerPos = context.playerPos;
    this.stallCheck += dt;
    if (this.stallCheck >= 1) {
      this.stallCheck = 0;
      const moved = Math.hypot(playerPos.x - this.lastFocusX, playerPos.z - this.lastFocusZ);
      if (wantedStars > 0 && moved < 1) this.stallTimer += 1;
      else this.stallTimer = 0;
      this.lastFocusX = playerPos.x;
      this.lastFocusZ = playerPos.z;
    }
    if (this.stallTimer >= 20 && this.pursuit.length < 6) {
      this.spawnPursuitCar(playerPos, 40);
      this.stallTimer = 10;
    }
  }

  // Blink the GLB light bar's own emissive lenses, alternating red and
  // blue. Materials resolve lazily: the GLB attaches async, so Em_Red
  // and Em_Blue only exist after load; the traverse runs until they are
  // found, then caches. A box-fallback car has no Em materials, so this
  // is a no-op for it. The GLB's own emissive colours are dark (red
  // 0.19, blue 0.32), so at intensity 3 the bar barely glows — override
  // them to full-bright colours and drive the intensity hard (8 on /
  // 0.1 off) so the bar reads as a flashing light even in daylight.
  // Two more things make the flash read in screenshots: the milky
  // translucent Em_Cover (alpha 0.28) is faded to nearly invisible so
  // it stops washing the lenses out, and a pair of glow sprites hovers
  // just above the bar — the lenses alone are only a few pixels wide
  // at screenshot scale. Each unit's phase is flipped on alternate
  // units (unit.phaseFlip), so red and blue are both visible at once
  // instead of every car flashing the same colour in sync.
  _flashUnit(unit, blinkOn) {
    const on = unit.phaseFlip ? !blinkOn : blinkOn;
    if (!unit.redMaterial || !unit.blueMaterial) {
      unit.car.group.traverse((o) => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (let i = 0; i < mats.length; i += 1) {
          const m = mats[i];
          if (m.name === 'Em_Red') {
            unit.redMaterial = m;
            m.emissive.setRGB(1, 0.02, 0.05);
          } else if (m.name === 'Em_Blue') {
            unit.blueMaterial = m;
            m.emissive.setRGB(0.05, 0.25, 1);
          } else if (m.name === 'Em_Cover' && !unit.coverMaterial) {
            unit.coverMaterial = m;
            m.opacity = 0.05;
          }
        }
      });
    }
    if (unit.redMaterial) unit.redMaterial.emissiveIntensity = on ? 8 : 0.1;
    if (unit.blueMaterial) unit.blueMaterial.emissiveIntensity = on ? 0.1 : 8;
    // Glow halos above the light bar, created once per unit. The bar
    // sits at y 1.34, z -0.36 (measured from police-car.glb: the
    // Em_Cover bbox, dequantized and scaled by the 0.85 GLB scale), so
    // the sprites hover just above it at y 1.52; red on the +x half,
    // blue on the -x half, matching the lens layout. depthWrite false
    // so the halos never occlude oddly.
    if (!unit.glowSprites) {
      const makeGlow = (color, x) => {
        const mat = new THREE.SpriteMaterial({
          map: getGlowTexture(), color, transparent: true,
          depthWrite: false, opacity: 0.05,
        });
        const sprite = new THREE.Sprite(mat);
        sprite.position.set(x, 1.52, -0.36);
        sprite.scale.set(1.4, 1.4, 1);
        unit.car.group.add(sprite);
        return sprite;
      };
      unit.glowSprites = { red: makeGlow(0xff1a2e, 0.23), blue: makeGlow(0x1a5cff, -0.23) };
    }
    unit.glowSprites.red.material.opacity = on ? 0.9 : 0.05;
    unit.glowSprites.blue.material.opacity = on ? 0.05 : 0.9;
  }

  _steerCar(car, desired, dt) {
    const error = wrapAngle(desired - car.heading);
    const maxTurn = TUNE.turnRate * dt;
    let change = error;
    if (change > maxTurn) change = maxTurn;
    if (change < -maxTurn) change = -maxTurn;
    car.heading += change;
  }

  // Patrol cars cruise the roads like traffic until they are needed.
  // Like traffic, they stop for someone in their path instead of running
  // them over — a player standing in the road is an obstacle, not a
  // target. (Without this, a patrol car would hit a stationary player
  // the same way a traffic car used to.)
  _drivePatrols(dt, context, blinkOn) {
    const playerPos = context.playerPos;
    for (let i = 0; i < this.patrol.length; i += 1) {
      const unit = this.patrol[i];
      this._flashUnit(unit, blinkOn);
      this.applyKnock(unit, dt);
      const car = unit.car;
      unit.turnCooldown = Math.max(0, unit.turnCooldown - dt);
      const pdx = playerPos.x - car.position.x;
      const pdz = playerPos.z - car.position.z;
      const pfx = Math.sin(car.heading);
      const pfz = Math.cos(car.heading);
      const pAhead = pdx * pfx + pdz * pfz;
      const pLat = Math.abs(pdx * pfz - pdz * pfx);
      if (pAhead > -2 && pAhead < 9 && pLat < 2.6) {
        car.speed = Math.max(0, car.speed - 30 * dt);
      } else {
        car.speed = Math.min(12, car.speed + TUNE.accel * dt);
      }
      this.maybeTurnRandom(unit, dt);
      unit.along += unit.direction * car.speed * dt;
      if (unit.along < unit.line.from || unit.along > unit.line.to) unit.direction *= -1;
      this.placeOnRoad(unit);
      this._spinWheels(car, dt);
    }
  }

  _spinWheels(car, dt) {
    const wheels = car.wheels;
    for (let i = 0; i < wheels.length; i += 1) {
      wheels[i].wheel.rotation.x += (car.speed / 0.36) * dt;
    }
  }

  _drivePursuit(dt, context, topSpeed, blinkOn) {
    const wantedStars = context.wantedStars;
    for (let i = 0; i < this.pursuit.length; i += 1) {
      this._drivePursuitUnit(this.pursuit[i], dt, context, topSpeed, blinkOn, wantedStars);
    }
  }

  _drivePursuitUnit(unit, dt, context, topSpeed, blinkOn, wantedStars) {
    const playerPos = context.playerPos;
    const playerHeading = context.playerHeading;
    const driving = context.driving;
    const drivenCar = context.drivenCar;
    this._flashUnit(unit, blinkOn);
    this.applyKnock(unit, dt);
    const car = unit.car;
    const dx = playerPos.x - car.position.x;
    const dz = playerPos.z - car.position.z;
    const dist = Math.hypot(dx, dz);
    if (unit.mode === 'road' && dist < TUNE.directWithin) unit.mode = 'direct';
    if (unit.mode === 'direct' && dist > TUNE.snapBeyond) this.snapToRoad(unit, playerPos);
    // How long the player's car has sat still within arrest range: the
    // clock for an officer to get out while the player is still driving.
    const playerStill = driving && drivenCar && Math.abs(drivenCar.speed) < 0.5 && dist < 6;
    unit.stillTimer = playerStill ? unit.stillTimer + dt : 0;
    if (unit.mode === 'direct') {
      unit.stuckTimer += dt;
      if (unit.stuckTimer > 1) {
        const moved = Math.hypot(car.position.x - unit.lastX, car.position.z - unit.lastZ);
        if (moved < 1 && car.speed > 5) this.snapToRoad(unit, playerPos);
        unit.lastX = car.position.x;
        unit.lastZ = car.position.z;
        unit.stuckTimer = 0;
      }
    }
    if (unit.mode === 'road') {
      unit.status = 'PURSUIT';
      unit.turnCooldown = Math.max(0, unit.turnCooldown - dt);
      car.speed = Math.min(topSpeed, car.speed + TUNE.accel * dt);
      this.maybeTurnAtIntersection(unit, playerPos, dt);
      unit.along += unit.direction * car.speed * dt;
      if (unit.along < unit.line.from || unit.along > unit.line.to) unit.direction *= -1;
      this.placeOnRoad(unit);
    } else {
      this._driveDirect(unit, dt, context, topSpeed, dist, dx, dz);
    }
    this._maybeDeployOfficer(unit, context, dist, wantedStars);
    this._updateOfficer(unit, dt, context, wantedStars);
    this._maybeShoot(unit, dt, context, dist, wantedStars);
    this._spinWheels(car, dt);
  }

  _driveDirect(unit, dt, context, topSpeed, dist, dx, dz) {
    const playerPos = context.playerPos;
    const playerHeading = context.playerHeading;
    const driving = context.driving;
    const drivenCar = context.drivenCar;
    const car = unit.car;
    if (unit.escortSide !== 0) {
      const fx = Math.sin(playerHeading);
      const fz = Math.cos(playerHeading);
      const leftX = fz;
      const leftZ = -fx;
      const slotX = playerPos.x + fx * 10 + leftX * unit.escortSide * 3;
      const slotZ = playerPos.z + fz * 10 + leftZ * unit.escortSide * 3;
      const relX = slotX - car.position.x;
      const relZ = slotZ - car.position.z;
      const alongErr = relX * fx + relZ * fz;
      const latErr = relX * leftX + relZ * leftZ;
      let aim = latErr * 0.15;
      if (aim > 0.7) aim = 0.7;
      if (aim < -0.7) aim = -0.7;
      this._steerCar(car, playerHeading + aim, dt);
      const playerSpeed = drivenCar ? drivenCar.speed : 0;
      let targetSpeed = playerSpeed + alongErr * 1.2;
      if (targetSpeed < 0) targetSpeed = 0;
      if (targetSpeed > topSpeed) targetSpeed = topSpeed;
      let change = targetSpeed - car.speed;
      if (change > TUNE.accel * dt) change = TUNE.accel * dt;
      if (change < -30 * dt) change = -30 * dt;
      car.speed += change;
      unit.status = 'ESCORT';
    } else {
      this._steerCar(car, Math.atan2(dx, dz), dt);
      if (unit.ramCooldown > 0) {
        unit.ramCooldown -= dt;
        car.speed = -6;
      } else if (driving && dist < TUNE.ramReach && unit.stillTimer <= 3) {
        unit.status = 'RAMMING';
        drivenCar.speed *= Math.max(0, 1 - TUNE.ramDrag * dt);
        // Every ram dents the player's car: ram a wedged car long enough
        // and it stalls out, forcing the player on foot.
        context.onRam?.(drivenCar);
        car.speed = 4;
        unit.ramCooldown = TUNE.ramPause;
      } else {
        unit.status = 'PURSUIT';
        // Stop bumper-to-bumper when the player is on foot, or their car
        // has sat still — close enough for the officer to get out.
        const parked = drivenCar && Math.abs(drivenCar.speed) < 0.5;
        if (dist < 3.5 && (!driving || parked)) car.speed = 0;
        else car.speed = Math.min(topSpeed, car.speed + TUNE.accel * dt);
      }
    }
    // The sea stops a pursuit car like any other: it stalls in deep water
    // and can only drive back out toward shore.
    const water = waterCap(this.city, car.position.x, car.position.z, car.heading, car.speed, topSpeed, 6);
    car.speed = water.speed;
    car.group.position.y = -Math.min(water.depth * 0.95, 1.3);
    car.group.position.x += Math.sin(car.heading) * car.speed * dt;
    car.group.position.z += Math.cos(car.heading) * car.speed * dt;
    // Stay in the city: a direct-mode pursuit drives straight at the
    // player and would otherwise chase them out onto the sand (and vanish
    // when the pursuit ends). Same ±265 edge as traffic.
    car.group.position.x = Math.max(-265, Math.min(265, car.group.position.x));
    car.group.position.z = Math.max(-265, Math.min(265, car.group.position.z));
    const beforeX = car.group.position.x;
    const beforeZ = car.group.position.z;
    this.city.resolveCircle(car.group.position, 1.6);
    if (car.group.position.x !== beforeX || car.group.position.z !== beforeZ) car.speed *= 0.4;
    car.group.rotation.y = car.heading;
  }

  _maybeDeployOfficer(unit, context, dist, wantedStars) {
    const car = unit.car;
    const driving = context.driving;
    // An officer gets out once the pursuit car has stopped next to the
    // player — on foot as before, or after the player's car has sat still
    // in range for 3s (a wedged car is no shelter from arrest).
    const stoppedNextToPlayer = car.speed === 0 && dist < 3.5;
    const arrestWindow = !driving || unit.stillTimer > 3;
    if (wantedStars < 1 || unit.officer || !stoppedNextToPlayer || !arrestWindow) return;
    const mesh = buildWalkerMesh(0x24457e, 0x14141c, 0xd9a077, 0x201510, 'police', 1);
    mesh.group.position.set(car.position.x + Math.cos(car.heading) * 1.8, 0, car.position.z - Math.sin(car.heading) * 1.8);
    this.city.resolveCircle(mesh.group.position, 0.5);
    const backText = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), liveryMaterials().text);
    backText.position.set(0, 1.35, -0.22);
    backText.rotation.y = Math.PI;
    mesh.group.add(backText);
    mesh.backText = backText;
    mesh.returning = false;
    mesh.walkPhase = 0;
    mesh.mixer = null;
    mesh.spawnedAt = this.clock;
    mesh.nextRetryAt = 0;
    this.scene.add(mesh.group);
    unit.officer = mesh;
    this.upgradeOfficerToGLB(unit, mesh);
  }

  _updateOfficer(unit, dt, context, wantedStars) {
    const officer = unit.officer;
    if (!officer) return;
    const playerPos = context.playerPos;
    const driving = context.driving;
    const drivenCar = context.drivenCar;
    const car = unit.car;
    // A failed GLB upgrade retries from the update loop: an officer older
    // than 3s still in its box body gets another attempt, at most one per
    // 2s (a transient load failure must not leave a box figure standing
    // for the whole chase).
    const spawnedAt = officer.spawnedAt || 0;
    const nextRetryAt = officer.nextRetryAt || 0;
    if (!officer.isGLB && !officer.upgradePending && this.clock - spawnedAt > 3 && this.clock >= nextRetryAt) {
      this.upgradeOfficerToGLB(unit, officer);
    }
    const op = officer.group.position;
    const odist = Math.hypot(playerPos.x - op.x, playerPos.z - op.z);
    const playerDrivingOff = driving && (!drivenCar || Math.abs(drivenCar.speed) > 1);
    if (playerDrivingOff || wantedStars === 0 || odist > 18) officer.returning = true;
    else if (odist < 12) officer.returning = false;
    const tx = officer.returning ? car.position.x : playerPos.x;
    const tz = officer.returning ? car.position.z : playerPos.z;
    const tdx = tx - op.x;
    const tdz = tz - op.z;
    const tdist = Math.hypot(tdx, tdz);
    if (officer.returning && (tdist < 1.5 || tdist > 25)) {
      this.scene.remove(officer.group);
      unit.officer = null;
    } else if (tdist > 0.4) {
      // Officers do not swim: they stop at the shoreline and wait. A step
      // into water deeper than 0.5m is blocked unless it leads back to
      // shallower ground (an officer caught in deep water walks back out).
      const step = Math.min(TUNE.officerPace * dt, tdist);
      const nx = op.x + (tdx / tdist) * step;
      const nz = op.z + (tdz / tdist) * step;
      const nextDepth = this.city.waterDepthAt(nx, nz);
      const curDepth = this.city.waterDepthAt(op.x, op.z);
      if (nextDepth <= 0.5 || nextDepth < curDepth) {
        op.x = nx;
        op.z = nz;
      }
      this.city.resolveCircle(op, 0.5);
      officer.group.rotation.y = Math.atan2(tdx, tdz);
      officer.walkPhase += dt * 9;
      const swing = Math.sin(officer.walkPhase) * 0.5;
      officer.legLeft.rotation.x = swing;
      officer.legRight.rotation.x = -swing;
      officer.armLeft.rotation.x = -swing;
      officer.armRight.rotation.x = swing;
      // A GLB officer walks on its mixer clip instead of the limb swing
      // (its limb refs are inert stubs after the swap).
      if (officer.setOfficerClip && officer.moveClip) officer.setOfficerClip(officer.moveClip);
      if (officer.mixer) officer.mixer.update(dt);
    } else if (officer.mixer) {
      // Standing still: idle pose instead of a frozen mid-stride.
      if (officer.setOfficerClip) officer.setOfficerClip('idle');
      officer.mixer.update(dt);
    }
  }

  _maybeShoot(unit, dt, context, dist, wantedStars) {
    const playerPos = context.playerPos;
    const car = unit.car;
    const shooter = unit.officer ? unit.officer.group : car;
    const inRange = dist < 42;
    if (wantedStars >= 3 && inRange && this.hasLineOfSight(shooter.position, playerPos)) {
      unit.shootCooldown -= dt;
      if (unit.shootCooldown <= 0) {
        unit.shootCooldown = 1.1 + Math.random() * 0.9;
        unit.status = 'SHOOTING';
        context.onPoliceShot?.(shooter.position, playerPos);
      }
    } else if (unit.status === 'SHOOTING') {
      unit.status = 'PURSUIT';
    }
  }

  _driveHelicopter(dt, context) {
    const heli = this.helicopter;
    if (!heli) return;
    const playerPos = context.playerPos;
    const playerHeading = context.playerHeading;
    heli.sweepPhase += (dt / TUNE.heliSweepSecs) * Math.PI * 2;
    const forwardX = Math.sin(playerHeading);
    const forwardZ = Math.cos(playerHeading);
    const sideX = forwardZ;
    const sideZ = -forwardX;
    const sweep = Math.sin(heli.sweepPhase) * TUNE.heliSway;
    heli.group.position.set(
      playerPos.x + forwardX * TUNE.heliAhead + sideX * sweep,
      TUNE.heliHeight,
      playerPos.z + forwardZ * TUNE.heliAhead + sideZ * sweep,
    );
    const target = this._heliTarget.set(playerPos.x, 0, playerPos.z);
    heli.group.lookAt(target);
    heli.rotor.rotation.y += dt * 28;
    heli.tailRotor.rotation.x += dt * 40;
    const toHeli = this._heliTo.subVectors(heli.group.position, target);
    const distance = toHeli.length();
    heli.cone.position.copy(heli.group.position).add(target).multiplyScalar(0.5);
    heli.cone.quaternion.setFromUnitVectors(this._heliUp, toHeli.normalize());
    heli.cone.scale.set(1, distance / 30, 1);
    heli.spotlight.position.set(playerPos.x, 0.08, playerPos.z);
    heli.spotlight.material.opacity = 0.18 + 0.08 * Math.sin(this.clock * 4);
  }

  // Slab test: walk the segment from `from` to `to` through each
  // building's footprint and report whether anything blocks the view.
  // A near-zero direction on one axis means the segment runs parallel to
  // that axis — it only clears the box if it starts inside the slab.
  hasLineOfSight(from, to) {
    const dx = to.x - from.x;
    const dz = to.z - from.z;
    const boxes = this.city.buildingBoxes;
    for (let i = 0; i < boxes.length; i += 1) {
      const box = boxes[i];
      if (this._segmentHitsBox(from, dx, dz, box)) return false;
    }
    return true;
  }

  _segmentHitsBox(from, dx, dz, box) {
    let tNear = 0;
    let tFar = 1;
    const spans = [
      { p: from.x, d: dx, lo: box.minX, hi: box.maxX },
      { p: from.z, d: dz, lo: box.minZ, hi: box.maxZ },
    ];
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];
      if (Math.abs(span.d) < 1e-9) {
        if (span.p < span.lo || span.p > span.hi) return false;
        continue;
      }
      let enter = (span.lo - span.p) / span.d;
      let exit = (span.hi - span.p) / span.d;
      if (enter > exit) {
        const tmp = enter;
        enter = exit;
        exit = tmp;
      }
      if (enter > tNear) tNear = enter;
      if (exit < tFar) tFar = exit;
      if (tNear > tFar) return false;
    }
    return tNear <= tFar;
  }

  canSeePlayer(playerPos) {
    const lists = [this.pursuit, this.roadblock];
    for (let l = 0; l < lists.length; l += 1) {
      const list = lists[l];
      for (let i = 0; i < list.length; i += 1) {
        const unit = list[i];
        const d = Math.hypot(unit.car.position.x - playerPos.x, unit.car.position.z - playerPos.z);
        if (d < TUNE.spotRange && this.hasLineOfSight(unit.car.position, playerPos)) return true;
      }
    }
    return false;
  }

  damageHelicopter(amount) {
    if (!this.helicopter) return false;
    this.heliHp -= amount;
    if (this.heliHp > 0) return false;
    this.removeHelicopter();
    this.heliCooldown = TUNE.heliReturn;
    return true;
  }

  units(playerPos) {
    const rows = [];
    const lists = [this.patrol, this.pursuit, this.roadblock];
    for (let l = 0; l < lists.length; l += 1) {
      const list = lists[l];
      for (let i = 0; i < list.length; i += 1) {
        const unit = list[i];
        rows.push({
          callsign: unit.callsign,
          distanceMetres: Math.round(Math.hypot(unit.car.position.x - playerPos.x, unit.car.position.z - playerPos.z)),
          status: unit.status,
        });
      }
    }
    if (this.helicopter) {
      const h = this.helicopter.group.position;
      rows.push({
        callsign: HELI_CALLSIGN,
        distanceMetres: Math.round(Math.hypot(h.x - playerPos.x, h.z - playerPos.z)),
        status: 'SPOTLIGHT',
      });
    }
    return rows;
  }

  nearestDistance(playerPos) {
    let best = Infinity;
    for (let i = 0; i < this.pursuit.length; i += 1) {
      const unit = this.pursuit[i];
      const carDist = Math.hypot(unit.car.position.x - playerPos.x, unit.car.position.z - playerPos.z);
      if (carDist < best) best = carDist;
      if (unit.officer) {
        const op = unit.officer.group.position;
        const offDist = Math.hypot(op.x - playerPos.x, op.z - playerPos.z);
        if (offDist < best) best = offDist;
      }
    }
    return best;
  }

  allCarPositions() {
    const out = [];
    const lists = [this.patrol, this.pursuit, this.roadblock];
    for (let l = 0; l < lists.length; l += 1) {
      const list = lists[l];
      for (let i = 0; i < list.length; i += 1) {
        const unit = list[i];
        out.push({ x: unit.car.position.x, z: unit.car.position.z });
      }
    }
    return out;
  }

  nextCallsign() {
    const inUse = new Set();
    const lists = [this.pursuit, this.roadblock, this.patrol];
    for (let l = 0; l < lists.length; l += 1) {
      const list = lists[l];
      for (let i = 0; i < list.length; i += 1) inUse.add(list[i].callsign);
    }
    for (let i = 0; i < CALLSIGNS.length; i += 1) {
      if (!inUse.has(CALLSIGNS[i])) return CALLSIGNS[i];
    }
    const fallback = CALLSIGNS[this.callsignIndex % CALLSIGNS.length];
    this.callsignIndex += 1;
    return fallback;
  }

  createPoliceCar(x, z, heading, callsign) {
    const car = createCar(this.scene, this.textures, 'POLICE', this.textures.carWhite, 0xffffff, x, z, heading);
    // No added light bar: the police GLB already has a proper one — Em_Red
    // and Em_Blue emissive lenses under a translucent cover on a black bar.
    // The old code bolted two crude boxes on top of it. The blink now drives
    // the GLB's own materials (resolved lazily in _flashUnit, since the GLB
    // attaches async).
    // Decals: POLICE lettering on both flanks and the hood/trunk, plus the
    // VRPD door badge. No side stripe and no roof lettering: the GLB body
    // is curved, so a flat box reads as a bolted-on slab, and the roof's
    // flat section is too short for the 1.9 m plane. The car already wears
    // a black-and-white livery, so the text alone carries it.
    this._decoratePoliceCar(car);
    // Alternating flash phase: consecutive units blink opposite each
    // other, so at any instant half the cars show red and half blue.
    this._unitSeq += 1;
    const unit = {
      car,
      callsign,
      status: 'PURSUIT',
      ramCooldown: 0,
      shootCooldown: 1 + Math.random() * 2,
      phaseFlip: this._unitSeq % 2 === 0,
      redMaterial: null,
      blueMaterial: null,
      coverMaterial: null,
      glowSprites: null,
      escortSide: 0,
      officer: null,
      stillTimer: 0,
    };
    return unit;
  }

  _decoratePoliceCar(car) {
    const livery = liveryMaterials();
    const stick = (mat, w, h, x, y, z, rotX, rotY) => {
      const decal = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
      decal.position.set(x, y, z);
      if (rotX) decal.rotation.x = rotX;
      if (rotY) decal.rotation.y = rotY;
      car.group.add(decal);
    };
    // Flank lettering and door badges, mirrored per side.
    for (let s = 0; s < 2; s += 1) {
      const side = s === 0 ? -1 : 1;
      stick(livery.text, 3.4, 0.42, side * 0.84, 0.55, 0, 0, (side * Math.PI) / 2);
      stick(livery.badge, 0.45, 0.45, side * 0.86, 0.62, 0.9, 0, (side * Math.PI) / 2);
    }
    // Hood/trunk POLICE plates, each just above its sloped surface.
    const plates = [
      { z: 1.9, y: 0.74, depth: 0.4 },
      { z: -1.95, y: 0.94, depth: 0.3 },
    ];
    for (let i = 0; i < plates.length; i += 1) {
      const plate = plates[i];
      stick(livery.text, 1.2, plate.depth, 0, plate.y, plate.z, -Math.PI / 2, 0);
    }
  }

  removeUnit(unit) {
    this.scene.remove(unit.car.group);
    if (unit.officer) this.scene.remove(unit.officer.group);
  }

  // Drop every unit + helicopter at once (BUSTED/WASTED, heat cooled off).
  clearAll() {
    const lists = [this.pursuit, this.roadblock];
    for (let l = 0; l < lists.length; l += 1) {
      const list = lists[l];
      for (let i = 0; i < list.length; i += 1) this.removeUnit(list[i]);
    }
    this.pursuit = [];
    this.roadblock = [];
    this.roadblockCentre = null;
    this.removeHelicopter();
    this.lostTimer = 0;
  }

  // A point on a road near the player: a line close by laterally, ~80m
  // along it — the fallback when random picks miss the spawn band, so a
  // unit never spawns on the far side of the map by bad luck.
  nearPoint(playerPos, distance) {
    const close = [];
    for (let i = 0; i < this.lines.length; i += 1) {
      const line = this.lines[i];
      const lateral = line.axis === 'z' ? playerPos.x : playerPos.z;
      if (Math.abs(lateral - line.at) <= 40) close.push(line);
    }
    const pool = close.length > 0 ? close : this.lines;
    const line = pick(this.rng, pool);
    const playerAlong = line.axis === 'z' ? playerPos.z : playerPos.x;
    const offset = this.rng() < 0.5 ? -distance : distance;
    const along = Math.max(line.from, Math.min(line.to, playerAlong + offset));
    return { line, along };
  }

  spawnPursuitCar(playerPos, spawnDistance) {
    let line = pick(this.rng, this.lines);
    let along = line.from + this.rng() * (line.to - line.from);
    let found = false;
    let attempt = 0;
    while (attempt < 12 && !found) {
      const cand = pick(this.rng, this.lines);
      const a = cand.from + this.rng() * (cand.to - cand.from);
      const cx = cand.axis === 'z' ? cand.at : a;
      const cz = cand.axis === 'z' ? a : cand.at;
      const dist = Math.hypot(cx - playerPos.x, cz - playerPos.z);
      if (dist > spawnDistance - 15 && dist < spawnDistance + 20) {
        line = cand;
        along = a;
        found = true;
      }
      attempt += 1;
    }
    if (!found) {
      const near = this.nearPoint(playerPos, spawnDistance);
      line = near.line;
      along = near.along;
    }
    const playerAlong = line.axis === 'z' ? playerPos.z : playerPos.x;
    const direction = playerAlong >= along ? 1 : -1;
    const heading = headingFor(line.axis, direction);
    const x = line.axis === 'z' ? line.at : along;
    const z = line.axis === 'z' ? along : line.at;
    const unit = this.createPoliceCar(x, z, heading, this.nextCallsign());
    unit.line = line;
    unit.direction = direction;
    unit.along = along;
    unit.mode = 'road';
    unit.turnCooldown = 0;
    unit.stuckTimer = 0;
    unit.lastX = x;
    unit.lastZ = z;
    unit.car.speed = 18;
    this.pursuit.push(unit);
    return unit;
  }

  spawnPatrolCar(playerPos) {
    let line = pick(this.rng, this.lines);
    let along = line.from + this.rng() * (line.to - line.from);
    let found = false;
    let attempt = 0;
    while (attempt < 12 && !found) {
      const cand = pick(this.rng, this.lines);
      const a = cand.from + this.rng() * (cand.to - cand.from);
      const cx = cand.axis === 'z' ? cand.at : a;
      const cz = cand.axis === 'z' ? a : cand.at;
      const dist = Math.hypot(cx - playerPos.x, cz - playerPos.z);
      if (dist > 50 && dist < 110) {
        line = cand;
        along = a;
        found = true;
      }
      attempt += 1;
    }
    if (!found) {
      const near = this.nearPoint(playerPos, 80);
      line = near.line;
      along = near.along;
    }
    const direction = this.rng() < 0.5 ? -1 : 1;
    const heading = headingFor(line.axis, direction);
    const x = line.axis === 'z' ? line.at : along;
    const z = line.axis === 'z' ? along : line.at;
    const unit = this.createPoliceCar(x, z, heading, this.nextCallsign());
    unit.status = 'PATROL';
    unit.line = line;
    unit.direction = direction;
    unit.along = along;
    unit.mode = 'road';
    unit.turnCooldown = 0;
    unit.stuckTimer = 0;
    unit.lastX = x;
    unit.lastZ = z;
    unit.car.speed = 12;
    this.patrol.push(unit);
    return unit;
  }

  // The nearest patrol car joins the pursuit when heat comes on — but
  // only if it is close enough to get there: a patrol on the far side of
  // the island would take longer to arrive than a fresh unit spawning
  // near the player, so far patrols keep cruising instead.
  nearestPatrol(playerPos) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < this.patrol.length; i += 1) {
      const unit = this.patrol[i];
      const d = Math.hypot(unit.car.position.x - playerPos.x, unit.car.position.z - playerPos.z);
      if (d < bestD) {
        bestD = d;
        best = unit;
      }
    }
    if (!best) return null;
    return { unit: best, dist: bestD };
  }

  convertPatrol(unit) {
    this.patrol.splice(this.patrol.indexOf(unit), 1);
    unit.status = 'PURSUIT';
    unit.mode = 'road';
    unit.car.speed = 18;
    unit.turnCooldown = 0;
    unit.stuckTimer = 0;
    unit.lastX = unit.car.position.x;
    unit.lastZ = unit.car.position.z;
    this.pursuit.push(unit);
  }

  placeOnRoad(unit) {
    // Right-hand lane, same rule as traffic.js laneOffsetFor (2.5m): a car
    // on the centreline straddles both lanes. The knock offset (crash
    // slide, see applyKnock) rides on top and eases back to 0. The lane
    // side flips with the axis: on a north-south road the right lane is
    // the negative side when driving forward, on an east-west road it is
    // the positive side.
    const lane = 2.5;
    const side = unit.line.axis === 'z' ? -1 : 1;
    const off = side * unit.direction * lane;
    const kx = unit.knockX || 0;
    const kz = unit.knockZ || 0;
    if (unit.line.axis === 'z') {
      unit.car.group.position.set(unit.line.at + off + kx, 0, unit.along + kz);
    } else {
      unit.car.group.position.set(unit.along + kx, 0, unit.line.at + off + kz);
    }
    unit.car.heading = headingFor(unit.line.axis, unit.direction);
    unit.car.group.rotation.y = unit.car.heading;
  }

  // Crash knockback (from main.js collideWith): a hit car slides along
  // the impact direction and settles back. Road-mode cars carry the slide
  // as a decaying offset from their lane (placeOnRoad applies it);
  // direct-mode and roadblock cars slide in place, since their position
  // is the state. Heading stays AI-owned — no spin here.
  applyKnock(unit, dt) {
    const car = unit.car;
    const vx = car.knockVX || 0;
    const vz = car.knockVZ || 0;
    const ox = unit.knockX || 0;
    const oz = unit.knockZ || 0;
    if (vx === 0 && vz === 0 && ox === 0 && oz === 0) return;
    if (unit.mode === 'road') {
      unit.knockX = ox + vx * dt;
      unit.knockZ = oz + vz * dt;
    } else {
      car.group.position.x += vx * dt;
      car.group.position.z += vz * dt;
    }
    const decay = Math.max(0, 1 - 2.5 * dt);
    car.knockVX = vx * decay;
    car.knockVZ = vz * decay;
    if (Math.abs(car.knockVX) < 0.05) car.knockVX = 0;
    if (Math.abs(car.knockVZ) < 0.05) car.knockVZ = 0;
    if (unit.knockX || unit.knockZ) {
      const ease = Math.max(0, 1 - 1.2 * dt);
      unit.knockX *= ease;
      unit.knockZ *= ease;
      if (Math.abs(unit.knockX) < 0.02) unit.knockX = 0;
      if (Math.abs(unit.knockZ) < 0.02) unit.knockZ = 0;
    }
  }

  snapToRoad(unit, playerPos) {
    let bestLine = this.lines[0];
    let bestLateral = Infinity;
    for (let i = 0; i < this.lines.length; i += 1) {
      const line = this.lines[i];
      const lateral = line.axis === 'z'
        ? Math.abs(unit.car.position.x - line.at)
        : Math.abs(unit.car.position.z - line.at);
      if (lateral < bestLateral) {
        bestLateral = lateral;
        bestLine = line;
      }
    }
    unit.line = bestLine;
    let along = bestLine.axis === 'z' ? unit.car.position.z : unit.car.position.x;
    along = Math.max(bestLine.from, Math.min(bestLine.to, along));
    unit.along = along;
    const playerAlong = bestLine.axis === 'z' ? playerPos.z : playerPos.x;
    unit.direction = playerAlong >= unit.along ? 1 : -1;
    unit.mode = 'road';
    unit.turnCooldown = 0;
    this.placeOnRoad(unit);
  }

  _findCrossLine(axis, at) {
    for (let i = 0; i < this.lines.length; i += 1) {
      const line = this.lines[i];
      if (line.axis !== axis && line.at === at) return line;
    }
    return null;
  }

  // Patrol turns: RANDOM, never toward the player. maybeTurnAtIntersection
  // steers toward the player — right for pursuit, wrong for patrol: with
  // it, all 3 patrol cars converged on the player's road and stopped
  // around them at 0 stars, looking like a pursuit that never ends.
  maybeTurnRandom(unit, dt) {
    if (unit.turnCooldown > 0) return;
    const crosses = unit.line.axis === 'z' ? this.crossZ : this.crossX;
    const window = Math.max(2.5, unit.car.speed * dt * 1.5);
    for (let i = 0; i < crosses.length; i += 1) {
      const cross = crosses[i];
      if (Math.abs(unit.along - cross) > window) continue;
      if (this.rng() > 0.3) return;
      const crossLine = this._findCrossLine(unit.line.axis, cross);
      if (!crossLine) return;
      unit.line = crossLine;
      unit.along = crossLine.axis === 'z' ? unit.car.position.z : unit.car.position.x;
      unit.direction = this.rng() < 0.5 ? 1 : -1;
      unit.turnCooldown = 1;
      return;
    }
  }

  maybeTurnAtIntersection(unit, playerPos, dt) {
    if (unit.turnCooldown > 0) return;
    const crosses = unit.line.axis === 'z' ? this.crossZ : this.crossX;
    const playerLateral = unit.line.axis === 'z' ? playerPos.x : playerPos.z;
    const playerAlong = unit.line.axis === 'z' ? playerPos.z : playerPos.x;
    if (Math.abs(playerLateral - unit.line.at) <= 8) {
      unit.direction = playerAlong >= unit.along ? 1 : -1;
      return;
    }
    // The turn window must cover one frame of travel, or a fast car on a
    // slow frame jumps clean over the intersection and never turns.
    const window = Math.max(2.5, unit.car.speed * dt * 1.5);
    for (let i = 0; i < crosses.length; i += 1) {
      const cross = crosses[i];
      if (Math.abs(unit.along - cross) > window) continue;
      const crossLine = this._findCrossLine(unit.line.axis, cross);
      if (!crossLine) return;
      unit.line = crossLine;
      unit.along = crossLine.axis === 'z' ? unit.car.position.z : unit.car.position.x;
      const playerOnCross = crossLine.axis === 'z' ? playerPos.z : playerPos.x;
      unit.direction = playerOnCross >= unit.along ? 1 : -1;
      unit.turnCooldown = 1;
      return;
    }
  }

  placeRoadblock(playerPos, playerHeading, stars = 3) {
    for (let i = 0; i < this.roadblock.length; i += 1) this.removeUnit(this.roadblock[i]);
    this.roadblock = [];
    const fx = Math.sin(playerHeading);
    const fz = Math.cos(playerHeading);
    const centreX = playerPos.x + fx * TUNE.blockAhead;
    const centreZ = playerPos.z + fz * TUNE.blockAhead;
    const px = fz;
    const pz = -fx;
    const offsets = stars >= 4 ? [-1, 0, 1] : [-1, 1];
    for (let i = 0; i < offsets.length; i += 1) {
      const side = offsets[i];
      const unit = this.createPoliceCar(
        centreX + px * side * 2.4,
        centreZ + pz * side * 2.4,
        playerHeading + Math.PI / 2,
        this.nextCallsign(),
      );
      unit.status = 'ROADBLOCK';
      this.city.resolveCircle(unit.car.group.position, 1.6);
      this.roadblock.push(unit);
    }
    this.roadblockCentre = { x: centreX, z: centreZ };
    this.roadblockTimer = 0;
  }

  buildHelicopter() {
    const group = new THREE.Group();
    // Self-lit materials so the heli reads at night: the body keeps its
    // Lambert shading but with emissive lift, the glass and lights are
    // Basic (always full bright).
    const body = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3a3a3a });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
    const glass = new THREE.MeshBasicMaterial({ color: 0x9fd4e8 });
    const put = (parent, geo, mat, x, y, z) => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    // Rounded cabin pod + glass cockpit bubble (no box core: the pod is
    // the body).
    const cabin = put(group, new THREE.SphereGeometry(1.2, 16, 12), body, 0, 0.8, 0);
    cabin.scale.set(1, 0.75, 1.6);
    const bubble = put(group, new THREE.SphereGeometry(0.95, 16, 12), glass, 0, 0.85, 1.5);
    bubble.scale.set(0.9, 0.65, 0.9);
    // Tapered tail boom (thick at the cabin, thin at the tail).
    const boom = put(group, new THREE.CylinderGeometry(0.28, 0.14, 3.8, 10), body, 0, 1.0, -3.0);
    boom.rotation.x = Math.PI / 2;
    // Tail fin + tail rotor: the silhouette features that read "helicopter".
    put(group, new THREE.BoxGeometry(0.12, 1.1, 0.7), body, 0, 1.5, -4.7);
    const tailRotor = new THREE.Group();
    const tailBladeGeo = new THREE.BoxGeometry(0.08, 1.6, 0.12);
    const tailBladeB = put(tailRotor, tailBladeGeo, dark, 0, 0, 0);
    tailBladeB.rotation.x = Math.PI / 2;
    put(tailRotor, tailBladeGeo, dark, 0, 0, 0);
    tailRotor.position.set(0.3, 1.5, -4.7);
    group.add(tailRotor);
    // Landing skids: two tubes with struts to the cabin.
    const skidGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8);
    const skidSides = [-0.9, 0.9];
    for (let i = 0; i < skidSides.length; i += 1) {
      const sx = skidSides[i];
      const skid = put(group, skidGeo, dark, sx, -0.15, 0);
      skid.rotation.x = Math.PI / 2;
      const strutZs = [-1.0, 1.0];
      for (let j = 0; j < strutZs.length; j += 1) {
        put(group, new THREE.BoxGeometry(0.08, 0.5, 0.08), dark, sx, 0.1, strutZs[j]);
      }
    }
    // Rotor mast + blades + translucent disc (the disc is what the eye
    // sees of a spinning rotor at distance).
    put(group, new THREE.BoxGeometry(0.25, 0.5, 0.25), dark, 0, 1.55, 0);
    const rotor = new THREE.Group();
    const bladeGeometry = new THREE.BoxGeometry(7.5, 0.06, 0.3);
    const bladeB = put(rotor, bladeGeometry, dark, 0, 0, 0);
    bladeB.rotation.y = Math.PI / 2;
    put(rotor, bladeGeometry, dark, 0, 0, 0);
    const disc = put(
      rotor,
      new THREE.CircleGeometry(3.8, 32),
      new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
      0,
      0,
      0,
    );
    disc.rotation.x = -Math.PI / 2;
    rotor.position.y = 1.7;
    group.add(rotor);
    // Navigation lights: red left, green right, white strobe on the tail.
    const lamp = (color, x, y, z) => {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color }));
      light.position.set(x, y, z);
      group.add(light);
      return light;
    };
    lamp(0xff2222, -1.15, 0.8, 0);
    lamp(0x22ff44, 1.15, 0.8, 0);
    lamp(0xffffff, 0, 1.0, -4.9);
    // Searchlight lamp under the nose (the beam's visible source).
    lamp(0xfff6cc, 0, 0.2, 1.9);
    this.scene.add(group);
    const additive = (opacity, side) => new THREE.MeshBasicMaterial({
      color: 0xfff2a8,
      transparent: true,
      opacity,
      blending: THREE.AdditiveBlending,
      side,
      depthWrite: false,
    });
    // Narrower, fainter beam: the old wide cone read as fog.
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.5, 30, 16, 1, true), additive(0.07, THREE.DoubleSide));
    this.scene.add(cone);
    const spotlight = new THREE.Mesh(new THREE.CircleGeometry(6, 24), additive(0.22, THREE.FrontSide));
    spotlight.rotation.x = -Math.PI / 2;
    spotlight.position.y = 0.08;
    this.scene.add(spotlight);
    this.helicopter = { group, rotor, tailRotor, cone, spotlight, sweepPhase: -Math.PI / 2 };
  }

  removeHelicopter() {
    if (!this.helicopter) return;
    this.scene.remove(this.helicopter.group, this.helicopter.cone, this.helicopter.spotlight);
    this.helicopter = null;
  }

  stageChase(playerPos, playerHeading) {
    while (this.pursuit.length < 2) this.spawnPursuitCar(playerPos, 30);
    const forwardX = Math.sin(playerHeading);
    const forwardZ = Math.cos(playerHeading);
    const sideX = forwardZ;
    const sideZ = -forwardX;
    const escortSides = [1, -1];
    for (let i = 0; i < escortSides.length; i += 1) {
      const side = escortSides[i];
      const escort = this.createPoliceCar(
        playerPos.x + forwardX * 10 + sideX * 3 * side,
        playerPos.z + forwardZ * 10 + sideZ * 3 * side,
        playerHeading,
        this.nextCallsign(),
      );
      escort.mode = 'direct';
      escort.escortSide = side;
      escort.turnCooldown = 0;
      escort.stuckTimer = 0;
      escort.lastX = escort.car.position.x;
      escort.lastZ = escort.car.position.z;
      escort.car.speed = 30;
      this.pursuit.push(escort);
    }
    this.placeRoadblock(playerPos, playerHeading);
    if (!this.helicopter) this.buildHelicopter();
  }

  // Swap a box-figure officer for the soldier GLB (navy recolour) once it
  // loads. The box figure stays as the placeholder until the GLB is ready.
  // A failed load schedules a retry (nextRetryAt, picked up by the update
  // loop) instead of leaving the box figure for good; the abort guard
  // still skips an officer that is gone by then (removed, or handed to
  // main.js as a walker after a steal). The loader is imported dynamically
  // so a missing models_loader.js degrades to the placeholder instead of
  // breaking the whole game.
  async upgradeOfficerToGLB(unit, mesh) {
    mesh.upgradePending = true;
    try {
      const loader = await import('./models_loader.js');
      const person = await loader.loadPerson('soldier');
      if (unit.officer !== mesh || !mesh.group.parent) return;
      loader.recolourPolice(person.group);
      const pos = mesh.group.position.clone();
      const rotY = mesh.group.rotation.y;
      this.scene.remove(mesh.group);
      if (mesh.backText) {
        mesh.group.remove(mesh.backText);
        person.group.add(mesh.backText);
      }
      person.group.position.copy(pos);
      person.group.rotation.y = rotY;
      this.scene.add(person.group);
      // Same officer object, new body: the update loop, removeUnit and
      // main.js walkers all keep working through mesh.group. Limb refs
      // become inert stubs — the mixer clip animates the GLB instead.
      // clips is { idle, walk, run }: walk while moving, idle while
      // standing (switched in the update loop via setOfficerClip).
      const stub = () => ({ rotation: { x: 0 } });
      mesh.group = person.group;
      mesh.mixer = person.mixer || null;
      let moveClip = null;
      if (person.clips && person.clips.walk) moveClip = 'walk';
      else if (person.clips && person.clips.run) moveClip = 'run';
      mesh.moveClip = moveClip;
      mesh.setOfficerClip = (name) => loader.playClip(mesh.mixer, person.clips, name);
      mesh.isGLB = true;
      mesh.legLeft = stub();
      mesh.legRight = stub();
      mesh.armLeft = stub();
      mesh.armRight = stub();
      if (mesh.moveClip) mesh.setOfficerClip(mesh.moveClip);
    } catch (err) {
      mesh.nextRetryAt = this.clock + 2;
    } finally {
      mesh.upgradePending = false;
    }
  }
}
