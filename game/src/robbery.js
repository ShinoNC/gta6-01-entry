import { createCar } from './vehicles.js';
import { roadLines, headingFor } from './city.js';
import { pick } from './random.js';

// Robbery tuning, grouped: the getaway car's pace and toughness, what
// a ram and a bullet do to it, how often the event fires, and how the
// pursuing units behave.
const TUNE = {
  getawaySpeed: 26,
  getawayHealth: 100,
  getawayAccel: 12,
  ramDamage: 25,
  shotDamage: 12,
  policeRamDamage: 2,
  ramCooldown: 0.8,
  policeRamCooldown: 1,
  eventTimeout: 120,
  firstMin: 90,
  firstMax: 150,
  nextMin: 120,
  nextMax: 240,
  escapeRadius: 18,
  chaserSpeed: 34,
  chaserAccel: 16,
  chaserStagger: 0.5,
  ramRange: 4.5,
  followRange: 8,
  blinkRate: 2.8,
  wheelRadius: 0.36,
};
const CHASER_COUNT = 2;
const SPAWN_TRIES = 12;
const SPAWN_MIN_DIST = 45;
const SPAWN_MAX_DIST = 90;
const CHASER_GAP_FIRST = 14;
const CHASER_GAP_STEP = 8;
const PARK_STEP = 10;

// The off-map lot where the pooled cars sit invisible between events.
const PARK = { x: -900, z: -900 };

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
    this.pendingChasers = [];
    this.spawnTimer = 0;
    // The pool holds the three event cars, built once while loading and
    // parked out of sight. Assembling a car mid-game — attaching the
    // GLB, merging geometry, cloning materials, compiling shaders on
    // first draw — stalled the frame for up to a second on slow
    // machines, however the spawns were spread out. Building them up
    // front shifts every bit of that cost to the loading screen.
    this.pool = { getaway: null, chasers: [] };
    this.escape = null;
    this.eventTimer = 0;
    this.timer = TUNE.firstMin + rng() * (TUNE.firstMax - TUNE.firstMin);
    this.clock = 0;
    this.lastHitBy = null;
  }

  get active() {
    return this.getaway !== null;
  }

  get blip() {
    if (!this.getaway) return null;
    const p = this.getaway.car.position;
    return { x: p.x, z: p.z };
  }

  forceStart() {
    this.timer = 0;
  }

  _hideCar(car) {
    car.group.visible = false;
  }

  _showCar(car) {
    car.group.visible = true;
  }

  _moveCarTo(car, x, z) {
    car.group.position.set(x, 0, z);
  }

  _aimCar(car, heading) {
    car.heading = heading;
    car.group.rotation.y = heading;
  }

  _stashCar(car) {
    car.group.visible = false;
    car.group.position.set(PARK.x, 0, PARK.z);
  }

  prewarm() {
    // Assemble the event fleet now, while the loading screen is up, and
    // tuck it away far off the map. startEvent only has to move the
    // cars into place and switch them on.
    const getaway = createCar(this.scene, this.textures, 'GETAWAY', this.textures.carBlue, 0x14141a, PARK.x, PARK.z, 0);
    this._hideCar(getaway);
    this.pool.getaway = getaway;
    for (let i = 0; i < CHASER_COUNT; i += 1) {
      const unit = this.police.createPoliceCar(PARK.x, PARK.z - (i + 1) * PARK_STEP, 0, 'CHASE-' + (i + 1));
      this._hideCar(unit.car);
      this.pool.chasers.push(unit);
    }
  }

  _roadEnds() {
    const ends = [];
    for (const line of this.lines) {
      if (line.axis === 'x') {
        ends.push({ x: line.from, z: line.at });
        ends.push({ x: line.to, z: line.at });
      } else {
        ends.push({ x: line.at, z: line.from });
      }
    }
    return ends;
  }

  pickEscapePoint(fromX, fromZ) {
    let best = null;
    let bestDist = -1;
    for (const end of this._roadEnds()) {
      const d = Math.hypot(end.x - fromX, end.z - fromZ);
      if (d > bestDist) {
        bestDist = d;
        best = end;
      }
    }
    return best;
  }

  _pointOnLine(line, along) {
    return line.axis === 'z' ? { x: line.at, z: along } : { x: along, z: line.at };
  }

  _pickSpawn(playerPos) {
    let line = pick(this.rng, this.lines);
    let along = line.from + this.rng() * (line.to - line.from);
    for (let attempt = 0; attempt < SPAWN_TRIES; attempt += 1) {
      const candidate = pick(this.rng, this.lines);
      const candidateAlong = candidate.from + this.rng() * (candidate.to - candidate.from);
      const spot = this._pointOnLine(candidate, candidateAlong);
      const dist = Math.hypot(spot.x - playerPos.x, spot.z - playerPos.z);
      if (dist > SPAWN_MIN_DIST && dist < SPAWN_MAX_DIST) {
        line = candidate;
        along = candidateAlong;
        break;
      }
    }
    return { line, along };
  }

  _stageChasers(line, along, direction) {
    const staged = [];
    for (let i = 0; i < CHASER_COUNT; i += 1) {
      const behind = Math.max(line.from + 2, Math.min(line.to - 2, along - direction * (CHASER_GAP_FIRST + i * CHASER_GAP_STEP)));
      const spot = this._pointOnLine(line, behind);
      staged.push({
        unit: this.pool.chasers[i],
        x: spot.x,
        z: spot.z,
        heading: headingFor(line.axis, direction),
        line, direction, along: behind,
      });
    }
    return staged;
  }

  startEvent(playerPos) {
    const spawn = this._pickSpawn(playerPos);
    const direction = this.rng() < 0.5 ? -1 : 1;
    const spot = this._pointOnLine(spawn.line, spawn.along);
    const car = this.pool.getaway;
    this._showCar(car);
    this._moveCarTo(car, spot.x, spot.z);
    this._aimCar(car, headingFor(spawn.line.axis, direction));
    car.speed = TUNE.getawaySpeed;
    this.getaway = {
      car, speed: TUNE.getawaySpeed, health: TUNE.getawayHealth,
      line: spawn.line, direction, along: spawn.along,
      stopped: false, ramCooldown: 0, turnCooldown: 0,
    };
    this.police.placeOnRoad(this.getaway);
    this.escape = this.pickEscapePoint(spot.x, spot.z);
    this.eventTimer = TUNE.eventTimeout;
    this.lastHitBy = null;
    this.chasers = [];
    this.pendingChasers = this._stageChasers(spawn.line, spawn.along, direction);
    this.callbacks.onStart();
  }

  damage(amount, by) {
    const g = this.getaway;
    if (!g || g.stopped) return;
    g.health -= amount;
    this.lastHitBy = by;
    if (g.health > 0) return;
    g.stopped = true;
    g.speed = 0;
    this.finish(true);
  }

  shotByPlayer() {
    this.damage(TUNE.shotDamage, 'player');
  }

  ramByPlayer() {
    const g = this.getaway;
    if (!g || g.stopped || g.ramCooldown > 0) return false;
    g.ramCooldown = TUNE.ramCooldown;
    g.speed *= 0.4;
    this.damage(TUNE.ramDamage, 'player');
    return true;
  }

  finish(stopped) {
    const byPlayer = stopped && this.lastHitBy === 'player';
    const getaway = this.getaway;
    const chasers = this.chasers;
    this.getaway = null;
    this.chasers = [];
    this.pendingChasers = [];
    this.spawnTimer = 0;
    this.pool = { getaway: null, chasers: [] };
    this.escape = null;
    this.timer = TUNE.nextMin + this.rng() * (TUNE.nextMax - TUNE.nextMin);
    if (getaway) this._stashCar(getaway.car);
    for (const unit of chasers) this._stashCar(unit.car);
    if (stopped) this.callbacks.onStopped(byPlayer);
    else this.callbacks.onEscaped();
  }

  _decayCooldowns(unit, dt) {
    unit.turnCooldown = Math.max(0, unit.turnCooldown - dt);
    unit.ramCooldown = Math.max(0, unit.ramCooldown - dt);
  }

  _advanceOnRoad(unit, speed, dt) {
    unit.along += unit.direction * speed * dt;
    if (unit.along < unit.line.from || unit.along > unit.line.to) unit.direction *= -1;
    this.police.placeOnRoad(unit);
  }

  _spinWheels(car, speed, dt) {
    for (const wheel of car.wheels) wheel.wheel.rotation.x += (speed / TUNE.wheelRadius) * dt;
  }

  _flashLights(unit) {
    const on = Math.floor(this.clock * TUNE.blinkRate) % 2 === 0;
    unit.redMaterial.color.setHex(on ? 0xff2a3a : 0x551018);
    unit.blueMaterial.color.setHex(on ? 0x10204d : 0x2a6bff);
  }

  moveGetaway(dt) {
    const unit = this.getaway;
    if (unit.stopped) return;
    this._decayCooldowns(unit, dt);
    unit.speed = Math.min(TUNE.getawaySpeed, unit.speed + TUNE.getawayAccel * dt);
    this.police.maybeTurnAtIntersection(unit, this.escape);
    this._advanceOnRoad(unit, unit.speed, dt);
    this._spinWheels(unit.car, unit.speed, dt);
    const dx = unit.car.position.x - this.escape.x;
    const dz = unit.car.position.z - this.escape.z;
    if (Math.hypot(dx, dz) < TUNE.escapeRadius) this.finish(false);
  }

  moveChaser(dt, unit) {
    const target = this.getaway.car.position;
    const car = unit.car;
    const dist = Math.hypot(target.x - car.position.x, target.z - car.position.z);
    this._flashLights(unit);
    unit.turnCooldown = Math.max(0, unit.turnCooldown - dt);
    car.speed = Math.min(TUNE.chaserSpeed, car.speed + TUNE.chaserAccel * dt);
    if (dist < TUNE.followRange) car.speed = Math.min(car.speed, this.getaway.speed);
    this.police.maybeTurnAtIntersection(unit, target);
    this._advanceOnRoad(unit, car.speed, dt);
    if (unit.ramCooldown > 0) unit.ramCooldown -= dt;
    else if (dist < TUNE.ramRange) {
      unit.ramCooldown = TUNE.policeRamCooldown;
      this.damage(TUNE.policeRamDamage, 'police');
    }
    this._spinWheels(car, car.speed, dt);
  }

  _placeChaser(unit, spec) {
    unit.line = spec.line;
    unit.direction = spec.direction;
    unit.along = spec.along;
    unit.turnCooldown = 0;
    unit.ramCooldown = 0;
    unit.car.speed = TUNE.chaserSpeed;
    this._aimCar(unit.car, spec.heading);
    this._moveCarTo(unit.car, spec.x, spec.z);
    this._showCar(unit.car);
  }

  _deployPending(dt) {
    // One chaser every half second. The GLB attach (geometry merge,
    // material clone, first-draw shader compile) lands a frame after
    // the car appears, so bunching the deploys still piled every
    // attach into the same few frames and stalled the game.
    this.spawnTimer -= dt;
    if (this.pendingChasers.length === 0 || this.spawnTimer > 0) return;
    this.spawnTimer = TUNE.chaserStagger;
    const spec = this.pendingChasers.shift();
    this._placeChaser(spec.unit, spec);
    this.chasers.push(spec.unit);
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
    this._deployPending(dt);
    this.moveGetaway(dt);
    if (!this.getaway) return;
    for (const unit of this.chasers) this.moveChaser(dt, unit);
  }
}
