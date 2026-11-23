import * as THREE from 'three';
import { createCar, waterCap } from './vehicles.js';
import { buildWalkerMesh } from './pedestrians.js';
import { roadLines, headingFor } from './city.js';
import { pick, wrapAngle } from './random.js';
const CALLSIGNS = ['IBIS-43', 'GULL-1', 'TARPON-10', 'OSPREY-7', 'PELICAN-22', 'HERON-5', 'EGRET-9', 'TERN-3', 'STORK-8', 'CRANE-12', 'FALCON-6', 'OWL-4', 'RAVEN-11', 'HAWK-2', 'KESTREL-15', 'CONDOR-20'];
const HELI_CALLSIGN = 'HELI-1';
const SEE_RANGE = 45, TOP_SPEED = 50, TOP_SPEED_HOT = 51, TOP_SPEED_MAX = 52, TURN_RATE = 2.8, ACCEL = 16;
const RAM_DIST = 4.2, RAM_BACKOFF = 0.9, RAM_SLOW = 3.0, DIRECT_RANGE = 22, SNAP_RANGE = 35, OFFICER_SPEED = 5;
const RB_AHEAD = 45, RB_REPOSITION_S = 25, DESPAWN_S = 3, HELI_AHEAD = 22, HELI_SWEEP = 5;
const HELI_H = 14, HELI_SWEEP_S = 5, HELI_HP = 60, HELI_RESPAWN_S = 60;
// 5 stars must feel like a full encirclement: 10 pursuit cars close in.
function pursuitCarsForStars(stars) {
  return stars <= 0 ? 0 : stars === 1 ? 1 : stars === 2 ? 2 : stars === 3 ? 4 : stars === 4 ? 6 : 10;
}
// VRPD livery textures (shared across all units): POLICE in white with a
// navy outline reads on the white stripe, the blue body and the navy
// uniform alike; the door badge is the Vice Royale Police Department
// shield. MeshBasicMaterial so the lettering stays readable at night.
let policeTextMat = null, vrpdBadgeMat = null;
function liveryMaterials() {
  if (policeTextMat) return { policeTextMat, vrpdBadgeMat };
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
  return { policeTextMat, vrpdBadgeMat };
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
    this.patrol = [];
    this.stallTimer = 0;
    this.stallCheck = 0;
    this.lastFocusX = 0;
    this.lastFocusZ = 0;
    this.helicopter = null;
    this.heliHp = HELI_HP;
    this.heliCooldown = 0;
    // Scratch vectors for the helicopter update: allocating 3 new
    // Vector3s every frame fed the GC pauses that froze the game.
    this._heliTarget = new THREE.Vector3();
    this._heliTo = new THREE.Vector3();
    this._heliUp = new THREE.Vector3(0, 1, 0);
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
    const inUse = new Set([...this.pursuit, ...this.roadblock, ...this.patrol].map((unit) => unit.callsign));
    for (const callsign of CALLSIGNS) {
      if (!inUse.has(callsign)) return callsign;
    }
    return CALLSIGNS[this.callsignIndex++ % CALLSIGNS.length];
  }
  createPoliceCar(x, z, heading, callsign) {
    const car = createCar(this.scene, this.textures, 'POLICE', this.textures.carWhite, 0xffffff, x, z, heading);
    // NO added light bar: the police GLB already has a proper one — Em_Red
    // / Em_Blue emissive lenses under a translucent cover on a black bar.
    // The old code bolted two crude boxes on top of it. The blink now
    // drives the GLB's own materials (resolved lazily in flash(), since
    // the GLB attaches async).
    // POLICE lettering on both sides and the hood/trunk, plus the VRPD
    // door badge. No side stripe and no roof lettering: the GLB body is
    // curved, so a flat box reads as a bolted-on slab, and the roof's
    // flat section is too short for the 1.9 m plane. The car already
    // wears a black-and-white livery, so the text alone carries it.
    const { policeTextMat, vrpdBadgeMat } = liveryMaterials();
    for (const side of [-1, 1]) {
      const lettering = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.42), policeTextMat);
      lettering.position.set(side * 0.84, 0.55, 0);
      lettering.rotation.y = (side * Math.PI) / 2;
      car.group.add(lettering);
      const badge = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.45), vrpdBadgeMat);
      badge.position.set(side * 0.86, 0.62, 0.9);
      badge.rotation.y = (side * Math.PI) / 2;
      car.group.add(badge);
    }
    // Hood/trunk POLICE plates, each just above its sloped surface.
    for (const [hz, hy, depth] of [[1.9, 0.74, 0.4], [-1.95, 0.94, 0.3]]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(1.2, depth), policeTextMat);
      plate.position.set(0, hy, hz);
      plate.rotation.x = -Math.PI / 2;
      car.group.add(plate);
    }
    return { car, callsign, status: 'PURSUIT', ramCooldown: 0, shootCooldown: 1 + Math.random() * 2, redMaterial: null, blueMaterial: null, escortSide: 0, officer: null, stillTimer: 0 };
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
  // A point on a road near the player: a line close by laterally, ~80m
  // along it — the fallback when random picks miss the spawn band, so a
  // unit never spawns on the far side of the map by bad luck.
  nearPoint(playerPos, distance) {
    const lateral = (line) => (line.axis === 'z' ? playerPos.x : playerPos.z);
    const near = this.lines.filter((line) => Math.abs(lateral(line) - line.at) <= 40);
    const line = pick(this.rng, near.length ? near : this.lines);
    const playerAlong = line.axis === 'z' ? playerPos.z : playerPos.x;
    const along = Math.max(line.from, Math.min(line.to, playerAlong + (this.rng() < 0.5 ? -distance : distance)));
    return { line, along };
  }
  spawnPursuitCar(playerPos, spawnDistance) {
    let line = pick(this.rng, this.lines);
    let along = line.from + this.rng() * (line.to - line.from);
    let found = false;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const c = pick(this.rng, this.lines);
      const a = c.from + this.rng() * (c.to - c.from);
      const dist = Math.hypot((c.axis === 'z' ? c.at : a) - playerPos.x, (c.axis === 'z' ? a : c.at) - playerPos.z);
      if (dist > spawnDistance - 15 && dist < spawnDistance + 20) { line = c; along = a; found = true; break; }
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
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const c = pick(this.rng, this.lines);
      const a = c.from + this.rng() * (c.to - c.from);
      const dist = Math.hypot((c.axis === 'z' ? c.at : a) - playerPos.x, (c.axis === 'z' ? a : c.at) - playerPos.z);
      if (dist > 50 && dist < 110) { line = c; along = a; found = true; break; }
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
    for (const unit of this.patrol) {
      const d = Math.hypot(unit.car.position.x - playerPos.x, unit.car.position.z - playerPos.z);
      if (d < bestD) {
        bestD = d;
        best = unit;
      }
    }
    return best ? { unit: best, dist: bestD } : null;
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
    // Right-hand lane, same rule as traffic.js laneOffsetFor (2.5m):
    // a car on the centreline straddles both lanes. The knock offset
    // (crash slide, see applyKnock) rides on top and eases back to 0.
    const off = unit.line.axis === 'z'
      ? (unit.direction > 0 ? -2.5 : 2.5)
      : (unit.direction > 0 ? 2.5 : -2.5);
    const kx = unit.knockX || 0, kz = unit.knockZ || 0;
    if (unit.line.axis === 'z') unit.car.group.position.set(unit.line.at + off + kx, 0, unit.along + kz);
    else unit.car.group.position.set(unit.along + kx, 0, unit.line.at + off + kz);
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
    if (!car.knockVX && !car.knockVZ && !unit.knockX && !unit.knockZ) return;
    const decay = Math.max(0, 1 - 2.5 * dt);
    if (unit.mode === 'road') {
      unit.knockX = (unit.knockX || 0) + (car.knockVX || 0) * dt;
      unit.knockZ = (unit.knockZ || 0) + (car.knockVZ || 0) * dt;
    } else {
      car.group.position.x += (car.knockVX || 0) * dt;
      car.group.position.z += (car.knockVZ || 0) * dt;
    }
    car.knockVX = (car.knockVX || 0) * decay;
    car.knockVZ = (car.knockVZ || 0) * decay;
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
  // Patrol turns: RANDOM, never toward the player. maybeTurnAtIntersection
  // steers toward the player — right for pursuit, wrong for patrol: with
  // it, all 3 patrol cars converged on the player's road and stopped
  // around them at 0 stars, looking like a pursuit that never ends.
  maybeTurnRandom(unit, dt) {
    if (unit.turnCooldown > 0) return;
    const crosses = unit.line.axis === 'z' ? this.crossZ : this.crossX;
    const window = Math.max(2.5, unit.car.speed * dt * 1.5);
    for (const cross of crosses) {
      if (Math.abs(unit.along - cross) > window) continue;
      if (this.rng() > 0.3) return;
      const crossLine = this.lines.find((line) => line.axis !== unit.line.axis && line.at === cross);
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
    // Self-lit materials so the heli reads at night: the body keeps its
    // Lambert shading but with emissive lift, the glass and lights are
    // Basic (always full bright).
    const white = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x3a3a3a });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
    const glass = new THREE.MeshBasicMaterial({ color: 0x9fd4e8 });
    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    // Rounded cabin pod + glass cockpit bubble (no box core: the pod
    // is the body).
    const cabin = new THREE.Mesh(new THREE.SphereGeometry(1.2, 16, 12), white);
    cabin.scale.set(1, 0.75, 1.6);
    cabin.position.set(0, 0.8, 0);
    group.add(cabin);
    const bubble = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 12), glass);
    bubble.scale.set(0.9, 0.65, 0.9);
    bubble.position.set(0, 0.85, 1.5);
    group.add(bubble);
    // Tapered tail boom (thick at the cabin, thin at the tail).
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.14, 3.8, 10), white);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 1.0, -3.0);
    group.add(boom);
    // Tail fin + tail rotor: the silhouette features that read "helicopter".
    box(0.12, 1.1, 0.7, white, 0, 1.5, -4.7);
    const tailRotor = new THREE.Group();
    const tailBladeGeo = new THREE.BoxGeometry(0.08, 1.6, 0.12);
    const tailBladeB = new THREE.Mesh(tailBladeGeo, dark);
    tailBladeB.rotation.x = Math.PI / 2;
    tailRotor.add(new THREE.Mesh(tailBladeGeo, dark), tailBladeB);
    tailRotor.position.set(0.3, 1.5, -4.7);
    group.add(tailRotor);
    // Landing skids: two tubes with struts to the cabin.
    const skidGeo = new THREE.CylinderGeometry(0.07, 0.07, 3.2, 8);
    for (const sx of [-0.9, 0.9]) {
      const skid = new THREE.Mesh(skidGeo, dark);
      skid.rotation.x = Math.PI / 2;
      skid.position.set(sx, -0.15, 0);
      group.add(skid);
      for (const sz of [-1.0, 1.0]) {
        const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.08), dark);
        strut.position.set(sx, 0.1, sz);
        group.add(strut);
      }
    }
    // Rotor mast + blades + translucent disc (the disc is what the eye
    // sees of a spinning rotor at distance).
    box(0.25, 0.5, 0.25, dark, 0, 1.55, 0);
    const rotor = new THREE.Group();
    const bladeGeometry = new THREE.BoxGeometry(7.5, 0.06, 0.3);
    const bladeB = new THREE.Mesh(bladeGeometry, dark);
    bladeB.rotation.y = Math.PI / 2;
    rotor.add(new THREE.Mesh(bladeGeometry, dark), bladeB);
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(3.8, 32),
      new THREE.MeshBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    rotor.add(disc);
    rotor.position.y = 1.7;
    group.add(rotor);
    // Navigation lights: red left, green right, white strobe on the tail.
    const navLight = (color, x, y, z) => {
      const light = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 8), new THREE.MeshBasicMaterial({ color }));
      light.position.set(x, y, z);
      group.add(light);
      return light;
    };
    navLight(0xff2222, -1.15, 0.8, 0);
    navLight(0x22ff44, 1.15, 0.8, 0);
    navLight(0xffffff, 0, 1.0, -4.9);
    // Searchlight lamp under the nose (the beam's visible source).
    navLight(0xfff6cc, 0, 0.2, 1.9);
    this.scene.add(group);
    const glow = (o, side) => new THREE.MeshBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: o, blending: THREE.AdditiveBlending, side, depthWrite: false });
    // Narrower, fainter beam: the old wide cone read as fog.
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.5, 30, 16, 1, true), glow(0.07, THREE.DoubleSide));
    this.scene.add(cone);
    const spotlight = new THREE.Mesh(new THREE.CircleGeometry(6, 24), glow(0.22, THREE.FrontSide));
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
    // Warm the soldier GLB cache at the first star so officers upgrade
    // from the cache instead of a cold load (retried every 5s on failure).
    if (wantedStars >= 1 && !this.soldierPreloaded && this.clock >= (this.soldierPreloadNext || 0)) {
      this.soldierPreloadNext = this.clock + 5;
      import('./models_loader.js').then((loader) => loader.loadPerson('soldier')).then(() => { this.soldierPreloaded = true; }).catch(() => {});
    }
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
    // Patrols cruise at 0 stars; when heat comes on, the nearest patrol
    // joins the pursuit before fresh units spawn in.
    if (wantedStars === 0) {
      while (this.patrol.length < 3) this.spawnPatrolCar(playerPos);
    }
    // One pursuit car per 0.4s, not all at once: spawning 10 cars in a
    // single frame (clone ~60 materials each + scene setup + first-frame
    // shader compile) froze the game the moment VRPD appeared.
    this.spawnTimer = Math.max(0, (this.spawnTimer || 0) - dt);
    if (this.pursuit.length < wantedPursuit && this.spawnTimer <= 0) {
      const near = this.nearestPatrol(playerPos);
      if (near && near.dist < 90) this.convertPatrol(near.unit);
      else this.spawnPursuitCar(playerPos, 65);
      this.spawnTimer = 0.4;
    }
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
    // Stalled pursuit: if the player has not moved for 20s while wanted,
    // call in backup (one extra unit, then again every 10s, up to 6).
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
    const blinkOn = Math.floor(this.clock * 2.8) % 2 === 0;
    // Blink the GLB light bar's own emissive lenses (alternating red/blue).
    // Materials resolve lazily: the GLB attaches async, so Em_Red/Em_Blue
    // only exist after load; the traverse runs until found, then caches.
    // A box-fallback car has no Em materials — flash() is a no-op for it.
    // The GLB's own emissive colours are dark (red 0.19, blue 0.32), so
    // at intensity 3 the bar barely glows — override them to full-bright
    // colours and drive the intensity hard (8 on / 0.1 off) so the bar
    // reads as a flashing light even in daylight.
    const flash = (unit) => {
      if (!unit.redMaterial || !unit.blueMaterial) {
        unit.car.group.traverse((o) => {
          if (!o.isMesh) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            if (m.name === 'Em_Red') { unit.redMaterial = m; m.emissive.setRGB(1, 0.02, 0.05); }
            else if (m.name === 'Em_Blue') { unit.blueMaterial = m; m.emissive.setRGB(0.05, 0.25, 1); }
          }
        });
      }
      if (unit.redMaterial) unit.redMaterial.emissiveIntensity = blinkOn ? 8 : 0.1;
      if (unit.blueMaterial) unit.blueMaterial.emissiveIntensity = blinkOn ? 0.1 : 8;
    };
    const topSpeed = wantedStars >= 5 ? TOP_SPEED_MAX : wantedStars >= 4 ? TOP_SPEED_HOT : TOP_SPEED;
    const steerTo = (car, desired) => {
      car.heading += Math.max(-TURN_RATE * dt, Math.min(TURN_RATE * dt, wrapAngle(desired - car.heading)));
    };
    // Patrol cars cruise the roads like traffic until they are needed.
    // Like traffic, they stop for someone in their path instead of
    // running them over — a player standing in the road is an obstacle,
    // not a target. (Without this, a patrol car would hit a stationary
    // player the same way a traffic car used to.)
    for (const unit of this.patrol) {
      flash(unit);
      this.applyKnock(unit, dt);
      const car = unit.car;
      unit.turnCooldown = Math.max(0, unit.turnCooldown - dt);
      const pdx = playerPos.x - car.position.x;
      const pdz = playerPos.z - car.position.z;
      const pfx = Math.sin(car.heading);
      const pfz = Math.cos(car.heading);
      const pAhead = pdx * pfx + pdz * pfz;
      const pLat = Math.abs(pdx * pfz - pdz * pfx);
      if (pAhead > -2 && pAhead < 9 && pLat < 2.6) car.speed = Math.max(0, car.speed - 30 * dt);
      else car.speed = Math.min(12, car.speed + ACCEL * dt);
      this.maybeTurnRandom(unit, dt);
      unit.along += unit.direction * car.speed * dt;
      if (unit.along < unit.line.from || unit.along > unit.line.to) unit.direction *= -1;
      this.placeOnRoad(unit);
      for (const wheel of car.wheels) {
        wheel.wheel.rotation.x += (car.speed / 0.36) * dt;
      }
    }
    for (const unit of this.pursuit) {
      flash(unit);
      this.applyKnock(unit, dt);
      const car = unit.car;
      const dx = playerPos.x - car.position.x;
      const dz = playerPos.z - car.position.z;
      const dist = Math.hypot(dx, dz);
      if (unit.mode === 'road' && dist < DIRECT_RANGE) unit.mode = 'direct';
      if (unit.mode === 'direct' && dist > SNAP_RANGE) this.snapToRoad(unit, playerPos);
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
          } else if (driving && dist < RAM_DIST && unit.stillTimer <= 3) {
            unit.status = 'RAMMING';
            drivenCar.speed *= Math.max(0, 1 - RAM_SLOW * dt);
            // Every ram dents the player's car: ram a wedged car long
            // enough and it stalls out, forcing the player on foot.
            context.onRam?.(drivenCar);
            car.speed = 4;
            unit.ramCooldown = RAM_BACKOFF;
          } else {
            unit.status = 'PURSUIT';
            // Stop bumper-to-bumper when the player is on foot, or their
            // car has sat still — close enough for the officer to get out.
            if (dist < 3.5 && (!driving || (drivenCar && Math.abs(drivenCar.speed) < 0.5))) car.speed = 0;
            else car.speed = Math.min(topSpeed, car.speed + ACCEL * dt);
          }
        }
        // The sea stops a pursuit car like any other: it stalls in deep
        // water and can only drive back out toward shore.
        const water = waterCap(this.city, car.position.x, car.position.z, car.heading, car.speed, topSpeed, 6);
        car.speed = water.speed;
        car.group.position.y = -Math.min(water.depth * 0.95, 1.3);
        car.group.position.x += Math.sin(car.heading) * car.speed * dt;
        car.group.position.z += Math.cos(car.heading) * car.speed * dt;
        // Stay in the city: a direct-mode pursuit drives straight at the
        // player and would otherwise chase them out onto the sand (and
        // vanish when the pursuit ends). Same ±265 edge as traffic.
        car.group.position.x = Math.max(-265, Math.min(265, car.group.position.x));
        car.group.position.z = Math.max(-265, Math.min(265, car.group.position.z));
        const beforeX = car.group.position.x;
        const beforeZ = car.group.position.z;
        this.city.resolveCircle(car.group.position, 1.6);
        if (car.group.position.x !== beforeX || car.group.position.z !== beforeZ) car.speed *= 0.4;
        car.group.rotation.y = car.heading;
      }
      // An officer gets out once the pursuit car has stopped next to the
      // player — on foot as before, or after the player's car has sat
      // still in range for 3s (a wedged car is no shelter from arrest).
      if (wantedStars >= 1 && !unit.officer && car.speed === 0 && dist < 3.5 && (!driving || unit.stillTimer > 3)) {
        const mesh = buildWalkerMesh(0x24457e, 0x14141c, 0xd9a077, 0x201510, 'police', 1);
        mesh.group.position.set(car.position.x + Math.cos(car.heading) * 1.8, 0, car.position.z - Math.sin(car.heading) * 1.8);
        this.city.resolveCircle(mesh.group.position, 0.5);
        const backText = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.18), liveryMaterials().policeTextMat);
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
      const officer = unit.officer;
      if (officer) {
        // A failed GLB upgrade retries from the update loop: an officer
        // older than 3s still in its box body gets another attempt, at
        // most one per 2s (a transient load failure must not leave a box
        // figure standing for the whole chase).
        if (!officer.isGLB && !officer.upgradePending && this.clock - (officer.spawnedAt || 0) > 3 && this.clock >= (officer.nextRetryAt || 0)) {
          this.upgradeOfficerToGLB(unit, officer);
        }
        const op = officer.group.position;
        const odist = Math.hypot(playerPos.x - op.x, playerPos.z - op.z);
        if ((driving && (!drivenCar || Math.abs(drivenCar.speed) > 1)) || wantedStars === 0 || odist > 18) officer.returning = true;
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
          // A GLB officer walks on its mixer clip instead of the limb
          // swing (its limb refs are inert stubs after the swap).
          if (officer.setOfficerClip && officer.moveClip) officer.setOfficerClip(officer.moveClip);
          if (officer.mixer) officer.mixer.update(dt);
        } else if (officer.mixer) {
          // Standing still: idle pose instead of a frozen mid-stride.
          if (officer.setOfficerClip) officer.setOfficerClip('idle');
          officer.mixer.update(dt);
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
    for (const unit of this.roadblock) { flash(unit); this.applyKnock(unit, dt); }
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
  }
  units(playerPos) {
    const distanceTo = (unit) =>
      Math.round(Math.hypot(unit.car.position.x - playerPos.x, unit.car.position.z - playerPos.z));
    const rows = [...this.patrol, ...this.pursuit, ...this.roadblock].map((unit) => ({
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
  // Swap a box-figure officer for the soldier GLB (navy recolour) once
  // it loads. The box figure stays as the placeholder until the GLB is
  // ready. A failed load schedules a retry (nextRetryAt, picked up by the
  // update loop) instead of leaving the box figure for good; the abort
  // guard still skips an officer that is gone by then (removed, or handed
  // to main.js as a walker after a steal). The loader is imported
  // dynamically so a missing models_loader.js degrades to the placeholder
  // instead of breaking the whole game.
  upgradeOfficerToGLB(unit, mesh) {
    mesh.upgradePending = true;
    import('./models_loader.js').then(async (loader) => {
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
      mesh.moveClip = person.clips && person.clips.walk ? 'walk' : person.clips && person.clips.run ? 'run' : null;
      mesh.setOfficerClip = (name) => loader.playClip(mesh.mixer, person.clips, name);
      mesh.isGLB = true;
      mesh.legLeft = stub();
      mesh.legRight = stub();
      mesh.armLeft = stub();
      mesh.armRight = stub();
      if (mesh.moveClip) mesh.setOfficerClip(mesh.moveClip);
    }).catch(() => {
      mesh.nextRetryAt = this.clock + 2;
    }).finally(() => {
      mesh.upgradePending = false;
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
    return [...this.patrol, ...this.pursuit, ...this.roadblock].map((unit) => ({ x: unit.car.position.x, z: unit.car.position.z }));
  }
}