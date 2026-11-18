// NPC traffic: cars that drive the city roads in their own lanes, brake
// when something blocks the road ahead, and respawn at the map edge when
// they reach the end of a road. The look-ahead check makes them stop for
// the player's car too.
import { createCar } from './vehicles.js';
import { roadLines } from './city.js';
import { intBetween, pick } from './random.js';

export const TRAFFIC_CAR_COUNT = 10;
const TRAFFIC_MIN_SPEED = 9;
const TRAFFIC_MAX_SPEED = 15;
const LANE_OFFSET = 2.5;
const LOOK_AHEAD_METRES = 9;
const BLOCKED_LATERAL_METRES = 2.6;

const TRAFFIC_PAINTS = [0xd6303e, 0x346edc, 0xe8a33d, 0x3da86b, 0x9a5fd0, 0xe8e8e8];

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
    this.cars = [];
    for (let i = 0; i < TRAFFIC_CAR_COUNT; i += 1) {
      const line = pick(rng, this.lines);
      const direction = rng() < 0.5 ? -1 : 1;
      const paint = pick(rng, TRAFFIC_PAINTS);
      const car = createCar(
        scene,
        textures,
        'TRAFFIC',
        paint === 0xd6303e ? textures.carRed : textures.carBlue,
        paint,
        0,
        0,
        0,
      );
      const npc = {
        car,
        line,
        direction,
        along: line.from + rng() * (line.to - line.from),
        cruiseSpeed: intBetween(rng, TRAFFIC_MIN_SPEED, TRAFFIC_MAX_SPEED),
        speed: 0,
        stoppedTimer: 0,
      };
      this.placeOnRoad(npc);
      this.cars.push(npc);
    }
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
