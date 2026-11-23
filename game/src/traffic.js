import { createCar, createBike } from './vehicles.js';
import { buildWalkerMesh, SHIRT_COLOURS, SKIN_COLOURS, HAIR_COLOURS } from './pedestrians.js';
import { roadLines, averageDensity, densityForMinute, districtNameAt, NIGHTLIFE_DISTRICTS, headingFor } from './city.js';
import { intBetween, pick, weightedPick } from './random.js';
import * as THREE from 'three';
const TRAFFIC_CAR_COUNT = 14;
const SPAWN_CLUSTER_COUNT = 7;
const TITLE_CLUSTER_COUNT = 7;
// Spawn bubble: a car beyond RECYCLE_RADIUS of the focus (player or
// title camera) is teleported back to a road RECYCLE_MIN-MAX_DIST
// from the focus, preferring spots out of view.
const RECYCLE_RADIUS = 250;
const RECYCLE_MIN_DIST = 120;
const RECYCLE_MAX_DIST = 180;
const SPAWN_CLUSTER_RADIUS = 80;
const CENTRAL_LINE_BIAS = 0.5;
const DORMANT_X = 10000;
const DORMANT_Z = 10000;
const RESPAWN_RETRY_SECONDS = 5;
const NIGHTLIFE_LINE_BIAS = 0.6;
const LANE_OFFSET = 2.5;
const LOOK_AHEAD_METRES = 9;
const BLOCKED_LATERAL_METRES = 2.6;
// Overtake safety: never swing into the opposite lane blind — two cars
// overtaking head-on deadlock forever. Check the oncoming lane is clear
// before starting, abort if one appears mid-manoeuvre, and reverse out
// if a head-on still happens. The clear window is 20m, not 30m: on the
// busy central roads there is almost always an oncoming car within 30m,
// so blocked cars waited up to 8s instead of passing (1200s diag: the
// 14 longest stops never tried to overtake). 20m still leaves an
// oncoming car 1.3s+ away at top traffic speed, and the abort below
// covers anything that appears mid-manoeuvre.
const OVERTAKE_CLEAR_METRES = 20;
const OVERTAKE_CANCEL_METRES = 18;
const DEADLOCK_BLOCKED_SECONDS = 5;
const BACKUP_SECONDS = 1.5;
const BACKUP_SPEED = 3;
// Traffic-light cycle (seconds): green 8, yellow 2, red 8. The two axes
// at an intersection run opposite phases, and neighbouring intersections
// are offset by half a cycle so a green wave never lines up everywhere.
const LIGHT_CYCLE = 18, LIGHT_GREEN = 8, LIGHT_YELLOW = 10;
const LIGHT_ON = { red: 0xff2a3a, yellow: 0xffc828, green: 0x2aff5a };
const LIGHT_OFF = { red: 0x3a0d12, yellow: 0x3a2f0d, green: 0x0d3a1a };
// One shared lamp material per (phase, axis, colour): every light with
// the same phase shows the same state, so 12 materials cover all heads.
const lampMats = {};
function lampMat(phase, axis, colour) {
  const key = `${phase}|${axis}|${colour}`;
  if (!lampMats[key]) lampMats[key] = new THREE.MeshBasicMaterial({ color: LIGHT_OFF[colour] });
  return lampMats[key];
}
function lightState(clock, phase) {
  const t = (clock + phase) % LIGHT_CYCLE;
  return t < LIGHT_GREEN ? 'green' : t < LIGHT_YELLOW ? 'yellow' : 'red';
}
// A visible driver, seated in the car: legs forward to the pedals, arms
// forward to the wheel, scaled to fit under the roof. Per-style seat so
// the driver reads through the glass on a bus/truck as well as a sedan.
// The seat Y puts the pelvis at seat height: rotating the thigh bones
// does not lower the pelvis, so the group origin (feet) sits below the
// car floor on low-roof cars and the head clears the roof and windshield.
// The GLB steering wheels sit on the +x side (scaled x: sedan/taxi 0.31,
// SUV 0.37, off-roader 0.38), so GLB drivers sit at +x; bus/truck keep
// the box-era seat. Colours come from the car index, never the shared
// rng: drawing from it here would shift every spawn after traffic
// (seed-1 layouts must stay).
function seatDriver(scene, idx, car) {
  const mesh = buildWalkerMesh(SHIRT_COLOURS[idx % SHIRT_COLOURS.length], 0x2a4a8a, SKIN_COLOURS[(idx * 3 + 1) % SKIN_COLOURS.length], HAIR_COLOURS[(idx * 5 + 2) % HAIR_COLOURS.length], 'none', 1);
  const seat = car.style === 'bus' ? [-0.5, 0.35, 2.6] : car.style === 'truck' ? [-0.45, 0.2, 1.5] : car.style === 'van' ? [0.37, 0.0, 0.3] : car.style === 'pickup' ? [0.38, 0.0, 0.3] : [0.31, -0.37, 0.3];
  mesh.group.position.set(seat[0], seat[1], seat[2]);
  mesh.group.scale.setScalar(0.7);
  mesh.group.rotation.x = 0.15;
  mesh.legLeft.rotation.x = -1.0;
  mesh.legRight.rotation.x = -1.0;
  mesh.armLeft.rotation.x = -1.1;
  mesh.armRight.rotation.x = -1.1;
  car.group.add(mesh.group);
  return mesh;
}
const TRAFFIC_PAINTS = [0xff6b35, 0x007aff, 0xffd60a, 0x2fd35e, 0xff2d78, 0xe8e8e8, 0xff6b9d, 0x2ad0c4, 0xe63946];
const TRAFFIC_BODY_STYLES = [
  ['sedan', 6],
  ['pickup', 2],
  ['van', 2],
  ['bike', 2],
];
const STYLE_SPEED_BAND = {
  sedan: [9, 15],
  pickup: [8, 13],
  van: [7, 11],
  taxi: [11, 16],
  bus: [6, 10],
  truck: [7, 11],
  bike: [12, 18],
};
function laneOffsetFor(axis, direction) {
  if (axis === 'z') return direction > 0 ? -LANE_OFFSET : LANE_OFFSET;
  return direction > 0 ? LANE_OFFSET : -LANE_OFFSET;
}
export class Traffic {
  constructor(scene, textures, rng) {
    this.scene = scene;
    this.lines = roadLines();
    this.crossX = this.lines.filter((line) => line.axis === 'z').map((line) => line.at);
    this.crossZ = this.lines.filter((line) => line.axis === 'x').map((line) => line.at);
    this.nightlifeLine = this.lines.find((line) => line.axis === 'x' && line.at === 0);
    // Roads near the spawn (0,0): the cluster and the respawn bias keep
    // the streets around the player visibly busy instead of spreading
    // 48 cars thinly over the whole 12x12 island.
    this.spawnLines = this.lines.filter((line) => Math.abs(line.at) <= 52);
    this.spawnAvenues = this.lines.filter((line) => line.at === 0);
    // Title-view cluster: roads the title camera sees (orbit centre
    // (0,200), looking north). Cars here make the title screen busy.
    this.titleLines = this.lines.filter((line) =>
      (line.axis === 'z' && Math.abs(line.at) <= 104) ||
      (line.axis === 'x' && line.at >= 104 && line.at <= 260));
    this.centralLines = this.lines.filter((line) => Math.abs(line.at) <= 104);
    this.rng = rng;
    this.textures = textures;
    this.cars = [];
    this.target = TRAFFIC_CAR_COUNT;
    this.night = false;
    this.nextDriver = 0;
    this.lightClock = 0;
    this.lights = this.buildLights(scene);
    this.lightByKey = new Map(this.lights.map((light) => [`${light.x},${light.z}`, light]));
    for (let i = 0; i < TRAFFIC_CAR_COUNT; i += 1) {
      const nearTitle = i >= SPAWN_CLUSTER_COUNT && i < SPAWN_CLUSTER_COUNT + TITLE_CLUSTER_COUNT;
      this.cars.push(this.buildNpc(scene, rng, i < SPAWN_CLUSTER_COUNT, i, nearTitle));
    }
  }
  // Real traffic lights at the 9 central intersections: a pole with a
  // head per axis, three lamps each, double-faced so both approaches see
  // them. Heads share 12 lamp materials (phase x axis x colour).
  buildLights(scene) {
    const lights = [];
    const ats = [-52, 0, 52];
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x70707c });
    const headMat = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
    const poleGeo = new THREE.BoxGeometry(0.25, 5, 0.25);
    // One head geometry for both orientations (the narrow head is the
    // wide head turned 90 degrees); lamps share 12 materials.
    const headGeo = new THREE.BoxGeometry(0.9, 1.4, 0.25);
    const lampGeo = new THREE.SphereGeometry(0.16, 8, 8);
    // Instanced: 18 poles + 18 heads + 108 lamps in 14 draw calls
    // instead of 144. Lamp materials stay shared, so updateLights
    // still drives every head by recolouring 12 materials.
    const poleMats = [];
    const headMats = [];
    const lampByKey = new Map();
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), t = new THREE.Vector3();
    const put = (arr, x, y, z, rotY = 0) => {
      q.setFromAxisAngle(up, rotY);
      t.set(x, y, z);
      arr.push(new THREE.Matrix4().compose(t, q, one));
    };
    for (const x of ats) {
      for (const z of ats) {
        const phase = ((x + z) / 52) % 2 === 0 ? 0 : LIGHT_CYCLE / 2;
        const light = { x, z, phase, stateZ: 'green', stateX: 'red' };
        // Both poles stand on WEST sidewalk corners, 6.5m off BOTH road
        // centrelines: the z-road head (lamps face +/-z) on the SW
        // corner, the x-road head (lamps face +/-x) on the NW corner.
        // The SE corner is taken by a streetlight pole at (+6.8, +6.8).
        for (const [axis, px, pz, wide] of [['z', x - 6.5, z + 6.5, true], ['x', x - 6.5, z - 6.5, false]]) {
          put(poleMats, px, 2.5, pz);
          put(headMats, px, 4.6, pz, wide ? 0 : Math.PI / 2);
          for (const [colour, dy] of [['red', 0.45], ['yellow', 0], ['green', -0.45]]) {
            for (const side of [-1, 1]) {
              const key = `${phase}|${axis}|${colour}`;
              if (!lampByKey.has(key)) lampByKey.set(key, []);
              put(lampByKey.get(key), px + (wide ? 0 : side * 0.16), 4.6 + dy, pz + (wide ? side * 0.16 : 0));
            }
          }
        }
        lights.push(light);
      }
    }
    const mkInst = (geo, mat, mats) => {
      const inst = new THREE.InstancedMesh(geo, mat, mats.length);
      mats.forEach((mm, i) => inst.setMatrixAt(i, mm));
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      scene.add(inst);
    };
    mkInst(poleGeo, poleMat, poleMats);
    mkInst(headGeo, headMat, headMats);
    for (const [key, mats] of lampByKey) {
      const [phase, axis, colour] = key.split('|');
      mkInst(lampGeo, lampMat(Number(phase), axis, colour), mats);
    }
    return lights;
  }
  updateLights() {
    for (const light of this.lights) {
      light.stateZ = lightState(this.lightClock, light.phase);
      light.stateX = lightState(this.lightClock, light.phase + LIGHT_CYCLE / 2);
    }
    for (const phase of [0, LIGHT_CYCLE / 2]) {
      for (const axis of ['z', 'x']) {
        const state = lightState(this.lightClock, phase + (axis === 'x' ? LIGHT_CYCLE / 2 : 0));
        for (const colour of ['red', 'yellow', 'green']) {
          lampMat(phase, axis, colour).color.setHex(state === colour ? LIGHT_ON[colour] : LIGHT_OFF[colour]);
        }
      }
    }
  }
  // A red light ahead on this car's road: stop before the intersection
  // (a car already inside the 1m stop line carries on through).
  redLightAhead(npc) {
    const crosses = npc.line.axis === 'z' ? this.crossZ : this.crossX;
    for (const cross of crosses) {
      const ahead = (cross - npc.along) * npc.direction;
      if (ahead < 1 || ahead > 9) continue;
      const light = npc.line.axis === 'z' ? this.lightByKey.get(`${npc.line.at},${cross}`) : this.lightByKey.get(`${cross},${npc.line.at}`);
      if (!light) continue;
      return (npc.line.axis === 'z' ? light.stateZ : light.stateX) === 'red';
    }
    return false;
  }
  get activeCount() {
    return this.cars.filter((npc) => !npc.dormant).length;
  }
  // Time-of-day density: traffic thins out at night (see city.js). A car
  // only leaves when it reaches the end of its road, and dormant cars
  // respawn from the map edge, so nothing ever pops in or out in view.
  setDensity(minutes) {
    this.target = Math.max(1, Math.round(TRAFFIC_CAR_COUNT * averageDensity(minutes)));
    this.night = densityForMinute(minutes) < 0.7;
  }
  pickLine() {
    if (this.night && this.nightlifeLine && this.rng() < NIGHTLIFE_LINE_BIAS) return this.nightlifeLine;
    // Half of all respawns stay on the central roads, so the busy
    // streets around the spawn refill instead of thinning out.
    if (this.rng() < CENTRAL_LINE_BIAS) return pick(this.rng, this.centralLines);
    return pick(this.rng, this.lines);
  }
  goDormant(npc) {
    npc.dormant = true;
    npc.retryTimer = RESPAWN_RETRY_SECONDS;
    npc.speed = 0;
    npc.car.group.visible = false;
    npc.car.group.position.set(DORMANT_X, 0, DORMANT_Z);
  }
  buildNpc(scene, rng, nearSpawn = false, idx = -1, nearTitle = false) {
    let line = this.pickLine();
    let along = line.from + rng() * (line.to - line.from);
    if (nearSpawn) {
      // Spawn cluster: on a road hugging the spawn, within 80m of it,
      // so the player sees moving traffic the moment the game starts.
      // Half the cluster rides the two avenues through the spawn itself
      // (the roads in the opening view), the rest the neighbouring roads.
      line = rng() < 0.5 ? pick(rng, this.spawnAvenues) : pick(rng, this.spawnLines);
      along = (rng() * 2 - 1) * SPAWN_CLUSTER_RADIUS;
    } else if (nearTitle) {
      // Title cluster: on a road the title camera sees, within the
      // title-view box (z 100-300 on north-south roads, x -150..150
      // on east-west roads), so the title screen looks busy.
      line = pick(rng, this.titleLines);
      along = line.axis === 'z' ? 100 + rng() * 200 : -150 + rng() * 300;
    }
    const direction = rng() < 0.5 ? -1 : 1;
    const isTaxi = rng() < 0.15;
    const style = isTaxi ? 'taxi' : weightedPick(rng, TRAFFIC_BODY_STYLES);
    const paint = isTaxi ? 0xffc828 : pick(rng, TRAFFIC_PAINTS);
    // Body texture matches the paint family: yellow body for yellow
    // paint, orange-red body for warm paints, blue body for the rest.
    const texture = isTaxi || paint === 0xffd60a ? this.textures.carTaxi
      : paint === 0xff6b35 || paint === 0xe63946 || paint === 0xff2d78 || paint === 0xff6b9d ? this.textures.carRed
      : this.textures.carBlue;
    const [minSpeed, maxSpeed] = STYLE_SPEED_BAND[style];
    const car =
      style === 'bike'
        ? createBike(scene, 'TRAFFIC', paint, 0, 0, 0, true)
        : createCar(scene, this.textures, isTaxi ? 'KEYS TAXI' : 'TRAFFIC', texture, paint, 0, 0, 0, style);
    const npc = {
      car,
      driver: style === 'bike' ? null : seatDriver(scene, idx < 0 ? (this.nextDriver = (this.nextDriver + 1) % 64) : idx, car),
      line,
      direction,
      along,
      speedBand: [minSpeed, maxSpeed],
      cruiseSpeed: intBetween(rng, minSpeed, maxSpeed),
      speed: 0,
      stoppedTimer: 0,
      blockedTimer: 0,
      overtakeTimer: 0,
      overtake: 0,
      backupTimer: 0,
      dormant: false,
      retryTimer: 0,
      offX: 0,
      offZ: 0,
      offVx: 0,
      offVz: 0,
      spin: 0,
      spinV: 0,
    };
    this.placeOnRoad(npc);
    if (this.activeCount >= this.target) this.goDormant(npc);
    return npc;
  }
  placeOnRoad(npc) {
    const offset = laneOffsetFor(npc.line.axis, npc.direction) * (1 - 2 * npc.overtake);
    if (npc.line.axis === 'z') {
      npc.car.group.position.set(npc.line.at + offset + npc.offX, 0, npc.along + npc.offZ);
    } else {
      npc.car.group.position.set(npc.along + npc.offX, 0, npc.line.at + offset + npc.offZ);
    }
    npc.car.heading = headingFor(npc.line.axis, npc.direction);
    npc.car.group.rotation.y = npc.car.heading + npc.spin;
  }
  // A respawn point in the player's view would pop a car in right in
  // front of them: try a few lines and take the first out of view
  // (>80m away or behind the camera); if none qualifies, take the
  // farthest candidate so the pop-in is as distant as possible.
  inView(x, z, view) {
    if (!view) return false;
    const dx = x - view.x;
    const dz = z - view.z;
    if (Math.hypot(dx, dz) > 80) return false;
    return dx * view.fx + dz * view.fz >= 0;
  }
  respawnAtEdge(npc) {
    const view = this.view;
    let best = null;
    let bestD = -1;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const line = this.pickLine();
      const direction = this.rng() < 0.5 ? -1 : 1;
      const along = direction > 0 ? line.from : line.to;
      const off = laneOffsetFor(line.axis, direction);
      const x = line.axis === 'z' ? line.at + off : along;
      const z = line.axis === 'z' ? along : line.at + off;
      const d = view ? Math.hypot(x - view.x, z - view.z) : 999;
      if (!this.inView(x, z, view)) {
        npc.line = line;
        npc.direction = direction;
        npc.along = along;
        best = null;
        break;
      }
      if (d > bestD) {
        bestD = d;
        best = { line, direction, along };
      }
      if (attempt === 7 && best) {
        npc.line = best.line;
        npc.direction = best.direction;
        npc.along = best.along;
      }
    }
    npc.cruiseSpeed = intBetween(this.rng, npc.speedBand[0], npc.speedBand[1]);
    npc.blockedTimer = 0;
    npc.overtakeTimer = 0;
    npc.overtake = 0;
    npc.backupTimer = 0;
    npc.offX = 0;
    npc.offZ = 0;
    npc.offVx = 0;
    npc.offVz = 0;
    npc.spin = 0;
    npc.spinV = 0;
    npc.speed = 0;
    this.placeOnRoad(npc);
    // End of the road: when traffic is over its density target the car
    // heads home — except on the nightlife strip, which stays busy.
    const pos = npc.car.position;
    const nightlife = NIGHTLIFE_DISTRICTS.includes(districtNameAt(pos.x, pos.z));
    if (this.activeCount > this.target && !nightlife) {
      this.goDormant(npc);
      return;
    }
    npc.dormant = false;
    npc.car.group.visible = true;
  }
  // Spawn bubble: teleport a far-away car to a road near the focus
  // instead of letting it drive the empty outskirts. Prefers spots
  // out of view (same inView check as respawnAtEdge); falls back to
  // the first candidate if all 8 are in view.
  recycleNearFocus(npc) {
    const view = this.view;
    const fx = view ? view.x : 0, fz = view ? view.z : 0;
    let best = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const near = this.lines.filter((line) =>
        line.axis === 'z' ? Math.abs(line.at - fx) <= 150 : Math.abs(line.at - fz) <= 150);
      const line = pick(this.rng, near.length ? near : this.lines);
      const direction = this.rng() < 0.5 ? -1 : 1;
      const target = line.axis === 'z' ? fz : fx;
      const dist = RECYCLE_MIN_DIST + this.rng() * (RECYCLE_MAX_DIST - RECYCLE_MIN_DIST);
      const sign = this.rng() < 0.5 ? -1 : 1;
      const along = Math.max(line.from, Math.min(line.to, target + sign * dist));
      const off = laneOffsetFor(line.axis, direction);
      const x = line.axis === 'z' ? line.at + off : along;
      const z = line.axis === 'z' ? along : line.at + off;
      if (!this.inView(x, z, view)) {
        npc.line = line;
        npc.direction = direction;
        npc.along = along;
        npc.offX = 0;
        npc.offZ = 0;
        this.placeOnRoad(npc);
        return;
      }
      if (!best) best = { line, direction, along };
    }
    if (best) {
      npc.line = best.line;
      npc.direction = best.direction;
      npc.along = best.along;
      npc.offX = 0;
      npc.offZ = 0;
      this.placeOnRoad(npc);
    }
  }
  blockedAhead(npc, obstacles) {
    const pos = npc.car.position;
    const fx = Math.sin(npc.car.heading);
    const fz = Math.cos(npc.car.heading);
    for (const obstacle of obstacles) {
      const dx = obstacle.x - pos.x;
      const dz = obstacle.z - pos.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0.5 || ahead > LOOK_AHEAD_METRES) continue;
      const lateral = Math.abs(dx * fz - dz * fx);
      if (lateral < BLOCKED_LATERAL_METRES) return true;
    }
    return false;
  }
  // Is anything in the opposite lane ahead of this car (within range)?
  // Covers oncoming cars on the same road AND same-direction cars that
  // are themselves overtaking (already sitting in the opposite lane).
  oncomingAhead(npc, range) {
    for (const other of this.cars) {
      if (other === npc || other.dormant) continue;
      if (other.line !== npc.line) continue;
      const gap = (other.along - npc.along) * npc.direction;
      if (gap < 0 || gap > range) continue;
      if (other.direction !== npc.direction || other.overtake > 0.5) return true;
    }
    return false;
  }
  shove(npc) {
    npc.along += npc.direction * 1.5;
    npc.stoppedTimer = 1.2;
    npc.speed = 0;
  }
  // Crash physics: a hit knocks the car OFF its line — an impulse in the
  // hit direction plus a spin, a speed cut, then a slow steer back to the
  // line once it has bled off. The harder the hit, the further it flies.
  crashHit(npc, fromX, fromZ, speed) {
    const dx = npc.car.position.x - fromX;
    const dz = npc.car.position.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    const s = Math.max(2, Math.min(12, Math.abs(speed) * 0.35));
    npc.offVx += (dx / d) * s;
    npc.offVz += (dz / d) * s;
    // Spin direction is cosmetic: Math.random, not the shared rng, so a
    // crash mid-game never shifts later spawns.
    npc.spinV += (Math.random() - 0.5) * 2.4;
    npc.speed *= 0.4;
    npc.stoppedTimer = 0;
  }
  // Pull the driver (or bike rider) out of the car so main.js can make
  // them flee on foot: detach from the car, stand them beside it.
  ejectOccupant(npc) {
    const car = npc.car;
    const walker = npc.driver || null;
    const mesh = walker ? walker.group : car.rider || null;
    if (!mesh) return null;
    if (walker) npc.driver = null;
    else if (car.rider) car.rider = null;
    const parent = mesh.parent;
    if (parent) parent.remove(mesh);
    const sideX = Math.cos(car.heading);
    const sideZ = -Math.sin(car.heading);
    mesh.position.set(car.position.x + sideX * 1.8, 0, car.position.z + sideZ * 1.8);
    mesh.rotation.set(0, car.heading, 0);
    mesh.scale.setScalar(1);
    // Back to a standing pose: the seated leg/arm angles were set on the
    // child meshes, so reset every descendant's rotation.
    mesh.traverse((child) => {
      child.rotation.x = 0;
    });
    this.scene.add(mesh);
    return { group: mesh, walker };
  }
  update(dt, obstacles, view) {
    this.view = view || null;
    this.lightClock += dt;
    this.updateLights();
    // Spawn bubble: recycle cars that drifted too far from the focus
    // (player in game, camera on the title screen). Runs before the
    // visibility skip so culled cars get recycled too.
    if (view) {
      const r2 = RECYCLE_RADIUS * RECYCLE_RADIUS;
      for (const npc of this.cars) {
        if (npc.dormant || !npc.car) continue;
        const p = npc.car.group.position;
        const dx = p.x - view.x, dz = p.z - view.z;
        if (dx * dx + dz * dz > r2) this.recycleNearFocus(npc);
      }
    }
    for (const npc of this.cars) {
      // Hidden cars (culled by distance on the title screen) skip
      // all processing. They resume frozen in place when visible.
      if (npc.car && !npc.car.group.visible) continue;
      if (npc.dormant) {
        npc.retryTimer -= dt;
        if (npc.retryTimer <= 0) {
          npc.retryTimer = RESPAWN_RETRY_SECONDS;
          if (this.activeCount < this.target) this.respawnAtEdge(npc);
        }
        continue;
      }
      // Crash recovery: slide off the line on the impulse, spin, then
      // steer back once the slide has bled off.
      if (npc.offX || npc.offZ || npc.offVx || npc.offVz) {
        npc.offX += npc.offVx * dt;
        npc.offZ += npc.offVz * dt;
        const fr = Math.max(0, 1 - 2.2 * dt);
        npc.offVx *= fr;
        npc.offVz *= fr;
        npc.spin += npc.spinV * dt;
        npc.spinV *= Math.max(0, 1 - 2 * dt);
        if (Math.hypot(npc.offVx, npc.offVz) < 1.5) {
          const pull = Math.min(1, dt * 1.6);
          npc.offX *= 1 - pull;
          npc.offZ *= 1 - pull;
          npc.spin *= 1 - Math.min(1, dt * 2);
        }
        if (Math.hypot(npc.offX, npc.offZ) < 0.05) {
          npc.offX = 0;
          npc.offZ = 0;
          npc.spin = 0;
        }
      }
      // A car knocked sideways crawls until it is back on its line.
      const cruise = Math.hypot(npc.offX, npc.offZ) > 1 ? npc.cruiseSpeed * 0.25 : npc.cruiseSpeed;
      if (this.redLightAhead(npc)) {
        npc.speed = Math.max(0, npc.speed - 30 * dt);
      } else if (npc.stoppedTimer > 0) {
        npc.stoppedTimer -= dt;
        npc.speed = 0;
      } else if (this.blockedAhead(npc, obstacles)) {
        npc.speed = Math.max(0, npc.speed - 30 * dt);
        npc.blockedTimer += dt;
        // Blocked cars queue behind the obstacle — they never swing into
        // the opposite lane. The old overtake (blocked >3s → 5s in the
        // oncoming lane) looked wrong, so it is off for good.
      } else {
        npc.speed = Math.min(cruise, npc.speed + 8 * dt);
        npc.blockedTimer = 0;
      }
      npc.overtakeTimer = Math.max(0, npc.overtakeTimer - dt);
      // Oncoming car appeared mid-overtake: abort and return to own lane.
      if (npc.overtakeTimer > 0 && this.oncomingAhead(npc, OVERTAKE_CANCEL_METRES)) npc.overtakeTimer = 0;
      npc.overtake += ((npc.overtakeTimer > 0 ? 1 : 0) - npc.overtake) * Math.min(1, dt * 2);
      npc.along += npc.direction * npc.speed * dt;
      if (npc.backupTimer > 0) {
        npc.backupTimer -= dt;
        npc.along -= npc.direction * BACKUP_SPEED * dt;
      }
      if (npc.along < npc.line.from - 2 || npc.along > npc.line.to + 2) this.respawnAtEdge(npc);
      this.placeOnRoad(npc);
      // Never render onto the sand: a crash knocks a car up to ~5.5m off
      // its line, and a coastal road is only 6m from the edge — without
      // this clamp a hit beaches the car until the pull-back recovers it.
      // The logical line/along are untouched, so the car still steers
      // back to its lane; only the rendered position stays in the city.
      const cp = npc.car.group.position;
      cp.x = Math.max(-265, Math.min(265, cp.x));
      cp.z = Math.max(-265, Math.min(265, cp.z));
      for (const wheel of npc.car.wheels) {
        wheel.wheel.rotation.x += (npc.speed / npc.car.wheelRadius) * dt;
      }
    }
  }
}