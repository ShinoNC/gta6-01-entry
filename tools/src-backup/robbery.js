import { createCar } from './vehicles.js';
import { roadLines } from './city.js';
import { headingFor } from './traffic.js';
import { pick } from './random.js';
const GETAWAY_SPEED = 26, GETAWAY_HEALTH = 100, RAM_DAMAGE = 25, SHOT_DAMAGE = 12, POLICE_RAM_DAMAGE = 2;
const RAM_CD = 0.8, TIMEOUT = 120, FIRST_MIN = 90, FIRST_MAX = 150, NEXT_MIN = 120, NEXT_MAX = 240;
const ESCAPE_RADIUS = 18, CHASER_SPEED = 34, CHASER_ACCEL = 16, RAM_RANGE = 4.5, FOLLOW_RANGE = 8;
export class Robbery {
  constructor(scene, textures, city, rng, police, callbacks) {
    this.scene = scene;
    this.textures = textures;
    this.city = city;
    this.rng = rng;
    this.police = police;
    this.callbacks = callbacks;
    this.lines = roadLines();
    this.getaway = null;
    this.chasers = [];
    this.escape = null;
    this.eventTimer = 0;
    this.timer = FIRST_MIN + rng() * (FIRST_MAX - FIRST_MIN);
    this.clock = 0;
    this.lastHitBy = null;
  }
  get active() {
    return this.getaway !== null;
  }
  get blip() {
    return this.getaway ? { x: this.getaway.car.position.x, z: this.getaway.car.position.z } : null;
  }
  forceStart() {
    this.timer = 0;
  }
  pickEscapePoint(fromX, fromZ) {
    let best = null, bestDist = -1;
    for (const line of this.lines) {
      const ends = line.axis === 'x' ? [{ x: line.from, z: line.at }, { x: line.to, z: line.at }] : [{ x: line.at, z: line.from }];
      for (const end of ends) {
        const dist = Math.hypot(end.x - fromX, end.z - fromZ);
        if (dist > bestDist) {
          bestDist = dist;
          best = end;
        }
      }
    }
    return best;
  }
  startEvent(playerPos) {
    let line = pick(this.rng, this.lines);
    let along = line.from + this.rng() * (line.to - line.from);
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = pick(this.rng, this.lines);
      const candidateAlong = candidate.from + this.rng() * (candidate.to - candidate.from);
      const candidateX = candidate.axis === 'z' ? candidate.at : candidateAlong;
      const candidateZ = candidate.axis === 'z' ? candidateAlong : candidate.at;
      const dist = Math.hypot(candidateX - playerPos.x, candidateZ - playerPos.z);
      if (dist > 45 && dist < 90) {
        line = candidate;
        along = candidateAlong;
        break;
      }
    }
    const direction = this.rng() < 0.5 ? -1 : 1;
    const x = line.axis === 'z' ? line.at : along;
    const z = line.axis === 'z' ? along : line.at;
    const car = createCar(this.scene, this.textures, 'GETAWAY', this.textures.carBlue, 0x14141a, x, z, headingFor(line.axis, direction));
    this.getaway = { car, line, direction, along, speed: GETAWAY_SPEED, health: GETAWAY_HEALTH, stopped: false, ramCooldown: 0, turnCooldown: 0 };
    this.police.placeOnRoad(this.getaway);
    this.escape = this.pickEscapePoint(x, z);
    this.eventTimer = TIMEOUT;
    this.lastHitBy = null;
    this.chasers = [];
    for (let i = 0; i < 2; i += 1) {
      const behind = Math.max(line.from + 2, Math.min(line.to - 2, along - direction * (14 + i * 8)));
      const chaseX = line.axis === 'z' ? line.at : behind;
      const chaseZ = line.axis === 'z' ? behind : line.at;
      const unit = this.police.createPoliceCar(chaseX, chaseZ, headingFor(line.axis, direction), `CHASE-${i + 1}`);
      unit.line = line;
      unit.direction = direction;
      unit.along = behind;
      unit.turnCooldown = 0;
      unit.ramCooldown = 0;
      unit.car.speed = CHASER_SPEED;
      this.chasers.push(unit);
    }
    this.callbacks.onStart();
  }
  damage(amount, by) {
    if (!this.getaway || this.getaway.stopped) return;
    this.getaway.health -= amount;
    this.lastHitBy = by;
    if (this.getaway.health > 0) return;
    this.getaway.stopped = true;
    this.getaway.speed = 0;
    this.finish(true);
  }
  shotByPlayer() {
    this.damage(SHOT_DAMAGE, 'player');
  }
  ramByPlayer() {
    if (!this.getaway || this.getaway.stopped || this.getaway.ramCooldown > 0) return false;
    this.getaway.ramCooldown = RAM_CD;
    this.getaway.speed *= 0.4;
    this.damage(RAM_DAMAGE, 'player');
    return true;
  }
  finish(stopped) {
    const byPlayer = stopped && this.lastHitBy === 'player';
    const getaway = this.getaway;
    const chasers = this.chasers;
    this.getaway = null;
    this.chasers = [];
    this.escape = null;
    this.timer = NEXT_MIN + this.rng() * (NEXT_MAX - NEXT_MIN);
    if (getaway) this.scene.remove(getaway.car.group);
    for (const unit of chasers) this.scene.remove(unit.car.group);
    if (stopped) this.callbacks.onStopped(byPlayer);
    else this.callbacks.onEscaped();
  }
  moveGetaway(dt) {
    const unit = this.getaway;
    if (unit.stopped) return;
    unit.turnCooldown = Math.max(0, unit.turnCooldown - dt);
    unit.ramCooldown = Math.max(0, unit.ramCooldown - dt);
    unit.speed = Math.min(GETAWAY_SPEED, unit.speed + 12 * dt);
    this.police.maybeTurnAtIntersection(unit, this.escape);
    unit.along += unit.direction * unit.speed * dt;
    if (unit.along < unit.line.from || unit.along > unit.line.to) unit.direction *= -1;
    this.police.placeOnRoad(unit);
    for (const wheel of unit.car.wheels) wheel.wheel.rotation.x += (unit.speed / 0.36) * dt;
    if (Math.hypot(unit.car.position.x - this.escape.x, unit.car.position.z - this.escape.z) < ESCAPE_RADIUS) this.finish(false);
  }
  moveChaser(dt, unit) {
    const target = this.getaway.car.position;
    const car = unit.car;
    const dist = Math.hypot(target.x - car.position.x, target.z - car.position.z);
    const blinkOn = Math.floor(this.clock * 2.8) % 2 === 0;
    unit.redMaterial.color.setHex(blinkOn ? 0xff2a3a : 0x551018);
    unit.blueMaterial.color.setHex(blinkOn ? 0x10204d : 0x2a6bff);
    unit.turnCooldown = Math.max(0, unit.turnCooldown - dt);
    car.speed = Math.min(CHASER_SPEED, car.speed + CHASER_ACCEL * dt);
    if (dist < FOLLOW_RANGE) car.speed = Math.min(car.speed, this.getaway.speed);
    this.police.maybeTurnAtIntersection(unit, target);
    unit.along += unit.direction * car.speed * dt;
    if (unit.along < unit.line.from || unit.along > unit.line.to) unit.direction *= -1;
    this.police.placeOnRoad(unit);
    if (unit.ramCooldown > 0) unit.ramCooldown -= dt;
    else if (dist < RAM_RANGE) {
      unit.ramCooldown = 1;
      this.damage(POLICE_RAM_DAMAGE, 'police');
    }
    for (const wheel of car.wheels) wheel.wheel.rotation.x += (car.speed / 0.36) * dt;
  }
  update(dt, context) {
    this.clock += dt;
    if (!this.getaway) {
      this.timer -= dt;
      if (this.timer <= 0) this.startEvent(context.playerPos);
      return;
    }
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      this.finish(false);
      return;
    }
    this.moveGetaway(dt);
    if (!this.getaway) return;
    for (const unit of this.chasers) this.moveChaser(dt, unit);
  }
}