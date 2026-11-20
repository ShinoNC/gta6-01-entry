import * as THREE from 'three';
import { createCar, waterCap } from './vehicles.js';
import { buildWalkerMesh } from './pedestrians.js';
import { roadLines } from './city.js';
import { headingFor } from './traffic.js';
import { pick, wrapAngle } from './random.js';
const CALLSIGNS = ['IBIS-43', 'GULL-1', 'TARPON-10', 'OSPREY-7', 'PELICAN-22', 'HERON-5', 'EGRET-9', 'TERN-3', 'STORK-8', 'CRANE-12'];
const HELI_CALLSIGN = 'HELI-1';
const SEE_RANGE = 45, TOP_SPEED = 38, TOP_SPEED_HOT = 41, TOP_SPEED_MAX = 44, TURN_RATE = 2.8, ACCEL = 16;
const RAM_DIST = 4.2, RAM_BACKOFF = 0.9, RAM_SLOW = 3.0, DIRECT_RANGE = 22, SNAP_RANGE = 35, OFFICER_SPEED = 5;
const RB_AHEAD = 45, RB_REPOSITION_S = 25, DESPAWN_S = 3, HELI_AHEAD = 22, HELI_SWEEP = 5;
const HELI_H = 14, HELI_SWEEP_S = 5, HELI_HP = 60, HELI_RESPAWN_S = 60;
function pursuitCarsForStars(stars) {
  return stars <= 0 ? 0 : stars === 1 ? 1 : stars === 2 ? 2 : stars === 3 ? 4 : stars === 4 ? 5 : 6;
}
// VRPD livery textures (shared across all units): POLICE in white with a
// navy outline reads on the white stripe, the blue body and the navy
// uniform alike; the door badge is the Vice Royale Police Department
// shield. MeshBasicMaterial so the lettering stays readable at night.
let policeTextMat = null, policeRoofMat = null, vrpdBadgeMat = null;
function liveryMaterials() {
  if (policeTextMat) return { policeTextMat, policeRoofMat, vrpdBadgeMat };
  const text = document.createElement('canvas');
  text.width = 512;
  text.height = 64;
  const tctx = text.getContext('2d');
  tctx.font = 'bold 52px "Courier New", monospace';
  tctx.textAlign = 'center';
  tctx.textBaseline = 'middle';
  tctx.lineWidth = 8;
  tctx.strokeStyle = '#1a2a6b';
  tctx.strokeText('POLICE', 256, 34);
  tctx.fillStyle = '#ffffff';
  tctx.fillText('POLICE', 256, 34);
  policeTextMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(text), transparent: true });
  // Roof text runs front-to-back, so it is drawn rotated in the canvas.
  const roof = document.createElement('canvas');
  roof.width = 128;
  roof.height = 256;
  const rctx = roof.getContext('2d');
  rctx.save();
  rctx.translate(64, 128);
  rctx.rotate(Math.PI / 2);
  rctx.font = 'bold 72px "Courier New", monospace';
  rctx.textAlign = 'center';
  rctx.textBaseline = 'middle';
  rctx.lineWidth = 10;
  rctx.strokeStyle = '#1a2a6b';
  rctx.strokeText('POLICE', 0, 0);
  rctx.fillStyle = '#ffffff';
  rctx.fillText('POLICE', 0, 0);
  rctx.restore();
  policeRoofMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(roof), transparent: true });
  const badge = document.createElement('canvas');
  badge.width = 64;
  badge.height = 64;
  const bctx = badge.getContext('2d');
  bctx.fillStyle = '#1a2a6b';
  bctx.beginPath();
  bctx.moveTo(32, 4);
  bctx.lineTo(58, 14);
  bctx.lineTo(58, 34);
  bctx.quadraticCurveTo(58, 54, 32, 60);
  bctx.quadraticCurveTo(6, 54, 6, 34);
  bctx.lineTo(6, 14);
  bctx.closePath();
  bctx.fill();
  bctx.strokeStyle = '#ffd978';
  bctx.lineWidth = 3;
  bctx.stroke();
  bctx.fillStyle = '#ffffff';
  bctx.font = 'bold 15px "Courier New", monospace';
  bctx.textAlign = 'center';
  bctx.textBaseline = 'middle';
  bctx.fillText('VRPD', 32, 32);
  vrpdBadgeMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(badge), transparent: true });
  return { policeTextMat, policeRoofMat, vrpdBadgeMat };
}
export class Police {
  constructor(scene, textures, city, rng) {
    this.scene = scene;
    this.textures = textures;
    this.city = city;
    this.rng = rng;
    this.lines = roadLines();
    this.crossX = this.lines.filter((line) => line.axis === 'z').map((line) => line.at);
    this.crossZ = this.lines.filter((line) => line.axis === 'x').map((line) => line.at);
    this.pursuit = [];
    this.roadblock = [];
    this.roadblockCentre = null;
    this.roadblockTimer = 0;
    this.helicopter = null;
    this.heliHp = HELI_HP;
    this.heliCooldown = 0;
    this.lostTimer = 0;
    this.clock = 0;
    this.callsignIndex = 0;
  }
  hasLineOfSight(from, to) {
    for (const box of this.city.buildingBoxes) {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      let t0 = 0;
      let t1 = 1;
      for (const [p, d, lo, hi] of [[from.x, dx, box.minX, box.maxX], [from.z, dz, box.minZ, box.maxZ]]) {
        if (Math.abs(d) < 1e-9) {
          if (p < lo || p > hi) { t0 = 1; t1 = 0; break; }
        } else {
          let a = (lo - p) / d;
          let b = (hi - p) / d;
          if (a > b) { const t = a; a = b; b = t; }
          t0 = Math.max(t0, a);
          t1 = Math.min(t1, b);
          if (t0 > t1) break;
        }
      }
      if (t0 <= t1) return false;
    }
    return true;
  }
  damageHelicopter(amount) {
    if (!this.helicopter) return false;
    this.heliHp -= amount;
    if (this.heliHp > 0) return false;
    this.removeHelicopter();
    this.heliCooldown = HELI_RESPAWN_S;
    return true;
  }
  nextCallsign() {
    const inUse = new Set([...this.pursuit, ...this.roadblock].map((unit) => unit.callsign));
    for (const callsign of CALLSIGNS) {
      if (!inUse.has(callsign)) return callsign;
    }
    return CALLSIGNS[this.callsignIndex++ % CALLSIGNS.length];
  }
  createPoliceCar(x, z, heading, callsign) {
    const car = createCar(this.scene, this.textures, 'POLICE', this.textures.carBlue, 0xf2f2f2, x, z, heading);
    const bg = new THREE.BoxGeometry(0.5, 0.18, 0.32);
    const redMaterial = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
    const blueMaterial = new THREE.MeshBasicMaterial({ color: 0x2a6bff });
    // Light bar at the front edge of the roof, leaving the rear roof free
    // for the POLICE lettering.
    for (const [m, x] of [[redMaterial, -0.35], [blueMaterial, 0.35]]) {
      const light = new THREE.Mesh(bg, m);
      light.position.set(x, 1.52, 0.75);
      car.group.add(light);
    }
    // White side stripes + white roof: the livery reads as police from
    // the side, not just from the light bar on top.
    const stripeMat = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    for (const side of [-0.96, 0.96]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.3, 4.0), stripeMat);
      stripe.position.set(side, 0.55, 0);
      car.group.add(stripe);
    }
    // POLICE lettering on both sides, the roof (readable from above) and
    // the hood/trunk, plus the VRPD door badge.
    const { policeTextMat, policeRoofMat, vrpdBadgeMat } = liveryMaterials();
    for (const side of [-1, 1]) {
      const lettering = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.42), policeTextMat);
      lettering.position.set(side * 0.99, 0.55, 0);
      lettering.rotation.y = (side * Math.PI) / 2;
      car.group.add(lettering);
      const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), vrpdBadgeMat);
      badge.position.set(side * 0.99, 0.62, 0.9);
      badge.rotation.y = (side * Math.PI) / 2;
      car.group.add(badge);
    }
    const roofLettering = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.9), policeRoofMat);
    roofLettering.position.set(0, 1.46, -0.3);
    roofLettering.rotation.x = -Math.PI / 2;
    car.group.add(roofLettering);
    for (const hz of [1.9, -1.9]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.4), policeTextMat);
      plate.position.set(0, 0.87, hz);
      plate.rotation.x = -Math.PI / 2;
      car.group.add(plate);
    }
    return { car, callsign, status: 'PURSUIT', ramCooldown: 0, shootCooldown: 1 + Math.random() * 2, redMaterial, blueMaterial, escortSide: 0, officer: null };
  }
  removeUnit(unit) {
    this.scene.remove(unit.car.group);
    if (unit.officer) this.scene.remove(unit.officer.group);
  }
  // Drop every unit + helicopter at once (BUSTED/WASTED, heat cooled off).
  clearAll() {
    for (const unit of [...this.pursuit, ...this.roadblock]) this.removeUnit(unit);
    this.pursuit = [];
    this.roadblock = [];
    this.roadblockCentre = null;
    this.removeHelicopter();
    this.lostTimer = 0;
  }
  spawnPursuitCar(playerPos, spawnDistance) {
    let line = pick(this.rng, this.lines);
    let along = line.from + this.rng() * (line.to - line.from);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const c = pick(this.rng, this.lines);
      const a = c.from + this.rng() * (c.to - c.from);
      const dist = Math.hypot((c.axis === 'z' ? c.at : a) - playerPos.x, (c.axis === 'z' ? a : c.at) - playerPos.z);
      if (dist > spawnDistance - 15 && dist < spawnDistance + 20) { line = c; along = a; break; }
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
  placeOnRoad(unit) {
    if (unit.line.axis === 'z') unit.car.group.position.set(unit.line.at, 0, unit.along);
    else unit.car.group.position.set(unit.along, 0, unit.line.at);
    unit.car.heading = headingFor(unit.line.axis, unit.direction);
    unit.car.group.rotation.y = unit.car.heading;
  }
  snapToRoad(unit, playerPos) {
    let bestLine = this.lines[0];
    let bestLateral = Infinity;
    for (const line of this.lines) {
      const lateral = line.axis === 'z' ? Math.abs(unit.car.position.x - line.at) : Math.abs(unit.car.position.z - line.at);
      if (lateral < bestLateral) {
        bestLateral = lateral;
        bestLine = line;
      }
    }
    unit.line = bestLine;
    unit.along = bestLine.axis === 'z' ? unit.car.position.z : unit.car.position.x;
    unit.along = Math.max(bestLine.from, Math.min(bestLine.to, unit.along));
    const playerAlong = bestLine.axis === 'z' ? playerPos.z : playerPos.x;
    unit.direction = playerAlong >= unit.along ? 1 : -1;
    unit.mode = 'road';
    unit.turnCooldown = 0;
    this.placeOnRoad(unit);
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
    for (const cross of crosses) {
      if (Math.abs(unit.along - cross) > window) continue;
      const crossLine = this.lines.find((line) => line.axis !== unit.line.axis && line.at === cross);
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
    for (const unit of this.roadblock) this.removeUnit(unit);
    this.roadblock = [];
    const fx = Math.sin(playerHeading);
    const fz = Math.cos(playerHeading);
    const centreX = playerPos.x + fx * RB_AHEAD;
    const centreZ = playerPos.z + fz * RB_AHEAD;
    const px = fz;
    const pz = -fx;
    const sides = stars >= 4 ? [-1, 0, 1] : [-1, 1];
    for (const side of sides) {
      const unit = this.createPoliceCar(centreX + px * side * 2.4, centreZ + pz * side * 2.4, playerHeading + Math.PI / 2, this.nextCallsign());
      unit.status = 'ROADBLOCK';
      this.city.resolveCircle(unit.car.group.position, 1.6);
      this.roadblock.push(unit);
    }
    this.roadblockCentre = { x: centreX, z: centreZ };
    this.roadblockTimer = 0;
  }
  buildHelicopter() {
    const group = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fd4e8 });
    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    box(2.2, 1.3, 3.6, white, 0, 0.8, 0);
    box(1.9, 0.9, 1.0, glass, 0, 0.8, 2.0);
    box(0.4, 0.4, 3.4, white, 0, 1.0, -3.2);
    const skidRight = box(0.15, 0.15, 3.0, dark, -0.9, 0, 0).clone();
    skidRight.position.x = 0.9;
    group.add(skidRight);
    const rotor = new THREE.Group();
    const bladeGeometry = new THREE.BoxGeometry(7.5, 0.06, 0.3);
    const bladeB = new THREE.Mesh(bladeGeometry, dark);
    bladeB.rotation.y = Math.PI / 2;
    rotor.add(new THREE.Mesh(bladeGeometry, dark), bladeB);
    rotor.position.y = 1.7;
    group.add(rotor);
    this.scene.add(group);
    const glow = (o, side) => new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: o, blending: THREE.AdditiveBlending, side, depthWrite: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(5, 30, 16, 1, true), glow(0.16, THREE.DoubleSide));
    this.scene.add(cone);
    const spotlight = new THREE.Mesh(new THREE.CircleGeometry(6, 24), glow(0.22, THREE.FrontSide));
    spotlight.rotation.x = -Math.PI / 2;
    spotlight.position.y = 0.08;
    this.scene.add(spotlight);
    this.helicopter = { group, rotor, cone, spotlight, sweepPhase: -Math.PI / 2 };
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
    for (const side of [1, -1]) {
      const escort = this.createPoliceCar(playerPos.x + forwardX * 10 + sideX * 3 * side, playerPos.z + forwardZ * 10 + sideZ * 3 * side, playerHeading, this.nextCallsign());
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
  update(dt, context) {
    this.clock += dt;
    const { playerPos, playerHeading, driving, drivenCar, wantedStars } = context;
    for (const unit of this.pursuit) if (unit.car.destroyed && unit.officer) this.scene.remove(unit.officer.group);
    this.pursuit = this.pursuit.filter((unit) => !unit.car.destroyed);
    this.roadblock = this.roadblock.filter((unit) => !unit.car.destroyed);
    if (wantedStars === 0) {
      this.lostTimer += dt;
      if (this.lostTimer > DESPAWN_S) this.clearAll();
    } else {
      this.lostTimer = 0;
    }
    const wantedPursuit = pursuitCarsForStars(wantedStars);
    while (this.pursuit.length < wantedPursuit) this.spawnPursuitCar(playerPos, 65);
    if (wantedStars > 0 || this.lostTimer > DESPAWN_S) {
      while (this.pursuit.length > wantedPursuit) this.removeUnit(this.pursuit.pop());
    }
    this.heliCooldown = Math.max(0, this.heliCooldown - dt);
    if (wantedStars >= 3) {
      if (this.roadblock.length === 0) {
        this.placeRoadblock(playerPos, playerHeading, wantedStars);
      } else {
        this.roadblockTimer += dt;
        const fx = Math.sin(playerHeading);
        const fz = Math.cos(playerHeading);
        const passed = (playerPos.x - this.roadblockCentre.x) * fx + (playerPos.z - this.roadblockCentre.z) * fz > 8;
        if (passed || this.roadblockTimer > RB_REPOSITION_S) {
          this.placeRoadblock(playerPos, playerHeading, wantedStars);
        }
      }
      if (!this.helicopter && this.heliCooldown <= 0) {
        this.heliHp = HELI_HP;
        this.buildHelicopter();
      }
    } else {
      for (const unit of this.roadblock) this.removeUnit(unit);
      this.roadblock = [];
      this.roadblockCentre = null;
      this.removeHelicopter();
    }
    const blinkOn = Math.floor(this.clock * 2.8) % 2 === 0;
    const flash = (unit) => {
      unit.redMaterial.color.setHex(blinkOn ? 0xff2a3a : 0x551018);
      unit.blueMaterial.color.setHex(blinkOn ? 0x10204d : 0x2a6bff);
    };
    const topSpeed = wantedStars >= 5 ? TOP_SPEED_MAX : wantedStars >= 4 ? TOP_SPEED_HOT : TOP_SPEED;
    const steerTo = (car, desired) => {
      car.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, wrapAngle(desired - car.heading)));
    };
    for (const unit of this.pursuit) {
      flash(unit);
      const car = unit.car;
      const dx = playerPos.x - car.position.x;
      const dz = playerPos.z - car.position.z;
      const dist = Math.hypot(dx, dz);
      if (unit.mode === 'road' && dist < DIRECT_RANGE) unit.mode = 'direct';
      if (unit.mode === 'direct' && dist > SNAP_RANGE) this.snapToRoad(unit, playerPos);
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
        car.speed = Math.min(topSpeed, car.speed + ACCEL * dt);
        this.maybeTurnAtIntersection(unit, playerPos, dt);
        unit.along += unit.direction * car.speed * dt;
        if (unit.along < unit.line.from || unit.along > unit.line.to) unit.direction *= -1;
        this.placeOnRoad(unit);
      } else {
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
          steerTo(car, playerHeading + Math.max(-0.7, Math.min(0.7, latErr * 0.15)));
          const playerSpeed = drivenCar ? drivenCar.speed : 0;
          const targetSpeed = Math.max(0, Math.min(topSpeed, playerSpeed + alongErr * 1.2));
          car.speed += Math.max(-30 * dt, Math.min(ACCEL * dt, targetSpeed - car.speed));
          unit.status = 'ESCORT';
        } else {
          steerTo(car, Math.atan2(dx, dz));
          if (unit.ramCooldown > 0) {
            unit.ramCooldown -= dt;
            car.speed = -6;
          } else if (driving && dist < RAM_DIST) {
            unit.status = 'RAMMING';
            drivenCar.speed *= Math.max(0, 1 - RAM_SLOW * dt);
            car.speed = 4;
            unit.ramCooldown = RAM_BACKOFF;
          } else {
            unit.status = 'PURSUIT';
            car.speed = Math.min(topSpeed, car.speed + ACCEL * dt);
            if (!driving && dist < 3) car.speed = 0;
          }
        }
        // The sea stops a pursuit car like any other: it stalls in deep
        // water and can only drive back out toward shore.
        const water = waterCap(this.city, car.position.x, car.position.z, car.heading, car.speed, topSpeed, 6);
        car.speed = water.speed;
        car.group.position.y = -Math.min(water.depth * 0.5, 0.6);
        car.group.position.x += Math.sin(car.heading) * car.speed * dt;
        car.group.position.z += Math.cos(car.heading) * car.speed * dt;
        const beforeX = car.group.position.x;
        const beforeZ = car.group.position.z;
        this.city.resolveCircle(car.group.position, 1.6);
        if (car.group.position.x !== beforeX || car.group.position.z !== beforeZ) car.speed *= 0.4;
        car.group.rotation.y = car.heading;
      }
      if (!driving && wantedStars >= 1 && !unit.officer && car.speed === 0 && dist < 3.5) {
        const mesh = buildWalkerMesh(0x24457e, 0x14141c, 0xd9a077, 0x201510, 'police', 1);
        mesh.group.position.set(car.position.x + Math.cos(car.heading) * 1.8, 0, car.position.z - Math.sin(car.heading) * 1.8);
        this.city.resolveCircle(mesh.group.position, 0.5);
        const backText = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), liveryMaterials().policeTextMat);
        backText.position.set(0, 1.35, -0.22);
        backText.rotation.y = Math.PI;
        mesh.group.add(backText);
        mesh.returning = false;
        mesh.walkPhase = 0;
        this.scene.add(mesh.group);
        unit.officer = mesh;
      }
      const officer = unit.officer;
      if (officer) {
        const op = officer.group.position;
        const odist = Math.hypot(playerPos.x - op.x, playerPos.z - op.z);
        if (driving || wantedStars === 0 || odist > 18) officer.returning = true;
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
          // Officers do not swim: they stop at the shoreline and wait.
          // A step into water deeper than 0.5m is blocked unless it leads
          // back to shallower ground (an officer caught in deep water
          // walks back out).
          const step = Math.min(OFFICER_SPEED * dt, tdist);
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
        }
      }
      const shooter = unit.officer ? unit.officer.group : car;
      if (wantedStars >= 3 && dist < 42 && this.hasLineOfSight(shooter.position, playerPos)) {
        unit.shootCooldown -= dt;
        if (unit.shootCooldown <= 0) {
          unit.shootCooldown = 1.1 + Math.random() * 0.9;
          unit.status = 'SHOOTING';
          context.onPoliceShot?.(shooter.position, playerPos);
        }
      } else if (unit.status === 'SHOOTING') unit.status = 'PURSUIT';
      for (const wheel of car.wheels) {
        wheel.wheel.rotation.x += (car.speed / 0.36) * dt;
      }
    }
    for (const unit of this.roadblock) flash(unit);
    if (this.helicopter) {
      const heli = this.helicopter;
      heli.sweepPhase += (dt / HELI_SWEEP_S) * Math.PI * 2;
      const forwardX = Math.sin(playerHeading);
      const forwardZ = Math.cos(playerHeading);
      const sideX = forwardZ;
      const sideZ = -forwardX;
      const sweep = Math.sin(heli.sweepPhase) * HELI_SWEEP;
      heli.group.position.set(
        playerPos.x + forwardX * HELI_AHEAD + sideX * sweep,
        HELI_H,
        playerPos.z + forwardZ * HELI_AHEAD + sideZ * sweep,
      );
      const target = new THREE.Vector3(playerPos.x, 0, playerPos.z);
      heli.group.lookAt(target);
      heli.rotor.rotation.y += dt * 28;
      const toHeli = new THREE.Vector3().subVectors(heli.group.position, target);
      const distance = toHeli.length();
      heli.cone.position.copy(heli.group.position).add(target).multiplyScalar(0.5);
      heli.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), toHeli.normalize());
      heli.cone.scale.set(1, distance / 30, 1);
      heli.spotlight.position.set(playerPos.x, 0.08, playerPos.z);
      heli.spotlight.material.opacity = 0.18 + 0.08 * Math.sin(this.clock * 4);
    }
  }
  units(playerPos) {
    const distanceTo = (unit) =>
      Math.round(Math.hypot(unit.car.position.x - playerPos.x, unit.car.position.z - playerPos.z));
    const rows = [...this.pursuit, ...this.roadblock].map((unit) => ({
      callsign: unit.callsign,
      distanceMetres: distanceTo(unit),
      status: unit.status,
    }));
    if (this.helicopter) {
      const h = this.helicopter.group.position;
      rows.push({ callsign: HELI_CALLSIGN, distanceMetres: Math.round(Math.hypot(h.x - playerPos.x, h.z - playerPos.z)), status: 'SPOTLIGHT' });
    }
    return rows;
  }
  canSeePlayer(playerPos) {
    return [...this.pursuit, ...this.roadblock].some((u) => {
      const d = Math.hypot(u.car.position.x - playerPos.x, u.car.position.z - playerPos.z);
      return d < SEE_RANGE && this.hasLineOfSight(u.car.position, playerPos);
    });
  }
  nearestDistance(playerPos) {
    let n = Infinity;
    for (const unit of this.pursuit) {
      n = Math.min(n, Math.hypot(unit.car.position.x - playerPos.x, unit.car.position.z - playerPos.z));
      const op = unit.officer?.group.position;
      if (op) n = Math.min(n, Math.hypot(op.x - playerPos.x, op.z - playerPos.z));
    }
    return n;
  }
  allCarPositions() {
    return [...this.pursuit, ...this.roadblock].map((unit) => ({ x: unit.car.position.x, z: unit.car.position.z }));
  }
}