// NPC traffic: cars that drive the city roads in their own lanes, brake
// when something blocks the road ahead, and respawn at the map edge when
// they reach the end of a road. The look-ahead check makes them stop for
// the player's car too. The fleet is mixed — sedans, a pickup, a van and a
// yellow taxi — with a different cruise speed per body style, so the road
// reads as a real city instead of ten copies of one car.
import { createCar } from './vehicles.js';
import { roadLines } from './city.js';
import { intBetween, pick, weightedPick } from './random.js';

export const TRAFFIC_CAR_COUNT = 10;
const TRAFFIC_MIN_SPEED = 9;
const TRAFFIC_MAX_SPEED = 15;
const LANE_OFFSET = 2.5;
const LOOK_AHEAD_METRES = 9;
const BLOCKED_LATERAL_METRES = 2.6;

const TRAFFIC_PAINTS = [0xd6303e, 0x346edc, 0xe8a33d, 0x3da86b, 0x9a5fd0, 0xe8e8e8, 0xff6b9d, 0x2ad0c4, 0xffc828];
const TRAFFIC_BODY_STYLES = [
  ['sedan', 6],
  ['pickup', 2],
  ['van', 2],
];
const STYLE_SPEED_BAND = {
  sedan: [9, 15],
  pickup: [8, 13],
  van: [7, 11],
  taxi: [11, 16],
};

export function laneOffsetFor(axis, direction) {
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
    this.rng = rng;
    this.textures = textures;
    this.cars = [];
    for (let i = 0; i < TRAFFIC_CAR_COUNT; i += 1) {
      this.cars.push(this.buildNpc(scene, rng));
    }
  }

  buildNpc(scene, rng) {
    const line = pick(rng, this.lines);
    const direction = rng() < 0.5 ? -1 : 1;
    const isTaxi = rng() < 0.15;
    const style = isTaxi ? 'sedan' : weightedPick(rng, TRAFFIC_BODY_STYLES);
    const paint = isTaxi ? 0xffc828 : pick(rng, TRAFFIC_PAINTS);
    const texture = isTaxi ? this.textures.carTaxi : paint === 0xd6303e || paint === 0xe8a33d ? this.textures.carRed : this.textures.carBlue;
    const [minSpeed, maxSpeed] = STYLE_SPEED_BAND[isTaxi ? 'taxi' : style];
    const car = createCar(scene, this.textures, isTaxi ? 'KEYS TAXI' : 'TRAFFIC', texture, paint, 0, 0, 0, style);
    const npc = {
      car,
      line,
      direction,
      along: line.from + rng() * (line.to - line.from),
      cruiseSpeed: intBetween(rng, minSpeed, maxSpeed),
      speed: 0,
      stoppedTimer: 0,
    };
    this.placeOnRoad(npc);
    return npc;
  }

  placeOnRoad(npc) {
    const offset = laneOffsetFor(npc.line.axis, npc.direction);
    if (npc.line.axis === 'z') {
      npc.car.group.position.set(npc.line.at + offset, 0, npc.along);
    } else {
      npc.car.group.position.set(npc.along, 0, npc.line.at + offset);
    }
    npc.car.heading = headingFor(npc.line.axis, npc.direction);
    npc.car.group.rotation.y = npc.car.heading;
  }

  respawnAtEdge(npc) {
    npc.line = pick(this.rng, this.lines);
    npc.direction = this.rng() < 0.5 ? -1 : 1;
    npc.along = npc.direction > 0 ? npc.line.from : npc.line.to;
    npc.cruiseSpeed = intBetween(this.rng, TRAFFIC_MIN_SPEED, TRAFFIC_MAX_SPEED);
    this.placeOnRoad(npc);
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
      if (npc.stoppedTimer > 0) {
        npc.stoppedTimer -= dt;
        npc.speed = 0;
      } else if (this.blockedAhead(npc, obstacles)) {
        npc.speed = Math.max(0, npc.speed - 30 * dt);
      } else {
        npc.speed = Math.min(npc.cruiseSpeed, npc.speed + 8 * dt);
      }
      npc.along += npc.direction * npc.speed * dt;
      if (npc.along < npc.line.from - 2 || npc.along > npc.line.to + 2) this.respawnAtEdge(npc);
      this.placeOnRoad(npc);
      for (const wheel of npc.car.wheels) {
        wheel.wheel.rotation.x += (npc.speed / 0.36) * dt;
      }
    }
  }
}
