import * as THREE from 'three';
import { roadLines } from './city.js';
import { chance, pick, range } from './random.js';
const PEDESTRIAN_COUNT = 20;
const SIDEWALK_OFFSET = 7.6;
const WALK_MIN_SPEED = 1.1;
const WALK_MAX_SPEED = 2.0;
const FLEE_SPEED = 6.5;
const FLEE_SECONDS = 4;
const KNOCKED_DOWN_SECONDS = 3;
const CAR_SCARE_RANGE = 11;
const GUNSHOT_SCARE_RANGE = 28;
const SCREAM_COOLDOWN_SECONDS = 4;
const LEG_SWING = 0.5;
const FREEZE_CHANCE = 0.2;
const FLEE_RESTEEER_SECONDS = 0.6;
export const SHIRT_COLOURS = [0xff5a7a, 0x7ac4ff, 0xffd978, 0x7affc4, 0xc47aff, 0xff9a5a, 0xffffff, 0x5ad0d0];
const PANTS_COLOURS = [0x2a4a8a, 0x3a3a44, 0x6b4a2a, 0x2a6b4a];
export const SKIN_COLOURS = [0xe8b07a, 0xc98a5a, 0x8a5a3a, 0xf2c9a0];
export const HAIR_COLOURS = [0x241a2a, 0x4a2a1a, 0x8a6a3a, 0xd8d8d8, 0x1a1a1a, 0x7a3a2a];
const HAT_COLOURS = [0xffd978, 0x7ac4ff, 0xff5a7a, 0xe8e8e8];
export function buildWalkerMesh(shirtColour, pantsColour, skinColour, hairColour, hat, heightScale) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColour });
  const pants = new THREE.MeshLambertMaterial({ color: pantsColour });
  const skin = new THREE.MeshLambertMaterial({ color: skinColour });
  const hair = new THREE.MeshLambertMaterial({ color: hairColour });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.8, 0.4), shirt);
  torso.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), skin);
  head.position.y = 1.78;
  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), hair);
  hairTop.position.y = 2.03;
  group.add(torso, head, hairTop);
  if (hat === 'cap') {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.52), new THREE.MeshLambertMaterial({ color: pickHatColour() }));
    cap.position.y = 2.12;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.24), cap.material);
    brim.position.set(0, 2.08, 0.32);
    group.add(cap, brim);
  } else if (hat === 'brim') {
    const brimHat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.72), new THREE.MeshLambertMaterial({ color: 0xf2e2b0 }));
    brimHat.position.y = 2.1;
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.4), brimHat.material);
    crown.position.y = 2.2;
    group.add(brimHat, crown);
  }
  function limb(geometry, material, x, y) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, 0);
    return mesh;
  }
  const legGeometry = new THREE.BoxGeometry(0.24, 0.72, 0.24);
  legGeometry.translate(0, -0.36, 0);
  const armGeometry = new THREE.BoxGeometry(0.18, 0.7, 0.18);
  armGeometry.translate(0, -0.35, 0);
  const legLeft = limb(legGeometry, pants, -0.18, 0.72);
  const legRight = limb(legGeometry, pants, 0.18, 0.72);
  const armLeft = limb(armGeometry, skin, -0.44, 1.42);
  const armRight = limb(armGeometry, skin, 0.44, 1.42);
  group.add(legLeft, legRight, armLeft, armRight);
  group.scale.setScalar(heightScale);
  return { group, legLeft, legRight, armLeft, armRight };
}
let hatColourIndex = 0;
function pickHatColour() {
  hatColourIndex = (hatColourIndex + 1) % HAT_COLOURS.length;
  return HAT_COLOURS[hatColourIndex];
}
export class Pedestrians {
  constructor(scene, rng, onScream) {
    this.lines = roadLines();
    this.rng = rng;
    this.onScream = onScream;
    this.screamCooldown = 0;
    this.peds = [];
    for (let i = 0; i < PEDESTRIAN_COUNT; i += 1) {
      const hat = chance(rng, 0.3) ? 'cap' : chance(rng, 0.2) ? 'brim' : 'none';
      const mesh = buildWalkerMesh(
        pick(rng, SHIRT_COLOURS),
        pick(rng, PANTS_COLOURS),
        pick(rng, SKIN_COLOURS),
        pick(rng, HAIR_COLOURS),
        hat,
        range(rng, 0.88, 1.08),
      );
      const line = pick(rng, this.lines);
      const ped = {
        mesh,
        line,
        side: rng() < 0.5 ? -1 : 1,
        direction: rng() < 0.5 ? -1 : 1,
        along: line.from + rng() * (line.to - line.from),
        walkSpeed: WALK_MIN_SPEED + rng() * (WALK_MAX_SPEED - WALK_MIN_SPEED),
        fleeTimer: 0,
        fleeDx: 0,
        fleeDz: 1,
        fleeFromX: 0,
        fleeFromZ: 0,
        resteeerTimer: 0,
        frozen: false,
        knockedTimer: 0,
        lastHitX: 0,
        lastHitZ: 0,
        walkPhase: rng() * 6,
      };
      this.placeOnSidewalk(ped);
      scene.add(mesh.group);
      this.peds.push(ped);
    }
  }
  get fleeingCount() {
    return this.peds.filter((ped) => ped.fleeTimer > 0).length;
  }
  placeOnSidewalk(ped) {
    const offset = SIDEWALK_OFFSET * ped.side;
    if (ped.line.axis === 'z') {
      ped.mesh.group.position.set(ped.line.at + offset, 0, ped.along);
      ped.mesh.group.rotation.y = ped.direction > 0 ? 0 : Math.PI;
    } else {
      ped.mesh.group.position.set(ped.along, 0, ped.line.at + offset);
      ped.mesh.group.rotation.y = ped.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }
  fleeFrom(ped, fromX, fromZ) {
    const pos = ped.mesh.group.position;
    const dx = pos.x - fromX;
    const dz = pos.z - fromZ;
    const dist = Math.hypot(dx, dz) || 1;
    ped.fleeDx = dx / dist;
    ped.fleeDz = dz / dist;
    ped.fleeFromX = fromX;
    ped.fleeFromZ = fromZ;
    ped.fleeTimer = FLEE_SECONDS;
    ped.resteeerTimer = 0;
    ped.frozen = chance(this.rng, FREEZE_CHANCE);
    if (this.screamCooldown <= 0) {
      this.screamCooldown = SCREAM_COOLDOWN_SECONDS;
      this.onScream();
    }
  }
  scareFrom(x, z, range) {
    for (const ped of this.peds) {
      if (ped.knockedTimer > 0 || ped.fleeTimer > 0) continue;
      const pos = ped.mesh.group.position;
      if (Math.hypot(pos.x - x, pos.z - z) < range) this.fleeFrom(ped, x, z);
    }
  }
  knockDown(ped, fromX, fromZ, seconds = KNOCKED_DOWN_SECONDS) {
    ped.knockedTimer = seconds;
    ped.fleeTimer = 0;
    ped.frozen = false;
    ped.lastHitX = fromX;
    ped.lastHitZ = fromZ;
    ped.mesh.group.rotation.x = Math.PI / 2;
    ped.mesh.group.position.y = 0.4;
  }
  update(dt, city, playerCar, gunshot) {
    this.screamCooldown -= dt;
    for (const ped of this.peds) {
      const pos = ped.mesh.group.position;
      if (ped.knockedTimer > 0) {
        ped.knockedTimer -= dt;
        if (ped.knockedTimer <= 0) {
          ped.mesh.group.rotation.x = 0;
          ped.mesh.group.position.y = 0;
          this.fleeFrom(ped, ped.lastHitX, ped.lastHitZ);
        }
        continue;
      }
      if (ped.fleeTimer > 0) {
        ped.fleeTimer -= dt;
        if (ped.frozen) {
          ped.mesh.armLeft.rotation.x = -2.4;
          ped.mesh.armRight.rotation.x = -2.4;
          if (ped.fleeTimer <= 1) ped.frozen = false;
          continue;
        }
        ped.resteeerTimer -= dt;
        if (ped.resteeerTimer <= 0) {
          ped.resteeerTimer = FLEE_RESTEEER_SECONDS;
          const awayX = pos.x - ped.fleeFromX;
          const awayZ = pos.z - ped.fleeFromZ;
          const awayDist = Math.hypot(awayX, awayZ) || 1;
          let dx = awayX / awayDist;
          let dz = awayZ / awayDist;
          const lateral = ped.line.axis === 'z' ? pos.x - ped.line.at : pos.z - ped.line.at;
          const sidewalkBias = lateral >= 0 ? 1 : -1;
          if (ped.line.axis === 'z') dx += sidewalkBias * 0.6;
          else dz += sidewalkBias * 0.6;
          const len = Math.hypot(dx, dz) || 1;
          ped.fleeDx = dx / len;
          ped.fleeDz = dz / len;
        }
        const beforeX = pos.x;
        const beforeZ = pos.z;
        pos.x += ped.fleeDx * FLEE_SPEED * dt;
        pos.z += ped.fleeDz * FLEE_SPEED * dt;
        city.resolveCircle(pos, 0.7);
        if (Math.hypot(pos.x - beforeX, pos.z - beforeZ) < FLEE_SPEED * dt * 0.3) {
          const oldDx = ped.fleeDx;
          ped.fleeDx = -ped.fleeDz;
          ped.fleeDz = oldDx;
        }
        ped.mesh.group.rotation.y = Math.atan2(ped.fleeDx, ped.fleeDz);
        ped.walkPhase += dt * FLEE_SPEED * 1.6;
        if (ped.fleeTimer <= 0) {
          ped.along = ped.line.axis === 'z' ? pos.z : pos.x;
          ped.along = Math.max(ped.line.from, Math.min(ped.line.to, ped.along));
        }
      } else {
        ped.along += ped.direction * ped.walkSpeed * dt;
        if (ped.along < ped.line.from || ped.along > ped.line.to) ped.direction *= -1;
        this.placeOnSidewalk(ped);
        ped.walkPhase += dt * ped.walkSpeed * 1.6;
        if (playerCar && Math.abs(playerCar.speed) > 4) {
          const carPos = playerCar.position;
          if (Math.hypot(pos.x - carPos.x, pos.z - carPos.z) < CAR_SCARE_RANGE) {
            this.fleeFrom(ped, carPos.x, carPos.z);
          }
        }
        if (gunshot && Math.hypot(pos.x - gunshot.x, pos.z - gunshot.z) < GUNSHOT_SCARE_RANGE) {
          this.fleeFrom(ped, gunshot.x, gunshot.z);
        }
      }
      const swing = Math.sin(ped.walkPhase) * LEG_SWING;
      ped.mesh.legLeft.rotation.x = swing;
      ped.mesh.legRight.rotation.x = -swing;
      if (!ped.frozen) {
        ped.mesh.armLeft.rotation.x = -swing * 0.8;
        ped.mesh.armRight.rotation.x = swing * 0.8;
      }
    }
  }
}