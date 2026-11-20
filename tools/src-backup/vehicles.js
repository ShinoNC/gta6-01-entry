import * as THREE from 'three';
import { buildWalkerMesh } from './pedestrians.js';
const CAR_ACCEL = 16, CAR_BRAKE = 34, CAR_DRAG = 0.55, CAR_MAX_SPEED = 38, CAR_MAX_REVERSE = 11;
const CAR_RADIUS = 1.6, SKID_MIN_SPEED = 20, SKID_MIN_STEER = 0.25;
// Fake headlights for traffic/police cars at night: a translucent beam
// cone + a light pool on the road ahead. No real SpotLight per car — the
// forward renderer cost grows with the light count, and only the driven
// car gets a real one. Geometry/materials are shared across all cars.
const beamGeometry = new THREE.ConeGeometry(2.2, 7, 12, 1, true);
beamGeometry.rotateX(-Math.PI / 2);
const beamMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2cc, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
const poolGeometry = new THREE.CircleGeometry(1, 24);
poolGeometry.rotateX(-Math.PI / 2);
function poolTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,242,204,0.85)');
  gradient.addColorStop(0.55, 'rgba(255,242,204,0.35)');
  gradient.addColorStop(1, 'rgba(255,242,204,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
const poolMaterial = new THREE.MeshBasicMaterial({ map: poolTexture(), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
// Taxi roof sign (MeshBasicMaterial: it glows at night) + the checker band.
let taxiSignMat = null, checkerMat = null;
function taxiMaterials() {
  if (taxiSignMat) return { taxiSignMat, checkerMat };
  const sign = document.createElement('canvas');
  sign.width = 128;
  sign.height = 32;
  const sctx = sign.getContext('2d');
  sctx.fillStyle = '#f2f2f2';
  sctx.fillRect(0, 0, 128, 32);
  sctx.fillStyle = '#1a1030';
  sctx.font = 'bold 24px "Courier New", monospace';
  sctx.textAlign = 'center';
  sctx.textBaseline = 'middle';
  sctx.fillText('TAXI', 64, 17);
  taxiSignMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sign) });
  const checker = document.createElement('canvas');
  checker.width = 64;
  checker.height = 16;
  const cctx = checker.getContext('2d');
  for (let i = 0; i < 8; i += 1) {
    cctx.fillStyle = i % 2 === 0 ? '#1a1030' : '#f2f2f2';
    cctx.fillRect(i * 8, 0, 8, 8);
    cctx.fillStyle = i % 2 === 0 ? '#f2f2f2' : '#1a1030';
    cctx.fillRect(i * 8, 8, 8, 8);
  }
  const checkerTex = new THREE.CanvasTexture(checker);
  checkerTex.wrapS = THREE.RepeatWrapping;
  checkerTex.repeat.x = 6;
  checkerMat = new THREE.MeshLambertMaterial({ map: checkerTex });
  return { taxiSignMat, checkerMat };
}
// Water depth limit, shared by the driven car (driveUpdate) and the
// police pursuit (police.js moves its cars directly): the deeper the
// water, the less traction — in deep water the engine gives out entirely.
// Shoreward motion is never capped, so a stalled car can always reverse
// back out. Returns the capped speed, the depth and the stalled flag.
export function waterCap(city, x, z, heading, speed, cap, maxReverse) {
  const depth = city.waterDepthAt(x, z);
  if (depth <= 0) return { speed, depth: 0, stalled: false };
  const out = city.shoreOutward(x, z);
  const vx = Math.sin(heading) * speed, vz = Math.cos(heading) * speed;
  let s = speed;
  if (out && vx * out.x + vz * out.z > 0) {
    const f = Math.max(0, 1 - depth / 1.4);
    s = speed > 0 ? Math.min(speed, cap * f) : Math.max(speed, -maxReverse * f);
  }
  return { speed: s, depth, stalled: depth > 1.2 && Math.abs(s) < 0.5 };
}
const skiddingOf = (v) => Math.abs(v.speed) > (v.handbraking ? 12 : SKID_MIN_SPEED) && Math.abs(v.steerAngle) > SKID_MIN_STEER * (v.gripMul || 1);
// One drive model for cars and bikes: arcade accel/brake/drag, grip-scaled
// steering, bicycle-model yaw (wheelbase per vehicle), building collision,
// and the water depth limit (the sea is the boundary — no invisible wall).
function driveUpdate(v, dt, input, city, gripMul = 1) {
  v.gripMul = gripMul;
  const { forward, strafe } = input.moveAxes();
  const handbrake = input.isDown('Space');
  v.handbraking = handbrake;
  v.boosting = Boolean(v.nitro) && input.isDown('ShiftLeft');
  const cap = v.boosting ? v.maxSpeed * 1.4 : v.maxSpeed;
  if (forward > 0) v.speed += v.accel * (v.boosting ? 1.6 : 1) * dt;
  else if (forward < 0) {
    v.speed = v.speed > 0.5 ? v.speed - CAR_BRAKE * dt : v.speed - v.accel * 0.6 * dt;
  } else {
    v.speed -= v.speed * CAR_DRAG * dt;
    if (Math.abs(v.speed) < 0.05) v.speed = 0;
  }
  if (handbrake) v.speed -= v.speed * dt;
  v.speed = Math.max(-CAR_MAX_REVERSE, Math.min(cap, v.speed));
  const water = waterCap(city, v.group.position.x, v.group.position.z, v.heading, v.speed, cap, CAR_MAX_REVERSE);
  v.speed = water.speed;
  v.stalledInWater = water.stalled;
  v.group.position.y = -Math.min(water.depth * 0.5, 0.6);
  const grip = Math.min(1, Math.abs(v.speed) / 6) * (1 - Math.abs(v.speed) / v.maxSpeed / 2) * gripMul;
  const steerTarget = -strafe * 0.55 * grip * (handbrake ? 1.7 : 1);
  v.steerAngle += (steerTarget - v.steerAngle) * Math.min(1, dt * 8);
  v.heading += (v.speed / v.wheelbase) * Math.tan(v.steerAngle) * dt * (v.speed < 0 ? -1 : 1);
  const nextX = v.group.position.x + Math.sin(v.heading) * v.speed * dt;
  const nextZ = v.group.position.z + Math.cos(v.heading) * v.speed * dt;
  v.group.position.x = nextX;
  v.group.position.z = nextZ;
  const beforeX = v.group.position.x;
  const beforeZ = v.group.position.z;
  city.resolveCircle(v.group.position, v.radius);
  if (v.group.position.x !== beforeX || v.group.position.z !== beforeZ) {
    v.impact = Math.min(1, Math.abs(v.speed) / v.maxSpeed + 0.3);
    if (v.hp > 0 && v.name !== 'SUNSET COUPE' && Math.abs(v.speed) > 12) v.hp = Math.max(0, v.hp - Math.abs(v.speed) * 0.6);
    if (v.hp <= 0 && !v.burning) { v.burning = true; v.burnTimer = 3; }
    v.speed *= 0.25;
  }
  v.impact = Math.max(0, v.impact - dt * 2);
  v.group.rotation.y = v.heading;
  for (const { pivot, wheel, steers } of v.wheels) {
    wheel.rotation.x += (v.speed / v.wheelRadius) * dt;
    pivot.rotation.y = steers ? v.steerAngle : 0;
  }
}
// Per-style body: [width, height, length, y, halfLength, halfWidth, wheelbase, radius, wheelRadius, maxHp, accelTune, speedTune]
const STYLE_SPECS = {
  sedan: [1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, CAR_RADIUS, 0.36, 100, 1, 1],
  pickup: [1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, CAR_RADIUS, 0.36, 100, 0.9, 0.9],
  van: [1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, CAR_RADIUS, 0.36, 100, 0.78, 0.78],
  taxi: [1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, CAR_RADIUS, 0.36, 100, 1, 1],
  bus: [2.2, 1.3, 8.0, 0.9, 4.0, 1.1, 3.5, 2.2, 0.42, 150, 0.6, 0.75],
  truck: [1.9, 0.62, 4.2, 0.55, 2.6, 1.0, 3.0, 2.0, 0.4, 130, 0.7, 0.8],
};
export function createCar(scene, textures, name, bodyTexture, paintColour, x, z, heading, style = 'sedan') {
  const spec = STYLE_SPECS[style] || STYLE_SPECS.sedan;
  const [bw, bh, bl, by, halfLength, halfWidth, wheelbase, radius, wheelRadius, maxHp, accelTune, speedTune] = spec;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ map: bodyTexture });
  const paint = new THREE.MeshLambertMaterial({ color: paintColour });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fd4e8 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
  const light = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bl), bodyMat);
  body.position.y = by;
  group.add(body);
  if (style === 'pickup') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 1.4), glass);
    cab.position.set(0, 1.1, 0.9);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 1.45), paint);
    cabRoof.position.set(0, 1.4, 0.9);
    const bedWall = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.35, 0.12), paint);
    bedWall.position.set(0, 0.95, -2.0);
    group.add(cab, cabRoof, bedWall);
  } else if (style === 'van') {
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.0, 3.6), paint);
    shell.position.set(0, 1.35, -0.2);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.1), glass);
    windshield.position.set(0, 1.35, 1.62);
    group.add(shell, windshield);
  } else if (style === 'bus') {
    const glassBand = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.7, 7.4), glass);
    glassBand.position.set(0, 1.85, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.1, 8.05), paint);
    roof.position.set(0, 2.25, 0);
    const dest = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.06), new THREE.MeshBasicMaterial({ color: 0x1a1030 }));
    dest.position.set(0, 1.95, 4.02);
    group.add(glassBand, roof, dest);
  } else if (style === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.0, 1.5), paint);
    cab.position.set(0, 1.3, 1.5);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.1), glass);
    windshield.position.set(0, 1.45, 2.26);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.9, 3.0), new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }));
    cargo.position.set(0, 1.35, -0.9);
    group.add(cab, windshield, cargo);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.1), glass);
    cabin.position.set(0, 1.1, -0.2);
    const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 2.15), paint);
    roofPanel.position.set(0, 1.4, -0.2);
    group.add(cabin, roofPanel);
  }
  if (style === 'taxi') {
    const { taxiSignMat, checkerMat } = taxiMaterials();
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), taxiSignMat);
    sign.position.set(0, 1.55, -0.2);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.18, 4.24), checkerMat);
    band.position.set(0, 0.62, 0);
    group.add(sign, band);
  }
  const front = halfLength + 0.02;
  const lampY = style === 'bus' ? 0.9 : 0.62;
  for (const side of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), light);
    lamp.position.set(side * (style === 'bus' ? 1.3 : 1), lampY, front);
    group.add(lamp);
  }
  const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, style === 'bus' ? 0.34 : 0.3, 10);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  const wz = style === 'bus' ? 2.8 : style === 'truck' ? 1.9 : 1.35;
  const wx = style === 'bus' ? 1.05 : 0.95;
  const wheelSpots = [[-wx, wz, true], [wx, wz, true], [-wx, -wz, false], [wx, -wz, false]];
  for (const [px, pz, steers] of wheelSpots) {
    const pivot = new THREE.Group();
    pivot.position.set(px, wheelRadius, pz);
    const wheel = new THREE.Mesh(wheelGeometry, tyre);
    pivot.add(wheel);
    group.add(pivot);
    wheels.push({ pivot, wheel, steers });
  }
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  // Fake headlights (off until main.js turns them on at night for moving
  // cars). They never cast shadows — an additive beam must not darken.
  const headlightCone = new THREE.Mesh(beamGeometry, beamMaterial);
  headlightCone.position.set(0, 0.75, halfLength + 3.5);
  headlightCone.scale.set(1, 0.4, 1);
  headlightCone.visible = false;
  const headlightPool = new THREE.Mesh(poolGeometry, poolMaterial);
  headlightPool.position.set(0, 0.06, halfLength + 4.4);
  headlightPool.scale.set(2.4, 1, 5);
  headlightPool.visible = false;
  group.add(headlightCone, headlightPool);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  const gt = name === 'SOLSTICE GT' ? 1.12 : 1;
  return {
    group,
    name,
    style,
    heading,
    speed: 0,
    steerAngle: 0,
    driven: false,
    impact: 0,
    hp: maxHp,
    maxHp,
    baseMaxHp: maxHp,
    nitro: false,
    boosting: false,
    burning: false,
    burnTimer: 0,
    stalledInWater: false,
    maxSpeed: CAR_MAX_SPEED * speedTune * gt,
    accel: CAR_ACCEL * accelTune * gt,
    wheels,
    wheelbase,
    radius,
    halfLength,
    halfWidth,
    wheelRadius,
    lampMat: light,
    headlightCone,
    headlightPool,
    get position() {
      return group.position;
    },
    get skidding() {
      return skiddingOf(this);
    },
    update(dt, input, city, gripMul = 1) {
      driveUpdate(this, dt, input, city, gripMul);
    },
  };
}
// Motorcycles: a 2-wheel model with a seated rider (traffic bikes only —
// parked bikes have no rider), leaning into turns. Same drive model as
// cars, tighter wheelbase, quicker accel, narrower collision radius so a
// bike can thread alleys a car cannot.
export function createBike(scene, name, paintColour, x, z, heading, withRider = false) {
  const group = new THREE.Group();
  const lean = new THREE.Group();
  group.add(lean);
  const paint = new THREE.MeshLambertMaterial({ color: paintColour });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
  const chrome = new THREE.MeshLambertMaterial({ color: 0xc8c8d0 });
  const light = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.25, 1.7), dark);
  frame.position.y = 0.55;
  const tank = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.28, 0.55), paint);
  tank.position.set(0, 0.72, 0.25);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.6), dark);
  seat.position.set(0, 0.68, -0.3);
  const handlebar = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.05, 0.05), chrome);
  handlebar.position.set(0, 0.85, 0.75);
  const fork = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.55, 0.08), chrome);
  fork.position.set(0, 0.55, 0.72);
  fork.rotation.x = 0.3;
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.12, 0.05), light);
  lamp.position.set(0, 0.7, 0.95);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.05), new THREE.MeshBasicMaterial({ color: 0xff2a3a }));
  tail.position.set(0, 0.6, -0.95);
  lean.add(frame, tank, seat, handlebar, fork, lamp, tail);
  const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.12, 10);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wz, steers] of [[0.7, true], [-0.7, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.34, wz);
    const wheel = new THREE.Mesh(wheelGeometry, dark);
    pivot.add(wheel);
    lean.add(pivot);
    wheels.push({ pivot, wheel, steers });
  }
  let rider = null;
  if (withRider) {
    rider = buildWalkerMesh(0x3da86b, 0x2a2a3a, 0xd9a077, 0x201510, 'cap', 1);
    rider.group.position.set(0, 0.02, -0.25);
    rider.group.rotation.x = 0.2;
    rider.legLeft.rotation.x = -1.0;
    rider.legRight.rotation.x = -1.0;
    rider.armLeft.rotation.x = -1.1;
    rider.armRight.rotation.x = -1.1;
    lean.add(rider.group);
  }
  lean.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  const headlightCone = new THREE.Mesh(beamGeometry, beamMaterial);
  headlightCone.position.set(0, 0.75, 4.6);
  headlightCone.scale.set(0.7, 0.3, 0.8);
  headlightCone.visible = false;
  const headlightPool = new THREE.Mesh(poolGeometry, poolMaterial);
  headlightPool.position.set(0, 0.06, 5.5);
  headlightPool.scale.set(1.8, 1, 4);
  headlightPool.visible = false;
  lean.add(headlightCone, headlightPool);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  return {
    group,
    name,
    style: 'bike',
    heading,
    speed: 0,
    steerAngle: 0,
    driven: false,
    impact: 0,
    hp: 100,
    maxHp: 100,
    baseMaxHp: 100,
    nitro: false,
    boosting: false,
    burning: false,
    burnTimer: 0,
    stalledInWater: false,
    maxSpeed: CAR_MAX_SPEED * 1.1,
    accel: CAR_ACCEL * 1.3,
    wheels,
    wheelbase: 1.4,
    radius: 0.9,
    halfLength: 1.1,
    halfWidth: 0.4,
    wheelRadius: 0.34,
    leanGroup: lean,
    rider: rider ? rider.group : null,
    lampMat: light,
    headlightCone,
    headlightPool,
    get position() {
      return group.position;
    },
    get skidding() {
      return skiddingOf(this);
    },
    update(dt, input, city, gripMul = 1) {
      driveUpdate(this, dt, input, city, gripMul);
      // Lean INTO the turn: a positive rotation.z tilts the top toward
      // -x (the bike's right), so the lean is the negative of the steer.
      lean.rotation.z = -this.steerAngle * 0.8;
    },
  };
}
export function createCars(scene, textures) {
  const cars = [];
  const starter = createCar(scene, textures, 'SOLSTICE GT', textures.carRed, 0xd6303e, 0, -8, Math.PI);
  cars.push(starter);
  const parkedSpots = [
    [-52, -40, 0, 'sedan', 'PALM RUNNER', 0x346edc, 'carBlue'],
    [52, -104, Math.PI, 'sedan', 'SUNSET COUPE', 0xe8a33d, 'carRed'],
    [-104, 26, Math.PI / 2, 'pickup', 'DEL SOL PICKUP', 0x3da86b, 'carBlue'],
    [104, 0, -Math.PI / 2, 'sedan', 'CORAL CRUISER', 0x9a5fd0, 'carRed'],
    [0, -156, 0, 'van', 'BLUFF VAN', 0xe8e8e8, 'carBlue'],
    [-156, -78, Math.PI, 'sedan', 'MARINA ROADSTER', 0xd6303e, 'carRed'],
    [-260, 0, 0, 'bus', 'KEYS LINER', 0x2ad0c4, 'carBlue'],
    [0, 208, Math.PI / 2, 'truck', 'CORAL HAULER', 0xe8e8e8, 'carBlue'],
  ];
  for (const [x, z, heading, style, name, paint, textureKey] of parkedSpots) {
    cars.push(createCar(scene, textures, name, textures[textureKey], paint, x, z, heading, style));
  }
  cars.push(createBike(scene, 'VICE SPORT', 0xd6303e, 52, 104, 0));
  cars.push(createBike(scene, 'GULL SCOOTER', 0x2ad0c4, -104, 52, Math.PI / 2));
  return cars;
}
