// Police response: pursuit cars that chase and ram the player's car,
// roadblocks at 3+ stars, and a spotlight helicopter at 3+ stars. Pursuit
// cars route along the road grid and only cut across ground for the ram.
import * as THREE from 'three';
import { createCar } from './vehicles.js';
import { roadLines } from './city.js';
import { headingFor } from './traffic.js';
import { pick } from './random.js';

const POLICE_UNIT_CALLSIGNS = ['IBIS-43', 'GULL-1', 'TARPON-10', 'OSPREY-7', 'PELICAN-22', 'HERON-5', 'EGRET-9'];
const HELICOPTER_CALLSIGN = 'HELI-1';
const POLICE_SEE_RANGE = 45;
const PURSUIT_TOP_SPEED = 32;
const PURSUIT_TOP_SPEED_HIGH_HEAT = 36;
const PURSUIT_TURN_RATE = 2.4;
const RAM_DISTANCE = 3.6;
const RAM_BACKOFF_SECONDS = 1.2;
const DIRECT_PURSUIT_RANGE = 22;
const ROAD_SNAP_RANGE = 35;
const ROADBLOCK_AHEAD_METRES = 45;
const ROADBLOCK_REPOSITION_SECONDS = 25;
const DESPAWN_AFTER_LOST_SECONDS = 3;
const HELICOPTER_CIRCLE_RADIUS = 24;
const HELICOPTER_HEIGHT = 27;

function pursuitCarsForStars(stars) {
  if (stars <= 0) return 0;
  if (stars === 1) return 1;
  if (stars <= 3) return 2;
  return 3;
}

function wrapAngle(angle) {
  let wrapped = angle;
  while (wrapped > Math.PI) wrapped -= Math.PI * 2;
  while (wrapped < -Math.PI) wrapped += Math.PI * 2;
  return wrapped;
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
    this.lostTimer = 0;
    this.clock = 0;
    this.callsignIndex = 0;
  }

  nextCallsign() {
    const inUse = new Set([...this.pursuit, ...this.roadblock].map((unit) => unit.callsign));
    for (const callsign of POLICE_UNIT_CALLSIGNS) {
      if (!inUse.has(callsign)) return callsign;
    }
    return POLICE_UNIT_CALLSIGNS[this.callsignIndex++ % POLICE_UNIT_CALLSIGNS.length];
  }

  createPoliceCar(x, z, heading, callsign) {
    const car = createCar(this.scene, this.textures, 'POLICE', this.textures.carBlue, 0xf2f2f2, x, z, heading);
    const barGeometry = new THREE.BoxGeometry(0.5, 0.18, 0.32);
    const redMaterial = new THREE.MeshBasicMaterial({ color: 0xff2a3a });
    const blueMaterial = new THREE.MeshBasicMaterial({ color: 0x2a6bff });
    for (const [material, x] of [
      [redMaterial, -0.35],
      [blueMaterial, 0.35],
    ]) {
      const light = new THREE.Mesh(barGeometry, material);
      light.position.set(x, 1.52, -0.2);
      car.group.add(light);
    }
    return { car, callsign, status: 'PURSUIT', ramCooldown: 0, redMaterial, blueMaterial };
  }

  removeUnit(unit) {
    this.scene.remove(unit.car.group);
  }

  spawnPursuitCar(playerPos, spawnDistance) {
    let line = pick(this.rng, this.lines);
    let along = line.from + this.rng() * (line.to - line.from);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = pick(this.rng, this.lines);
      const candidateAlong = candidate.from + this.rng() * (candidate.to - candidate.from);
      const candidateX = candidate.axis === 'z' ? candidate.at : candidateAlong;
      const candidateZ = candidate.axis === 'z' ? candidateAlong : candidate.at;
      const dist = Math.hypot(candidateX - playerPos.x, candidateZ - playerPos.z);
      if (dist > spawnDistance - 15 && dist < spawnDistance + 20) {
        line = candidate;
        along = candidateAlong;
        break;
      }
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

  // At an intersection, turn onto the cross-street when the player is off
  // this road: Manhattan routing, one axis at a time. The cooldown stops
  // the car turning straight back at the intersection it just left.
  maybeTurnAtIntersection(unit, playerPos) {
    if (unit.turnCooldown > 0) return;
    const crosses = unit.line.axis === 'z' ? this.crossZ : this.crossX;
    const playerLateral = unit.line.axis === 'z' ? playerPos.x : playerPos.z;
    const playerAlong = unit.line.axis === 'z' ? playerPos.z : playerPos.x;
    if (Math.abs(playerLateral - unit.line.at) <= 8) {
      // The player is on this road: drive straight toward them.
      unit.direction = playerAlong >= unit.along ? 1 : -1;
      return;
    }
    for (const cross of crosses) {
      if (Math.abs(unit.along - cross) > 2.5) continue;
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

  placeRoadblock(playerPos, playerHeading) {
    for (const unit of this.roadblock) this.removeUnit(unit);
    this.roadblock = [];
    const fx = Math.sin(playerHeading);
    const fz = Math.cos(playerHeading);
    const centreX = playerPos.x + fx * ROADBLOCK_AHEAD_METRES;
    const centreZ = playerPos.z + fz * ROADBLOCK_AHEAD_METRES;
    const px = fz;
    const pz = -fx;
    for (const side of [-1, 1]) {
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
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f2 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
    const glass = new THREE.MeshLambertMaterial({ color: 0x9fd4e8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.3, 3.6), white);
    body.position.y = 0.8;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.9, 1.0), glass);
    nose.position.set(0, 0.8, 2.0);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 3.4), white);
    tail.position.set(0, 1.0, -3.2);
    const skidLeft = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 3.0), dark);
    skidLeft.position.set(-0.9, 0, 0);
    const skidRight = skidLeft.clone();
    skidRight.position.x = 0.9;
    const rotor = new THREE.Group();
    const bladeGeometry = new THREE.BoxGeometry(7.5, 0.06, 0.3);
    const bladeA = new THREE.Mesh(bladeGeometry, dark);
    const bladeB = new THREE.Mesh(bladeGeometry, dark);
    bladeB.rotation.y = Math.PI / 2;
    rotor.add(bladeA, bladeB);
    rotor.position.y = 1.7;
    group.add(body, nose, tail, skidLeft, skidRight, rotor);
    this.scene.add(group);
    const beamMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(5, 30, 16, 1, true), beamMaterial);
    this.scene.add(cone);
    const spotMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
    const spotlight = new THREE.Mesh(new THREE.CircleGeometry(6, 24), spotMaterial);
    spotlight.rotation.x = -Math.PI / 2;
    spotlight.position.y = 0.08;
    this.scene.add(spotlight);
    this.helicopter = { group, rotor, cone, spotlight, angle: 0 };
  }

  removeHelicopter() {
    if (!this.helicopter) return;
    this.scene.remove(this.helicopter.group, this.helicopter.cone, this.helicopter.spotlight);
    this.helicopter = null;
  }

  stageChase(playerPos, playerHeading) {
    while (this.pursuit.length < 2) this.spawnPursuitCar(playerPos, 30);
    this.placeRoadblock(playerPos, playerHeading);
    if (!this.helicopter) this.buildHelicopter();
  }

  update(dt, context) {
    this.clock += dt;
    const { playerPos, playerHeading, driving, drivenCar, wantedStars } = context;

    if (wantedStars === 0) {
      this.lostTimer += dt;
      if (this.lostTimer > DESPAWN_AFTER_LOST_SECONDS) {
        for (const unit of [...this.pursuit, ...this.roadblock]) this.removeUnit(unit);
        this.pursuit = [];
        this.roadblock = [];
        this.roadblockCentre = null;
        this.removeHelicopter();
      }
    } else {
      this.lostTimer = 0;
    }

    const wantedPursuit = pursuitCarsForStars(wantedStars);
    while (this.pursuit.length < wantedPursuit) this.spawnPursuitCar(playerPos, 65);
    if (wantedStars > 0 || this.lostTimer > DESPAWN_AFTER_LOST_SECONDS) {
      while (this.pursuit.length > wantedPursuit) this.removeUnit(this.pursuit.pop());
    }

    if (wantedStars >= 3) {
      if (this.roadblock.length === 0) {
        this.placeRoadblock(playerPos, playerHeading);
      } else {
        this.roadblockTimer += dt;
        const fx = Math.sin(playerHeading);
        const fz = Math.cos(playerHeading);
        const passed = (playerPos.x - this.roadblockCentre.x) * fx + (playerPos.z - this.roadblockCentre.z) * fz > 8;
        if (passed || this.roadblockTimer > ROADBLOCK_REPOSITION_SECONDS) {
          this.placeRoadblock(playerPos, playerHeading);
        }
      }
      if (!this.helicopter) this.buildHelicopter();
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

    const topSpeed = wantedStars >= 4 ? PURSUIT_TOP_SPEED_HIGH_HEAT : PURSUIT_TOP_SPEED;
    for (const unit of this.pursuit) {
      flash(unit);
      const car = unit.car;
      const dx = playerPos.x - car.position.x;
      const dz = playerPos.z - car.position.z;
      const dist = Math.hypot(dx, dz);
      if (unit.mode === 'road' && dist < DIRECT_PURSUIT_RANGE) unit.mode = 'direct';
      if (unit.mode === 'direct' && dist > ROAD_SNAP_RANGE) this.snapToRoad(unit, playerPos);
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
        car.speed = Math.min(topSpeed, car.speed + 14 * dt);
        this.maybeTurnAtIntersection(unit, playerPos);
        unit.along += unit.direction * car.speed * dt;
        if (unit.along < unit.line.from || unit.along > unit.line.to) unit.direction *= -1;
        this.placeOnRoad(unit);
      } else {
        const desiredHeading = Math.atan2(dx, dz);
        const turn = Math.max(-PURSUIT_TURN_RATE * dt, Math.min(PURSUIT_TURN_RATE * dt, wrapAngle(desiredHeading - car.heading)));
        car.heading += turn;
        if (unit.ramCooldown > 0) {
          unit.ramCooldown -= dt;
          car.speed = -6;
        } else if (driving && dist < RAM_DISTANCE) {
          unit.status = 'RAMMING';
          drivenCar.speed *= Math.max(0, 1 - 2.2 * dt);
          car.speed = 4;
          unit.ramCooldown = RAM_BACKOFF_SECONDS;
        } else {
          unit.status = 'PURSUIT';
          car.speed = Math.min(topSpeed, car.speed + 14 * dt);
          if (!driving && dist < 6) car.speed = 0;
        }
        car.group.position.x += Math.sin(car.heading) * car.speed * dt;
        car.group.position.z += Math.cos(car.heading) * car.speed * dt;
        const beforeX = car.group.position.x;
        const beforeZ = car.group.position.z;
        this.city.resolveCircle(car.group.position, 1.6);
        if (car.group.position.x !== beforeX || car.group.position.z !== beforeZ) car.speed *= 0.4;
        car.group.rotation.y = car.heading;
      }
      for (const wheel of car.wheels) {
        wheel.wheel.rotation.x += (car.speed / 0.36) * dt;
      }
    }
    for (const unit of this.roadblock) flash(unit);

    if (this.helicopter) {
      const heli = this.helicopter;
      heli.angle += dt * 0.5;
      heli.group.position.set(
        playerPos.x + Math.cos(heli.angle) * HELICOPTER_CIRCLE_RADIUS,
        HELICOPTER_HEIGHT,
        playerPos.z + Math.sin(heli.angle) * HELICOPTER_CIRCLE_RADIUS,
      );
      heli.group.lookAt(playerPos.x, 0, playerPos.z);
      heli.rotor.rotation.y += dt * 28;
      const toHeli = new THREE.Vector3().subVectors(heli.group.position, new THREE.Vector3(playerPos.x, 0, playerPos.z));
      const distance = toHeli.length();
      heli.cone.position.copy(heli.group.position).add(new THREE.Vector3(playerPos.x, 0, playerPos.z)).multiplyScalar(0.5);
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
      rows.push({
        callsign: HELICOPTER_CALLSIGN,
        distanceMetres: Math.round(
          Math.hypot(this.helicopter.group.position.x - playerPos.x, this.helicopter.group.position.z - playerPos.z),
        ),
        status: 'SPOTLIGHT',
      });
    }
    return rows;
  }

  canSeePlayer(playerPos) {
    for (const unit of [...this.pursuit, ...this.roadblock]) {
      if (Math.hypot(unit.car.position.x - playerPos.x, unit.car.position.z - playerPos.z) < POLICE_SEE_RANGE) {
        return true;
      }
    }
    return false;
  }

  nearestDistance(playerPos) {
    let nearest = Infinity;
    for (const unit of this.pursuit) {
      nearest = Math.min(nearest, Math.hypot(unit.car.position.x - playerPos.x, unit.car.position.z - playerPos.z));
    }
    return nearest;
  }

  allCarPositions() {
    return [...this.pursuit, ...this.roadblock].map((unit) => ({ x: unit.car.position.x, z: unit.car.position.z }));
  }
}
