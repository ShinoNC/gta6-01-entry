import * as THREE from 'three';
import { roadLines, headingFor, districtNameAt, averageDensity, densityForMinute, NIGHTLIFE_DISTRICTS } from './city.js';
import { buildWalkerMesh, SHIRT_COLOURS, SKIN_COLOURS, HAIR_COLOURS } from './pedestrians.js';
import { weightedPick, pick, intBetween } from './random.js';
import { createCar, createBike } from './vehicles.js';

// How many cars the streets hold, and how the opening clusters split:
// the first seven hug the spawn, the next seven fill the title view.
const TRAFFIC_CAR_COUNT = 14;
const SPAWN_CLUSTER_COUNT = 7;
const TITLE_CLUSTER_COUNT = SPAWN_CLUSTER_COUNT;

// The spawn bubble: a car further than this from the focus (player in
// game, camera on the title screen) is teleported back onto a road
// RECYCLE_MIN-MAX_DIST away, preferably out of view.
const RECYCLE_RADIUS = 250;
const RECYCLE_MIN_DIST = 120;
const RECYCLE_MAX_DIST = 180;
const SPAWN_CLUSTER_RADIUS = 80;
const CENTRAL_LINE_BIAS = 0.5;
const NIGHTLIFE_LINE_BIAS = 0.6;
const DORMANT_X = 10000;
const DORMANT_Z = DORMANT_X;
const RESPAWN_RETRY_SECONDS = 5;

// Lane geometry and the look-ahead cone a car checks before moving.
const LANE_OFFSET = 2.5;
const LOOK_AHEAD_METRES = 9;
const BLOCKED_LATERAL_METRES = 2.6;

// Overtake safety: never swing into the opposite lane blind, since two
// cars overtaking head-on deadlock forever. The clear window is 20m, not
// 30m: on the busy central roads there is almost always an oncoming car
// within 30m, so blocked cars waited up to 8s instead of passing (a
// 1200s diagnostic showed the 14 longest stops never tried to overtake).
// 20m still leaves an oncoming car 1.3s+ away at top traffic speed, and
// the abort below covers anything that appears mid-manoeuvre.
const OVERTAKE_CLEAR_METRES = 20;
const OVERTAKE_CANCEL_METRES = OVERTAKE_CLEAR_METRES - 2;
const DEADLOCK_BLOCKED_SECONDS = 5;
const BACKUP_SECONDS = 1.5;
const BACKUP_SPEED = 3;

// Signal cycle in seconds: green 8, yellow 2, red 8. The two axes at one
// crossing run opposite phases, and neighbouring crossings are offset by
// half a cycle so a green wave never lines up everywhere.
const LIGHT_CYCLE = 18;
const LIGHT_GREEN = 8;
const LIGHT_YELLOW = LIGHT_GREEN + 2;
const LIGHT_ON = { red: 0xff2a3a, yellow: 0xffc828, green: 0x2aff5a };
const LIGHT_OFF = { red: 0x3a0d12, yellow: 0x3a2f0d, green: 0x0d3a1a };

// Phase table: [upper bound of the phase inside the cycle, colour shown].
const LIGHT_PHASES = [
  [LIGHT_GREEN, 'green'],
  [LIGHT_YELLOW, 'yellow'],
  [LIGHT_CYCLE, 'red'],
];

function lightState(clock, phase) {
  const t = (clock + phase) % LIGHT_CYCLE;
  for (let i = 0; i < LIGHT_PHASES.length; i += 1) {
    if (t < LIGHT_PHASES[i][0]) return LIGHT_PHASES[i][1];
  }
  return 'red';
}

// One shared lamp material per (phase, axis, colour): every head with the
// same phase shows the same state, so twelve materials cover all heads.
const lampCache = new Map();

function lampMat(phase, axis, colour) {
  const key = phase + '|' + axis + '|' + colour;
  let mat = lampCache.get(key);
  if (!mat) {
    mat = new THREE.MeshBasicMaterial({ color: LIGHT_OFF[colour] });
    lampCache.set(key, mat);
  }
  return mat;
}

// Which side of its road a car drives on: north-south roads take the
// opposite side from east-west roads, and the direction flips it again.
function laneOffsetFor(axis, direction) {
  const axisSign = axis === 'z' ? -1 : 1;
  return axisSign * direction * LANE_OFFSET;
}

// Where a seated driver sits, per body style: [x, y, z] inside the car.
// The GLB cabs put the wheel on the +x side (scaled x: sedan/taxi 0.31,
// SUV 0.37, off-roader 0.38), so GLB drivers sit at +x; bus and truck
// keep the box-era seat. The seat Y puts the pelvis at seat height:
// rotating the thigh bones does not lower the pelvis, so the group origin
// (feet) sits below the car floor on low-roof cars and the head clears
// the roof and windshield.
const DRIVER_SEATS = {
  bus: [-0.5, 0.35, 2.6],
  truck: [-0.45, 0.2, 1.5],
  van: [0.37, 0, 0.3],
  pickup: [0.38, 0, 0.3],
};
const DRIVER_SEAT_DEFAULT = [0.31, -0.37, 0.3];

// A visible driver, seated in the car: legs forward to the pedals, arms
// forward to the wheel, scaled to fit under the roof. Colours come from
// the car index, never the shared rng: drawing from it here would shift
// every spawn after traffic (seed-1 layouts must stay).
function seatDriver(scene, idx, car) {
  const shirt = SHIRT_COLOURS[idx % SHIRT_COLOURS.length];
  const skin = SKIN_COLOURS[(idx * 3 + 1) % SKIN_COLOURS.length];
  const hair = HAIR_COLOURS[(idx * 5 + 2) % HAIR_COLOURS.length];
  const mesh = buildWalkerMesh(shirt, 0x2a4a8a, skin, hair, 'none', 1);
  const seat = DRIVER_SEATS[car.style] || DRIVER_SEAT_DEFAULT;
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

// Traffic paint jobs, written as hex strings so the palette reads like a
// swatch card; parsed once at load. Order matters: pick() draws by index.
const TRAFFIC_PAINTS = ['ff6b35', '007aff', 'ffd60a', '2fd35e', 'ff2d78', 'e8e8e8', 'ff6b9d', '2ad0c4', 'e63946'].map((hex) => parseInt(hex, 16));

// Body styles and their spawn weights; Object.entries keeps insertion
// order, which weightedPick depends on.
const TRAFFIC_BODY_WEIGHTS = { sedan: 6, pickup: 2, van: 2, bike: 2 };
const TRAFFIC_BODY_STYLES = Object.entries(TRAFFIC_BODY_WEIGHTS);

// Cruise-speed band per body style, as [min, max] km/h-ish units.
const STYLE_SPEED_BAND = new Map([
  ['sedan', [9, 15]],
  ['pickup', [8, 13]],
  ['van', [7, 11]],
  ['taxi', [11, 16]],
  ['bus', [6, 10]],
  ['truck', [7, 11]],
  ['bike', [12, 18]],
]);

// Paints that take the warm (red-family) body texture.
const WARM_PAINTS = new Set([0xff6b35, 0xe63946, 0xff2d78, 0xff6b9d]);

// Scratch objects for composing instance matrices without allocating.
const _matQ = new THREE.Quaternion();
const _matT = new THREE.Vector3();
const _matUp = new THREE.Vector3(0, 1, 0);
const _matOne = new THREE.Vector3(1, 1, 1);

function pushMatrix(arr, x, y, z, rotY) {
  _matQ.setFromAxisAngle(_matUp, rotY || 0);
  _matT.set(x, y, z);
  arr.push(new THREE.Matrix4().compose(_matT, _matQ, _matOne));
}

export class Traffic {
  constructor(scene, textures, rng) {
    this.scene = scene;
    this.rng = rng;
    this.textures = textures;
    this.lines = roadLines();
    this.crossX = [];
    this.crossZ = [];
    this.spawnLines = [];
    this.spawnAvenues = [];
    this.titleLines = [];
    this.centralLines = [];
    this.nightlifeLine = null;
    for (let i = 0; i < this.lines.length; i += 1) {
      const line = this.lines[i];
      if (line.axis === 'z') this.crossX.push(line.at);
      else this.crossZ.push(line.at);
      // Roads near the spawn (0,0): the cluster and the respawn bias
      // keep the streets around the player visibly busy instead of
      // spreading the cars thinly over the whole island.
      if (Math.abs(line.at) <= 52) this.spawnLines.push(line);
      if (line.at === 0) this.spawnAvenues.push(line);
      // Title-view cluster: roads the title camera sees (orbit centre
      // (0,200), looking north). Cars here make the title screen busy.
      const inTitleView = line.axis === 'z'
        ? Math.abs(line.at) <= 104
        : line.at >= 104 && line.at <= 260;
      if (inTitleView) this.titleLines.push(line);
      if (Math.abs(line.at) <= 104) this.centralLines.push(line);
      if (!this.nightlifeLine && line.axis === 'x' && line.at === 0) this.nightlifeLine = line;
    }
    this.cars = [];
    this.target = TRAFFIC_CAR_COUNT;
    this.night = false;
    this.nextDriver = 0;
    this.lightClock = 0;
    this.lights = this.buildLights(scene);
    this.lightByKey = new Map();
    for (let i = 0; i < this.lights.length; i += 1) {
      const light = this.lights[i];
      this.lightByKey.set(light.x + ',' + light.z, light);
    }
    for (let i = 0; i < TRAFFIC_CAR_COUNT; i += 1) {
      const nearSpawn = i < SPAWN_CLUSTER_COUNT;
      const nearTitle = !nearSpawn && i < SPAWN_CLUSTER_COUNT + TITLE_CLUSTER_COUNT;
      this.cars.push(this.buildNpc(scene, rng, nearSpawn, i, nearTitle));
    }
  }

  // Time-of-day density: traffic thins out at night (see city.js). A car
  // only leaves when it reaches the end of its road, and dormant cars
  // respawn from the map edge, so nothing ever pops in or out in view.
  setDensity(minutes) {
    const density = averageDensity(minutes);
    this.target = Math.max(1, Math.round(TRAFFIC_CAR_COUNT * density));
    this.night = densityForMinute(minutes) < 0.7;
  }

  pickLine() {
    // At night most cars head for the nightlife strip; by day half the
    // respawns stay on the central roads so the busy streets refill
    // instead of thinning out.
    if (this.night && this.nightlifeLine && this.rng() < NIGHTLIFE_LINE_BIAS) return this.nightlifeLine;
    const pool = this.rng() < CENTRAL_LINE_BIAS ? this.centralLines : this.lines;
    return pick(this.rng, pool);
  }

  goDormant(npc) {
    npc.dormant = true;
    npc.retryTimer = RESPAWN_RETRY_SECONDS;
    npc.speed = 0;
    npc.car.group.position.set(DORMANT_X, 0, DORMANT_Z);
    npc.car.group.visible = false;
  }

  // Body texture matches the paint family: yellow body for yellow paint,
  // orange-red body for warm paints, blue body for the rest.
  bodyTextureFor(isTaxi, paint) {
    if (isTaxi || paint === 0xffd60a) return this.textures.carTaxi;
    if (WARM_PAINTS.has(paint)) return this.textures.carRed;
    return this.textures.carBlue;
  }

  driverIndexFor(idx) {
    if (idx >= 0) return idx;
    this.nextDriver = (this.nextDriver + 1) % 64;
    return this.nextDriver;
  }

  buildNpc(scene, rng, nearSpawn = false, idx = -1, nearTitle = false) {
    // Every car first draws a random road and a random position on it;
    // the spawn and title clusters then override both. The opening draws
    // still happen (and still consume rng) so the shared seed stream
    // stays aligned with the layout the game was tuned on.
    let line = this.pickLine();
    let along = line.from + rng() * (line.to - line.from);
    if (nearSpawn) {
      // Spawn cluster: on a road hugging the spawn, within 80m of it, so
      // the player sees moving traffic the moment the game starts. Half
      // the cluster rides the two avenues through the spawn itself (the
      // roads in the opening view), the rest the neighbouring roads.
      const onAvenue = rng() < 0.5;
      line = pick(rng, onAvenue ? this.spawnAvenues : this.spawnLines);
      along = (rng() * 2 - 1) * SPAWN_CLUSTER_RADIUS;
    } else if (nearTitle) {
      // Title cluster: on a road the title camera sees, within the
      // title-view box (z 100-300 on north-south roads, x -150..150 on
      // east-west roads), so the title screen looks busy.
      line = pick(rng, this.titleLines);
      along = line.axis === 'z' ? 100 + rng() * 200 : -150 + rng() * 300;
    }
    const direction = rng() < 0.5 ? -1 : 1;
    const isTaxi = rng() < 0.15;
    const style = isTaxi ? 'taxi' : weightedPick(rng, TRAFFIC_BODY_STYLES);
    const paint = isTaxi ? 0xffc828 : pick(rng, TRAFFIC_PAINTS);
    const texture = this.bodyTextureFor(isTaxi, paint);
    const band = STYLE_SPEED_BAND.get(style);
    const car = style === 'bike'
      ? createBike(scene, 'TRAFFIC', paint, 0, 0, 0, true)
      : createCar(scene, this.textures, isTaxi ? 'KEYS TAXI' : 'TRAFFIC', texture, paint, 0, 0, 0, style);
    const npc = {
      car,
      driver: null,
      line,
      direction,
      along,
      speedBand: [band[0], band[1]],
      cruiseSpeed: intBetween(rng, band[0], band[1]),
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
    if (style !== 'bike') npc.driver = seatDriver(scene, this.driverIndexFor(idx), car);
    this.placeOnRoad(npc);
    if (this.activeCount >= this.target) this.goDormant(npc);
    return npc;
  }

  placeOnRoad(npc) {
    // The lane offset flips to the far side while overtaking; the crash
    // offset (offX/offZ) and the spin ride on top of the lane position.
    const lane = laneOffsetFor(npc.line.axis, npc.direction) * (1 - 2 * npc.overtake);
    const northSouth = npc.line.axis === 'z';
    const x = northSouth ? npc.line.at + lane + npc.offX : npc.along + npc.offX;
    const z = northSouth ? npc.along + npc.offZ : npc.line.at + lane + npc.offZ;
    npc.car.group.position.set(x, 0, z);
    npc.car.heading = headingFor(npc.line.axis, npc.direction);
    npc.car.group.rotation.y = npc.car.heading + npc.spin;
  }

  // Fresh motion state for a respawned car: a new cruise speed inside its
  // band, all timers cleared, no crash offset or spin left over.
  resetNpcMotion(npc) {
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
  }

  respawnAtEdge(npc) {
    // Park the car at the end of a random road, out of the player's view
    // when possible; if every try lands in view, take the farthest one so
    // the pop-in is as distant as possible.
    const view = this.view;
    let found = false;
    let farthest = null;
    let farthestD = -1;
    for (let attempt = 0; attempt < 8 && !found; attempt += 1) {
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
        found = true;
      } else if (d > farthestD) {
        farthestD = d;
        farthest = { line, direction, along };
      }
    }
    if (!found && farthest) {
      npc.line = farthest.line;
      npc.direction = farthest.direction;
      npc.along = farthest.along;
    }
    this.resetNpcMotion(npc);
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

  // Roads whose centreline passes within 150m of a point, on either axis.
  linesNear(fx, fz) {
    const near = [];
    for (let i = 0; i < this.lines.length; i += 1) {
      const line = this.lines[i];
      const gap = line.axis === 'z' ? Math.abs(line.at - fx) : Math.abs(line.at - fz);
      if (gap <= 150) near.push(line);
    }
    return near;
  }

  moveNpcTo(npc, line, direction, along) {
    npc.line = line;
    npc.direction = direction;
    npc.along = along;
    npc.offX = 0;
    npc.offZ = 0;
    this.placeOnRoad(npc);
  }

  // Spawn bubble: teleport a far-away car to a road near the focus
  // instead of letting it drive the empty outskirts. Prefers spots out
  // of view (same inView check as respawnAtEdge); falls back to the
  // first candidate if all 8 are in view.
  recycleNearFocus(npc) {
    const view = this.view;
    const fx = view ? view.x : 0;
    const fz = view ? view.z : 0;
    let fallback = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const near = this.linesNear(fx, fz);
      const line = pick(this.rng, near.length > 0 ? near : this.lines);
      const direction = this.rng() < 0.5 ? -1 : 1;
      const target = line.axis === 'z' ? fz : fx;
      const dist = RECYCLE_MIN_DIST + this.rng() * (RECYCLE_MAX_DIST - RECYCLE_MIN_DIST);
      const sign = this.rng() < 0.5 ? -1 : 1;
      const along = Math.max(line.from, Math.min(line.to, target + sign * dist));
      const off = laneOffsetFor(line.axis, direction);
      const x = line.axis === 'z' ? line.at + off : along;
      const z = line.axis === 'z' ? along : line.at + off;
      if (!this.inView(x, z, view)) {
        this.moveNpcTo(npc, line, direction, along);
        return;
      }
      if (!fallback) fallback = { line, direction, along };
    }
    if (fallback) this.moveNpcTo(npc, fallback.line, fallback.direction, fallback.along);
  }

  // Real signals at the nine central crossings: a pole and a head per
  // axis, three lamps each, double-faced so both approaches see them.
  // Everything is instanced — 18 poles + 18 heads + 108 lamps in a
  // handful of draw calls instead of 144 — and heads with the same phase
  // share lamp materials, so updateLights drives every head by
  // recolouring twelve materials.
  buildLights(scene) {
    const lights = [];
    const grid = [-52, 0, 52];
    const poleMat = new THREE.MeshLambertMaterial({ color: 0x70707c });
    const headMat = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
    const poleGeo = new THREE.BoxGeometry(0.25, 5, 0.25);
    const headGeo = new THREE.BoxGeometry(0.9, 1.4, 0.25);
    const lampGeo = new THREE.SphereGeometry(0.16, 8, 8);
    const poleMats = [];
    const headMats = [];
    const lampMats = new Map();
    for (let gx = 0; gx < grid.length; gx += 1) {
      for (let gz = 0; gz < grid.length; gz += 1) {
        const x = grid[gx];
        const z = grid[gz];
        const phase = ((x + z) / 52) % 2 === 0 ? 0 : LIGHT_CYCLE / 2;
        lights.push({ x, z, phase, stateZ: 'green', stateX: 'red' });
        this.addSignalHeads(poleMats, headMats, lampMats, x, z, phase);
      }
    }
    this.instanced(scene, poleGeo, poleMat, poleMats);
    this.instanced(scene, headGeo, headMat, headMats);
    for (const [key, mats] of lampMats) {
      const parts = key.split('|');
      this.instanced(scene, lampGeo, lampMat(Number(parts[0]), parts[1], parts[2]), mats);
    }
    return lights;
  }

  addSignalHeads(poleMats, headMats, lampMats, x, z, phase) {
    // Both poles stand on the west sidewalk corners, 6.5m off both road
    // centrelines: the north-south head (lamps face +/-z) on the
    // south-west corner, the east-west head (lamps face +/-x) on the
    // north-west corner. The south-east corner already holds a
    // streetlight pole at (+6.8, +6.8). One head geometry serves both
    // orientations — the narrow head is the wide head turned 90 degrees.
    const heads = [
      { axis: 'z', px: x - 6.5, pz: z + 6.5, wide: true },
      { axis: 'x', px: x - 6.5, pz: z - 6.5, wide: false },
    ];
    const lampRows = [
      ['red', 0.45],
      ['yellow', 0],
      ['green', -0.45],
    ];
    for (let h = 0; h < heads.length; h += 1) {
      const head = heads[h];
      pushMatrix(poleMats, head.px, 2.5, head.pz, 0);
      pushMatrix(headMats, head.px, 4.6, head.pz, head.wide ? 0 : Math.PI / 2);
      for (let r = 0; r < lampRows.length; r += 1) {
        const colour = lampRows[r][0];
        const dy = lampRows[r][1];
        const key = phase + '|' + head.axis + '|' + colour;
        let mats = lampMats.get(key);
        if (!mats) {
          mats = [];
          lampMats.set(key, mats);
        }
        for (let side = -1; side <= 1; side += 2) {
          const lx = head.px + (head.wide ? 0 : side * 0.16);
          const lz = head.pz + (head.wide ? side * 0.16 : 0);
          pushMatrix(mats, lx, 4.6 + dy, lz, 0);
        }
      }
    }
  }

  instanced(scene, geo, mat, mats) {
    const inst = new THREE.InstancedMesh(geo, mat, mats.length);
    for (let i = 0; i < mats.length; i += 1) inst.setMatrixAt(i, mats[i]);
    inst.instanceMatrix.needsUpdate = true;
    inst.computeBoundingSphere();
    scene.add(inst);
  }

  updateLights() {
    for (let i = 0; i < this.lights.length; i += 1) {
      const light = this.lights[i];
      light.stateZ = lightState(this.lightClock, light.phase);
      light.stateX = lightState(this.lightClock, light.phase + LIGHT_CYCLE / 2);
    }
    const phases = [0, LIGHT_CYCLE / 2];
    const axes = ['z', 'x'];
    const colours = ['red', 'yellow', 'green'];
    for (let p = 0; p < phases.length; p += 1) {
      for (let a = 0; a < axes.length; a += 1) {
        const axis = axes[a];
        const shift = axis === 'x' ? LIGHT_CYCLE / 2 : 0;
        const state = lightState(this.lightClock, phases[p] + shift);
        for (let c = 0; c < colours.length; c += 1) {
          const colour = colours[c];
          const mat = lampMat(phases[p], axis, colour);
          mat.color.setHex(state === colour ? LIGHT_ON[colour] : LIGHT_OFF[colour]);
        }
      }
    }
  }

  // A red signal ahead on this car's own road means stopping short of
  // the crossing; a car already past the 1m stop line carries on.
  redLightAhead(npc) {
    const northSouth = npc.line.axis === 'z';
    const crosses = northSouth ? this.crossZ : this.crossX;
    for (let i = 0; i < crosses.length; i += 1) {
      const cross = crosses[i];
      const ahead = (cross - npc.along) * npc.direction;
      if (ahead < 1 || ahead > 9) continue;
      const key = northSouth ? npc.line.at + ',' + cross : cross + ',' + npc.line.at;
      const light = this.lightByKey.get(key);
      if (!light) continue;
      const state = northSouth ? light.stateZ : light.stateX;
      return state === 'red';
    }
    return false;
  }

  // A point counts as visible when it is near the focus and in front of
  // the view direction; anything far away or behind is fair game for a
  // respawn. A respawn point in the player's view would pop a car in
  // right in front of them.
  inView(x, z, view) {
    if (!view) return false;
    const dx = x - view.x;
    const dz = z - view.z;
    if (Math.hypot(dx, dz) > 80) return false;
    return dx * view.fx + dz * view.fz >= 0;
  }

  blockedAhead(npc, obstacles) {
    const pos = npc.car.position;
    const fx = Math.sin(npc.car.heading);
    const fz = Math.cos(npc.car.heading);
    for (let i = 0; i < obstacles.length; i += 1) {
      const obstacle = obstacles[i];
      const dx = obstacle.x - pos.x;
      const dz = obstacle.z - pos.z;
      const ahead = dx * fx + dz * fz;
      if (ahead < 0.5 || ahead > LOOK_AHEAD_METRES) continue;
      const lateral = Math.abs(dx * fz - dz * fx);
      if (lateral < BLOCKED_LATERAL_METRES) return true;
    }
    return false;
  }

  // Anything in the opposite lane ahead of this car (within range)?
  // Covers oncoming cars on the same road AND same-direction cars that
  // are themselves overtaking (already sitting in the opposite lane).
  oncomingAhead(npc, range) {
    for (let i = 0; i < this.cars.length; i += 1) {
      const other = this.cars[i];
      if (other === npc || other.dormant || other.line !== npc.line) continue;
      const gap = (other.along - npc.along) * npc.direction;
      if (gap < 0 || gap > range) continue;
      if (other.direction !== npc.direction || other.overtake > 0.5) return true;
    }
    return false;
  }

  shove(npc) {
    npc.speed = 0;
    npc.stoppedTimer = 1.2;
    npc.along += npc.direction * 1.5;
  }

  // Crash physics: a hit knocks the car OFF its line — an impulse in the
  // hit direction plus a spin, a speed cut, then a slow steer back to the
  // line once it has bled off. The harder the hit, the further it flies.
  crashHit(npc, fromX, fromZ, speed) {
    const px = npc.car.position.x - fromX;
    const pz = npc.car.position.z - fromZ;
    const dist = Math.hypot(px, pz) || 1;
    const force = Math.max(2, Math.min(12, Math.abs(speed) * 0.35));
    npc.offVx += (px / dist) * force;
    npc.offVz += (pz / dist) * force;
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
    let mesh = null;
    let walker = null;
    if (npc.driver) {
      walker = npc.driver;
      mesh = walker.group;
      npc.driver = null;
    } else if (car.rider) {
      mesh = car.rider;
      car.rider = null;
    }
    if (!mesh) return null;
    if (mesh.parent) mesh.parent.remove(mesh);
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
    if (view) this.recycleFarCars(view);
    for (let i = 0; i < this.cars.length; i += 1) {
      this.stepCar(this.cars[i], dt, obstacles);
    }
  }

  // Spawn bubble: recycle cars that drifted too far from the focus
  // (player in game, camera on the title screen). Runs before the
  // visibility skip so culled cars get recycled too.
  recycleFarCars(view) {
    const r2 = RECYCLE_RADIUS * RECYCLE_RADIUS;
    for (let i = 0; i < this.cars.length; i += 1) {
      const npc = this.cars[i];
      if (npc.dormant || !npc.car) continue;
      const p = npc.car.group.position;
      const dx = p.x - view.x;
      const dz = p.z - view.z;
      if (dx * dx + dz * dz > r2) this.recycleNearFocus(npc);
    }
  }

  stepCar(npc, dt, obstacles) {
    // Hidden cars (culled by distance on the title screen) skip all
    // processing. They resume frozen in place when visible.
    if (npc.car && !npc.car.group.visible) return;
    if (npc.dormant) {
      npc.retryTimer -= dt;
      if (npc.retryTimer <= 0) {
        npc.retryTimer = RESPAWN_RETRY_SECONDS;
        if (this.activeCount < this.target) this.respawnAtEdge(npc);
      }
      return;
    }
    this.recoverFromCrash(npc, dt);
    this.driveCar(npc, dt, obstacles);
    this.advanceCar(npc, dt);
    this.placeOnRoad(npc);
    this.clampToCity(npc);
    this.spinWheels(npc, dt);
  }

  // Crash recovery: slide off the line on the impulse, spin, then steer
  // back once the slide has bled off.
  recoverFromCrash(npc, dt) {
    const sliding = npc.offX !== 0 || npc.offZ !== 0 || npc.offVx !== 0 || npc.offVz !== 0;
    if (!sliding) return;
    npc.offX += npc.offVx * dt;
    npc.offZ += npc.offVz * dt;
    const friction = Math.max(0, 1 - 2.2 * dt);
    npc.offVx *= friction;
    npc.offVz *= friction;
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

  driveCar(npc, dt, obstacles) {
    // A car knocked sideways crawls until it is back on its line.
    const displaced = Math.hypot(npc.offX, npc.offZ) > 1;
    const cruise = displaced ? npc.cruiseSpeed * 0.25 : npc.cruiseSpeed;
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
    const target = npc.overtakeTimer > 0 ? 1 : 0;
    npc.overtake += (target - npc.overtake) * Math.min(1, dt * 2);
  }

  advanceCar(npc, dt) {
    npc.along += npc.direction * npc.speed * dt;
    if (npc.backupTimer > 0) {
      npc.backupTimer -= dt;
      npc.along -= npc.direction * BACKUP_SPEED * dt;
    }
    if (npc.along < npc.line.from - 2 || npc.along > npc.line.to + 2) this.respawnAtEdge(npc);
  }

  // Never render onto the sand: a crash knocks a car up to ~5.5m off its
  // line, and a coastal road is only 6m from the edge — without this
  // clamp a hit beaches the car until the pull-back recovers it. The
  // logical line/along are untouched, so the car still steers back to
  // its lane; only the rendered position stays in the city.
  clampToCity(npc) {
    const cp = npc.car.group.position;
    cp.x = Math.max(-265, Math.min(265, cp.x));
    cp.z = Math.max(-265, Math.min(265, cp.z));
  }

  spinWheels(npc, dt) {
    const roll = (npc.speed / npc.car.wheelRadius) * dt;
    const wheels = npc.car.wheels;
    for (let i = 0; i < wheels.length; i += 1) {
      wheels[i].wheel.rotation.x += roll;
    }
  }

  get activeCount() {
    let count = 0;
    for (let i = 0; i < this.cars.length; i += 1) {
      if (!this.cars[i].dormant) count += 1;
    }
    return count;
  }
}
