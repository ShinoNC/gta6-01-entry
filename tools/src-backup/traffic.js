import { createCar, createBike } from './vehicles.js';
import { roadLines, averageDensity, densityForMinute, districtNameAt, NIGHTLIFE_DISTRICTS } from './city.js';
import { intBetween, pick, weightedPick } from './random.js';
const TRAFFIC_CAR_COUNT = 28;
const DORMANT_X = 10000;
const DORMANT_Z = 10000;
const RESPAWN_RETRY_SECONDS = 5;
const NIGHTLIFE_LINE_BIAS = 0.6;
const LANE_OFFSET = 2.5;
const LOOK_AHEAD_METRES = 9;
const BLOCKED_LATERAL_METRES = 2.6;
const TRAFFIC_PAINTS = [0xd6303e, 0x346edc, 0xe8a33d, 0x3da86b, 0x9a5fd0, 0xe8e8e8, 0xff6b9d, 0x2ad0c4, 0xffc828];
const TRAFFIC_BODY_STYLES = [
  ['sedan', 6],
  ['pickup', 2],
  ['van', 2],
  ['bus', 1],
  ['truck', 1],
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
export function headingFor(axis, direction) {
  if (axis === 'z') return direction > 0 ? 0 : Math.PI;
  return direction > 0 ? Math.PI / 2 : -Math.PI / 2;
}
export class Traffic {
  constructor(scene, textures, rng) {
    this.lines = roadLines();
    this.nightlifeLine = this.lines.find((line) => line.axis === 'x' && line.at === 0);
    this.rng = rng;
    this.textures = textures;
    this.cars = [];
    this.target = TRAFFIC_CAR_COUNT;
    this.night = false;
    for (let i = 0; i < TRAFFIC_CAR_COUNT; i += 1) {
      this.cars.push(this.buildNpc(scene, rng));
    }
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
    return pick(this.rng, this.lines);
  }
  goDormant(npc) {
    npc.dormant = true;
    npc.retryTimer = RESPAWN_RETRY_SECONDS;
    npc.speed = 0;
    npc.car.group.visible = false;
    npc.car.group.position.set(DORMANT_X, 0, DORMANT_Z);
  }
  buildNpc(scene, rng) {
    const line = this.pickLine();
    const direction = rng() < 0.5 ? -1 : 1;
    const isTaxi = rng() < 0.15;
    const style = isTaxi ? 'taxi' : weightedPick(rng, TRAFFIC_BODY_STYLES);
    const paint = isTaxi ? 0xffc828 : pick(rng, TRAFFIC_PAINTS);
    const texture = isTaxi ? this.textures.carTaxi : paint === 0xd6303e || paint === 0xe8a33d ? this.textures.carRed : this.textures.carBlue;
    const [minSpeed, maxSpeed] = STYLE_SPEED_BAND[style];
    const car =
      style === 'bike'
        ? createBike(scene, 'TRAFFIC', paint, 0, 0, 0, true)
        : createCar(scene, this.textures, isTaxi ? 'KEYS TAXI' : 'TRAFFIC', texture, paint, 0, 0, 0, style);
    const npc = {
      car,
      line,
      direction,
      along: line.from + rng() * (line.to - line.from),
      speedBand: [minSpeed, maxSpeed],
      cruiseSpeed: intBetween(rng, minSpeed, maxSpeed),
      speed: 0,
      stoppedTimer: 0,
      blockedTimer: 0,
      overtakeTimer: 0,
      overtake: 0,
      dormant: false,
      retryTimer: 0,
    };
    this.placeOnRoad(npc);
    if (this.activeCount >= this.target) this.goDormant(npc);
    return npc;
  }
  placeOnRoad(npc) {
    const offset = laneOffsetFor(npc.line.axis, npc.direction) * (1 - 2 * npc.overtake);
    if (npc.line.axis === 'z') {
      npc.car.group.position.set(npc.line.at + offset, 0, npc.along);
    } else {
      npc.car.group.position.set(npc.along, 0, npc.line.at + offset);
    }
    npc.car.heading = headingFor(npc.line.axis, npc.direction);
    npc.car.group.rotation.y = npc.car.heading;
  }
  respawnAtEdge(npc) {
    npc.line = this.pickLine();
    npc.direction = this.rng() < 0.5 ? -1 : 1;
    npc.along = npc.direction > 0 ? npc.line.from : npc.line.to;
    npc.cruiseSpeed = intBetween(this.rng, npc.speedBand[0], npc.speedBand[1]);
    npc.blockedTimer = 0;
    npc.overtakeTimer = 0;
    npc.overtake = 0;
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
  shove(npc) {
    npc.along += npc.direction * 1.5;
    npc.stoppedTimer = 1.2;
    npc.speed = 0;
  }
  update(dt, obstacles) {
    for (const npc of this.cars) {
      if (npc.dormant) {
        npc.retryTimer -= dt;
        if (npc.retryTimer <= 0) {
          npc.retryTimer = RESPAWN_RETRY_SECONDS;
          if (this.activeCount < this.target) this.respawnAtEdge(npc);
        }
        continue;
      }
      if (npc.stoppedTimer > 0) {
        npc.stoppedTimer -= dt;
        npc.speed = 0;
      } else if (this.blockedAhead(npc, obstacles)) {
        npc.speed = Math.max(0, npc.speed - 30 * dt);
        npc.blockedTimer += dt;
        // Blocked too long (a player standing in the road, a pile-up):
        // swing into the opposite lane and go around instead of queuing
        // behind the obstacle forever.
        if (npc.blockedTimer > 3) npc.overtakeTimer = 5;
      } else {
        npc.speed = Math.min(npc.cruiseSpeed, npc.speed + 8 * dt);
        npc.blockedTimer = 0;
      }
      npc.overtakeTimer = Math.max(0, npc.overtakeTimer - dt);
      npc.overtake += ((npc.overtakeTimer > 0 ? 1 : 0) - npc.overtake) * Math.min(1, dt * 2);
      npc.along += npc.direction * npc.speed * dt;
      if (npc.along < npc.line.from - 2 || npc.along > npc.line.to + 2) this.respawnAtEdge(npc);
      this.placeOnRoad(npc);
      for (const wheel of npc.car.wheels) {
        wheel.wheel.rotation.x += (npc.speed / npc.car.wheelRadius) * dt;
      }
    }
  }
}