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
function poolTexture(rgb) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  gradient.addColorStop(0, `rgba(${rgb},0.85)`);
  gradient.addColorStop(0.55, `rgba(${rgb},0.35)`);
  gradient.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}
const poolMaterial = new THREE.MeshBasicMaterial({ map: poolTexture('255,242,204'), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
const tailPoolMaterial = new THREE.MeshBasicMaterial({ map: poolTexture('255,42,58'), transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
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
// Stall starts in the shallows (~0.8m): a car that pushes past the
// shoreline loses power fast instead of cruising on the sea surface.
export function waterCap(city, x, z, heading, speed, cap, maxReverse) {
  const depth = city.waterDepthAt(x, z);
  if (depth <= 0) return { speed, depth: 0, stalled: false };
  const out = city.shoreOutward(x, z);
  const vx = Math.sin(heading) * speed, vz = Math.cos(heading) * speed;
  let s = speed;
  if (out && vx * out.x + vz * out.z > 0) {
    const f = Math.max(0, 1 - depth / 0.8);
    s = speed > 0 ? Math.min(speed, cap * f) : Math.max(speed, -maxReverse * f);
  }
  return { speed: s, depth, stalled: depth > 0.8 && Math.abs(s) < 0.5 };
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
  // Sink with the depth: at ~1.4m the car is down to its roof. A car
  // stalled in deep water keeps sinking until it is fully under — sit
  // there and you will have to abandon it and swim for shore. Driving
  // back out resets the sink (stalled clears the moment it moves).
  let sink = Math.min(water.depth * 0.95, 1.3);
  if (water.stalled) {
    v.sinkTimer = (v.sinkTimer || 0) + dt;
    sink = Math.min(sink + v.sinkTimer * 0.2, 2.2);
  } else v.sinkTimer = 0;
  v.group.position.y = -sink;
  const grip = Math.min(1, Math.abs(v.speed) / 6) * (1 - Math.abs(v.speed) / v.maxSpeed / 2) * gripMul;
  // Steering is speed-sensitive: full lock at low speed, tapering off as
  // speed rises so the car doesn't spin at highway speed. Was a flat
  // 0.55 rad — at 30 m/s that turned the car ~390°/s, far too twitchy.
  const steerTarget = -strafe * 0.4 * grip * (handbrake ? 1.7 : 1);
  v.steerAngle += (steerTarget - v.steerAngle) * Math.min(1, dt * 6);
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
// GLB styles read their physics dims from GLB_MODELS instead; the entries
// here still size the box fallback if a GLB fails to load.
const STYLE_SPECS = {
  sedan: [1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, CAR_RADIUS, 0.38, 100, 1.15, 1.15],
  pickup: [1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, CAR_RADIUS, 0.38, 100, 1.08, 1.08],
  van: [1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, CAR_RADIUS, 0.38, 100, 0.95, 0.95],
  taxi: [1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, CAR_RADIUS, 0.38, 100, 1, 1],
  bus: [2.2, 1.3, 8.0, 0.9, 4.0, 1.1, 3.5, 2.2, 0.44, 150, 0.6, 0.73],
  truck: [1.9, 0.62, 4.2, 0.55, 2.6, 1.0, 3.0, 2.0, 0.42, 130, 0.7, 0.8],
  ambulance: [2.24, 0.62, 5.2, 0.55, 2.6, 1.12, 2.38, 2.0, 0.34, 130, 0.98, 0.98],
};
// GLB vehicles (Vinish, CC BY 4.0, decimated + quantized in
// assets/models/): file, wrapper scale, wheel nodes [name, steers],
// paint materials recoloured per vehicle, and physics dims measured off
// the model (length/width/wheelbase/wheel radius x scale). All models
// face +Z with tyres on y=0, like the old box cars. Liveried models
// (police, ambulance) keep their paint: paint list empty.
// Top-speed order (km/h = 38 x speedTune x 3.6): supercar 198 >
// police 189 > motorcycle 178 > sedan 157 > SUV/off-roader 148 >
// taxi 137 > ambulance 134 > van 130 > truck 109 > bus 100. Police
// outruns the motorcycle so a bike cannot outrun every chase.
const CAR_WHEELS = [['Wheel_FL', true], ['Wheel_FR', true], ['Wheel_RL', false], ['Wheel_RR', false]];
const GLB_MODELS = {
  sedan: { file: 'executive-sedan', scale: 0.85, wheels: CAR_WHEELS, paint: ['Paint_Blue'], halfLength: 2.13, halfWidth: 0.92, wheelbase: 2.53, wheelRadius: 0.29, radius: CAR_RADIUS, maxHp: 100, accelTune: 1.15, speedTune: 1.15 },
  supercar: { file: 'mid-engine-supercar', scale: 0.95, wheels: CAR_WHEELS, paint: ['Paint_Yellow'], halfLength: 2.11, halfWidth: 1.02, wheelbase: 2.51, wheelRadius: 0.31, radius: CAR_RADIUS, maxHp: 100, accelTune: 1.45, speedTune: 1.45 },
  police: { file: 'police-car', scale: 0.85, wheels: CAR_WHEELS, paint: [], halfLength: 2.13, halfWidth: 0.92, wheelbase: 2.53, wheelRadius: 0.29, radius: CAR_RADIUS, maxHp: 100, accelTune: 1.38, speedTune: 1.38 },
  ambulance: { file: 'ambulance', scale: 0.8, wheels: [['Wheel_1_Left', true], ['Wheel_1_Right', true], ['Wheel_2_Left', false], ['Wheel_2_Right', false]], paint: [], halfLength: 2.6, halfWidth: 1.12, wheelbase: 2.38, wheelRadius: 0.34, radius: 2.0, maxHp: 130, accelTune: 0.98, speedTune: 0.98 },
  offroader: { file: 'boxy-off-roader', scale: 0.9, wheels: CAR_WHEELS, paint: ['Paint_Sand'], halfLength: 2.15, halfWidth: 1.04, wheelbase: 2.57, wheelRadius: 0.37, radius: CAR_RADIUS, maxHp: 100, accelTune: 1.08, speedTune: 1.08 },
  suv: { file: 'luxury-suv', scale: 0.9, wheels: CAR_WHEELS, paint: ['Paint_Pearl'], halfLength: 2.24, halfWidth: 1.06, wheelbase: 2.67, wheelRadius: 0.35, radius: CAR_RADIUS, maxHp: 100, accelTune: 1.08, speedTune: 1.08 },
  bike: { file: 'sport-motorcycle', scale: 1.15, wheels: [['Wheel_Front', true], ['Wheel_Rear', false]], paint: ['Paint_Crimson'], halfLength: 1.1, halfWidth: 0.4, wheelbase: 1.36, wheelRadius: 0.36, radius: 0.9 },
};
function glbForCar(name, style) {
  if (name === 'POLICE') return GLB_MODELS.police;
  if (name === 'SOLSTICE GT') return GLB_MODELS.supercar;
  if (style === 'ambulance') return GLB_MODELS.ambulance;
  if (style === 'pickup') return GLB_MODELS.offroader;
  if (style === 'van') return GLB_MODELS.suv;
  if (style === 'sedan' || style === 'taxi') return GLB_MODELS.sedan;
  return null;
}
// The shared loader (models_loader.js) is imported lazily: a static
// import would break the whole game if the loader file is missing, while
// a failed dynamic import just falls back to box cars below.
let loaderModule = null;
function loadModelFile(name) {
  if (!loaderModule) {
    loaderModule = import('./models_loader.js').catch((err) => { loaderModule = null; throw err; });
  }
  return loaderModule.then(async (m) => {
    try {
      return await m.loadProp(name);
    } catch (err) {
      // Models the shared loader does not list yet (boxy-off-roader,
      // luxury-suv): same cache + GLTFLoader via loadGLB, cloned here
      // the way loadProp clones (plain clone: vehicles are not skinned).
      if (!/Unknown prop model/.test(String(err && err.message))) throw err;
      const gltf = await m.loadGLB(`assets/models/${name}.glb`);
      const group = gltf.scene.clone(true);
      group.traverse((o) => {
        if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map((x) => x.clone()) : o.material.clone();
      });
      return group;
    }
  });
}
// Reparent each wheel node into a steer pivot + spin group, preserving
// its world transform: the pivot steers (rotation.y), the spin group
// rolls (rotation.x) — the same {pivot, wheel, steers} shape driveUpdate
// and traffic.js already use. The spin group has identity orientation,
// so the right-hand wheels (Y-flipped in the GLB) roll the same way as
// the left ones. Returns null if a wheel node is missing.
const _inv = new THREE.Matrix4();
const _m4 = new THREE.Matrix4();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s3 = new THREE.Vector3();
function reparentPreserved(node, parent, pivotPos) {
  _m4.copy(_inv).multiply(node.matrixWorld);
  _m4.decompose(_v3, _q, _s3);
  pivotPos.copy(_v3);
  node.parent.remove(node);
  node.position.set(0, 0, 0);
  node.quaternion.copy(_q);
  node.scale.copy(_s3);
  parent.add(node);
}
function extractWheels(model, wheelNames) {
  model.updateMatrixWorld(true);
  _inv.copy(model.matrixWorld).invert();
  const wheels = [];
  for (const [name, steers] of wheelNames) {
    const node = model.getObjectByName(name);
    if (!node) return null;
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    pivot.add(spin);
    reparentPreserved(node, spin, pivot.position);
    model.add(pivot);
    wheels.push({ pivot, wheel: spin, steers });
  }
  return wheels;
}
// Bike front wheel: steer the whole fork around the steering head (the
// fork + wheel turn together, like a real bike) and spin the wheel on
// its axle inside the fork. The rear wheel uses the car path.
function extractBikeWheels(model) {
  model.updateMatrixWorld(true);
  _inv.copy(model.matrixWorld).invert();
  const fork = model.getObjectByName('Fork');
  const front = model.getObjectByName('Wheel_Front');
  const rear = model.getObjectByName('Wheel_Rear');
  if (!fork || !front || !rear) return null;
  const steerPivot = new THREE.Group();
  const spinFront = new THREE.Group();
  spinFront.position.copy(front.position);
  spinFront.quaternion.copy(front.quaternion);
  spinFront.scale.copy(front.scale);
  front.parent.remove(front);
  front.position.set(0, 0, 0);
  front.quaternion.identity();
  front.scale.set(1, 1, 1);
  spinFront.add(front);
  fork.add(spinFront);
  reparentPreserved(fork, steerPivot, steerPivot.position);
  model.add(steerPivot);
  const rearWheels = extractWheels(model, [['Wheel_Rear', false]]);
  if (!rearWheels) return null;
  return [{ pivot: steerPivot, wheel: spinFront, steers: true }, rearWheels[0]];
}
// loadProp clones materials per mesh, so one lamp material becomes many
// instances: unify each named material into ONE instance per vehicle, so
// main.js day/night lampMat/tailMat colour changes hit every lamp at
// once, and the paint recolour covers every painted panel.
function unifyMaterials(model, paintNames, paintHex) {
  const unified = new Map();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let changed = false;
    const next = mats.map((mat) => {
      if (!mat || !mat.name) return mat;
      let key = null;
      if (paintNames.includes(mat.name)) key = `paint:${mat.name}`;
      else if (mat.name === 'LED' || mat.name === 'Lamp_LED') key = 'head';
      else if (mat.name === 'LED_Red' || mat.name === 'Lamp_Red') key = 'tail';
      if (!key) return mat;
      if (!unified.has(key)) {
        const copy = mat.clone();
        if (key.startsWith('paint:')) copy.color.setHex(paintHex);
        unified.set(key, copy);
      }
      changed = true;
      return unified.get(key);
    });
    if (changed) o.material = Array.isArray(o.material) ? next : next[0];
  });
  return { lampMat: unified.get('head') || null, tailMat: unified.get('tail') || null };
}
// Shared trim materials: bumpers + mirrors + spoiler struts (dark),
// hubcaps (light alloy), all shared across every car built.
const trimDarkMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
const hubcapMat = new THREE.MeshLambertMaterial({ color: 0xc8c8d0 });
// Box-built car body: the original procedural car, kept for styles with
// no GLB (bus, truck) and as the fallback if a GLB fails to load. Builds
// into its own group so the cast-shadow pass never touches the additive
// headlight meshes that live on the vehicle group.
function buildBoxBody(name, bodyTexture, paintColour, style, spec) {
  const [bw, bh, bl, by, halfLength] = spec;
  const wheelRadius = spec[8];
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ map: bodyTexture });
  const paint = new THREE.MeshLambertMaterial({ color: paintColour });
  // Dark tinted glass (like window film): dark blue-grey at 0.8 opacity —
  // the driver stays faintly visible through it, which the carjacking
  // beat needs (driver gets out, runs and screams).
  const glass = new THREE.MeshLambertMaterial({ color: 0x1a2530, transparent: true, opacity: 0.8 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
  const light = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  if (style !== 'bus') {
    const body = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bl), bodyMat);
    body.position.y = by;
    g.add(body);
  }
  // Wedge silhouette (sedan/taxi/pickup): sloped hood + rear deck panels
  // over the flat body top, so the car reads sleek instead of a box.
  // Van/bus/truck keep their tall tops — the panels would clip them.
  const wedge = style === 'sedan' || style === 'taxi' || style === 'pickup';
  if (wedge) {
    const hood = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.9, 0.08, 0.95), paint);
    hood.position.set(0, 0.9, 1.5);
    hood.rotation.x = -0.1;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.9, 0.08, 0.7), paint);
    deck.position.set(0, 0.9, -1.68);
    deck.rotation.x = 0.1;
    g.add(hood, deck);
  }
  if (style === 'pickup') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.4), glass);
    cab.position.set(0, 1.1, 0.9);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 1.45), paint);
    cabRoof.position.set(0, 1.4, 0.9);
    const bedWall = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.35, 0.12), paint);
    bedWall.position.set(0, 0.95, -2.0);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 0.8), glass);
    windshield.position.set(0, 1.18, 1.62);
    windshield.rotation.x = -0.6;
    g.add(cab, cabRoof, bedWall, windshield);
  } else if (style === 'van') {
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.0, 3.6), paint);
    shell.position.set(0, 1.35, -0.2);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.1), glass);
    windshield.position.set(0, 1.35, 1.62);
    g.add(shell, windshield);
  } else if (style === 'bus') {
    // Rounded wedge: the side profile extruded with a bevel, so the bus
    // reads smooth like the GLB vehicles instead of a box. Wheel wells
    // are cut into the profile, the roof is a squashed half-cylinder,
    // and the glass sits proud of the flanks. The extrude runs along
    // the profile's x (length) and is rotated so length lies on +Z.
    // Two-tone Miami city bus: white body and roof, the paint colour
    // kept only as a stripe band below the windows — a solid teal box
    // read as a blue slab, the dark glass on white reads as a bus.
    const busWhite = new THREE.MeshLambertMaterial({ color: 0xf5f2ea });
    const profile = new THREE.Shape();
    profile.moveTo(-3.9, 0.35);
    profile.lineTo(-3.4, 0.35);
    profile.absarc(-2.8, 0.35, 0.6, Math.PI, 0, true);
    profile.lineTo(2.2, 0.35);
    profile.absarc(2.8, 0.35, 0.6, Math.PI, 0, true);
    profile.lineTo(3.6, 0.35);
    profile.quadraticCurveTo(4.05, 0.4, 4.05, 0.9);
    profile.lineTo(3.55, 2.05);
    profile.lineTo(-3.7, 2.05);
    profile.quadraticCurveTo(-4.05, 2.0, -4.05, 1.6);
    profile.lineTo(-3.9, 0.35);
    const busGeo = new THREE.ExtrudeGeometry(profile, { depth: 1.96, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 3, curveSegments: 12 });
    busGeo.translate(0, 0, -0.98);
    busGeo.rotateY(-Math.PI / 2);
    g.add(new THREE.Mesh(busGeo, busWhite));
    const roofGeo = new THREE.CylinderGeometry(1.08, 1.08, 7.3, 16, 1, false, 0, Math.PI);
    roofGeo.rotateZ(Math.PI / 2);
    roofGeo.rotateY(Math.PI / 2);
    const roof = new THREE.Mesh(roofGeo, busWhite);
    roof.scale.y = 0.35;
    roof.position.set(0, 2.02, -0.1);
    g.add(roof);
    // Stripe band in the paint colour, just below the window line.
    for (const side of [-1, 1]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.2, 6.6), paint);
      stripe.position.set(side * 1.1, 1.32, -0.1);
      g.add(stripe);
    }
    // Individual windows: five panes per side, the white body showing
    // between them as pillars — one long glass band looked like a slit.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 5; i += 1) {
        const pane = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.55, 1.14), glass);
        pane.position.set(side * 1.1, 1.68, -2.7 + i * 1.3);
        g.add(pane);
      }
    }
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.0, 0.04), glass);
    windshield.position.set(0, 1.5, 3.86);
    windshield.rotation.x = -0.41;
    g.add(windshield);
    // Destination sign: amber LED text on the dark board (canvas
    // texture, same technique as the clock face in city.js).
    const destTex = (() => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 64;
      const x = c.getContext('2d');
      x.fillStyle = '#1a1030';
      x.fillRect(0, 0, 256, 64);
      x.fillStyle = '#ffb703';
      x.font = 'bold 36px "Courier New", monospace';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(name === 'TRAFFIC' ? '12 DOWNTOWN' : name, 128, 34);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      return t;
    })();
    const destDark = new THREE.MeshBasicMaterial({ color: 0x1a1030 });
    const destFace = new THREE.MeshBasicMaterial({ map: destTex });
    const dest = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.3, 0.06), [destDark, destDark, destDark, destDark, destFace, destDark]);
    dest.position.set(0, 1.98, 3.63);
    dest.rotation.x = -0.41;
    g.add(dest);
    const archGeo = new THREE.TorusGeometry(0.55, 0.06, 8, 16, Math.PI);
    archGeo.rotateY(Math.PI / 2);
    for (const [ax, az] of [[-1.12, 2.8], [1.12, 2.8], [-1.12, -2.8], [1.12, -2.8]]) {
      const arch = new THREE.Mesh(archGeo, trimDarkMat);
      arch.position.set(ax, 0.44, az);
      g.add(arch);
    }
  } else if (style === 'truck') {
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.0, 1.5), paint);
    cab.position.set(0, 1.3, 1.5);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.1), glass);
    windshield.position.set(0, 1.45, 2.26);
    const cargo = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.9, 3.0), paint);
    cargo.position.set(0, 1.35, -0.9);
    g.add(cab, windshield, cargo);
  } else {
    // Narrower cabin (1.5 vs body 1.9) + sloped windshield and rear
    // window: the wedge profile that reads as a car, not a box.
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 2.1), glass);
    cabin.position.set(0, 1.1, -0.2);
    const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 2.15), paint);
    roofPanel.position.set(0, 1.4, -0.2);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 0.85), glass);
    windshield.position.set(0, 1.16, 1.02);
    windshield.rotation.x = -0.6;
    const rearWindow = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.06, 0.8), glass);
    rearWindow.position.set(0, 1.16, -1.42);
    rearWindow.rotation.x = 0.6;
    g.add(cabin, roofPanel, windshield, rearWindow);
  }
  if (style === 'taxi') {
    const { taxiSignMat, checkerMat } = taxiMaterials();
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), taxiSignMat);
    sign.position.set(0, 1.55, -0.2);
    const band = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.18, 4.24), checkerMat);
    band.position.set(0, 0.62, 0);
    g.add(sign, band);
  }
  // The bus bevel pushes the nose/tail out past the spec half-length,
  // so its lamps sit further forward to stay on the surface.
  const front = halfLength + 0.02 + (style === 'bus' ? 0.18 : 0);
  const lampY = style === 'bus' ? 0.9 : 0.62;
  for (const side of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), light);
    lamp.position.set(side * (style === 'bus' ? 1.3 : 1), lampY, front);
    g.add(lamp);
  }
  // Taillights: dim red lenses by day, glowing red at night (same fake-
  // light approach as the headlights — no real light per car).
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1010 });
  for (const side of [-0.65, 0.65]) {
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), tailMat);
    tail.position.set(side * (style === 'bus' ? 1.3 : 1), lampY, -front);
    g.add(tail);
  }
  // Bumpers front + rear (body half-length, not the spec halfLength —
  // the truck spec's halfLength runs past its body). The bus bumper
  // rides higher, on the rounded nose, not under the flat bottom edge.
  const bodyHalf = bl / 2;
  const bumperZ = style === 'bus' ? 4.22 : bodyHalf + 0.06;
  const bumperY = style === 'bus' ? 0.85 : 0.35;
  for (const bz of [bumperZ, -bumperZ]) {
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(bw * 0.96, 0.2, 0.14), trimDarkMat);
    bumper.position.set(0, bumperY, bz);
    g.add(bumper);
  }
  // Side mirrors on the cabin front (not the bus — its glass band is
  // the full width already).
  if (style !== 'bus') {
    for (const side of [-1, 1]) {
      const mirror = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.14, 0.22), trimDarkMat);
      mirror.position.set(side * (bw / 2 + 0.05), 1.15, 0.7);
      g.add(mirror);
    }
  }
  // Spoiler on sports cars (GT / SPORT / ROADSTER in the name): a wing
  // on two struts at the rear deck.
  if (/\bGT\b|SPORT|ROADSTER/.test(name)) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.35), trimDarkMat);
    wing.position.set(0, 1.02, -1.95);
    g.add(wing);
    for (const side of [-0.6, 0.6]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.08), trimDarkMat);
      strut.position.set(side, 0.92, -1.95);
      g.add(strut);
    }
  }
  const wheelGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, style === 'bus' ? 0.34 : 0.3, 10);
  wheelGeometry.rotateZ(Math.PI / 2);
  const hubcapGeometry = new THREE.CylinderGeometry(wheelRadius * 0.55, wheelRadius * 0.55, 0.06, 10);
  hubcapGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  const wz = style === 'bus' ? 2.8 : style === 'truck' ? 1.9 : 1.35;
  const wx = style === 'bus' ? 1.05 : 0.95;
  const wheelSpots = [[-wx, wz, true], [wx, wz, true], [-wx, -wz, false], [wx, -wz, false]];
  for (const [px, pz, steers] of wheelSpots) {
    const pivot = new THREE.Group();
    pivot.position.set(px, wheelRadius, pz);
    const wheel = new THREE.Mesh(wheelGeometry, tyre);
    pivot.add(wheel);
    // Alloy hubcap on the outer face (spins with the wheel — symmetric,
    // so the spin is invisible).
    const hubcap = new THREE.Mesh(hubcapGeometry, hubcapMat);
    hubcap.position.set(Math.sign(px) * 0.17, 0, 0);
    pivot.add(hubcap);
    g.add(pivot);
    wheels.push({ pivot, wheel, steers });
  }
  g.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { bodyGroup: g, wheels, lampMat: light, tailMat };
}
// Box-built bike: the original procedural bike, kept as the fallback if
// the sport-motorcycle GLB fails to load. Builds into its own group
// under the lean group.
function buildBoxBike(paintColour, withRider) {
  const g = new THREE.Group();
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
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1010 });
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.08, 0.05), tailMat);
  tail.position.set(0, 0.6, -0.95);
  g.add(frame, tank, seat, handlebar, fork, lamp, tail);
  const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.12, 10);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wz, steers] of [[0.7, true], [-0.7, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.34, wz);
    const wheel = new THREE.Mesh(wheelGeometry, dark);
    pivot.add(wheel);
    g.add(pivot);
    wheels.push({ pivot, wheel, steers });
  }
  let rider = null;
  if (withRider) rider = addBikeRider(g, 0.02, -0.25);
  g.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { bodyGroup: g, wheels, lampMat: light, tailMat, rider };
}
// Seated rider for traffic bikes: legs forward to the pegs, arms forward
// to the bars. y/z sit the rider on the seat of whichever bike body.
function addBikeRider(parent, y, z) {
  const rider = buildWalkerMesh(0x3da86b, 0x2a2a3a, 0xd9a077, 0x201510, 'cap', 1);
  rider.group.position.set(0, y, z);
  rider.group.rotation.x = 0.2;
  rider.legLeft.rotation.x = -1.0;
  rider.legRight.rotation.x = -1.0;
  rider.armLeft.rotation.x = -1.1;
  rider.armRight.rotation.x = -1.1;
  parent.add(rider.group);
  return rider.group;
}
// Taxi roof sign on the GLB sedan roof (no checker band: the flat band
// would clip the sculpted body; the sign alone reads as taxi).
function addTaxiSignGLB(group) {
  const { taxiSignMat } = taxiMaterials();
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.22, 0.3), taxiSignMat);
  sign.position.set(0, 1.42, -0.2);
  sign.castShadow = true;
  group.add(sign);
}
// Swap the GLB in for a car's placeholder once loaded; on any failure
// build the box car instead — the game never shows a missing vehicle.
// The wheels array is mutated in place: driveUpdate and traffic.js read
// it every frame, so the swap needs no other hookup.
// Merge a multi-material mesh's groups by material: one draw call per
// material instead of one per primitive. A sedan Body has 50 primitives
// across ~8 materials — merging saves ~40 calls per car, ~800 across
// the 20 cars on the road. Hidden materials (the tiny-primitive pass)
// are dropped entirely. Attributes are SHARED with the new meshes (not
// cloned): disposing the old geometry frees its GPU buffers and three
// re-uploads the shared attributes once for the merged meshes.
function mergeMeshByMaterial(mesh) {
  const geo = mesh.geometry;
  const mats = mesh.material;
  if (!Array.isArray(mats) || !geo.groups || geo.groups.length <= 1 || !geo.index) return null;
  const rangesByMat = new Map();
  for (const g of geo.groups) {
    const m = mats[g.materialIndex];
    if (!m || m.visible === false) continue;
    if (!rangesByMat.has(g.materialIndex)) rangesByMat.set(g.materialIndex, []);
    rangesByMat.get(g.materialIndex).push(g);
  }
  if (rangesByMat.size === 0) return [];
  let needsMerge = false;
  for (const groups of rangesByMat.values()) if (groups.length > 1) { needsMerge = true; break; }
  if (!needsMerge && rangesByMat.size === geo.groups.length) return null;
  const out = [];
  for (const [matIdx, groups] of rangesByMat) {
    const totalCount = groups.reduce((s, g) => s + g.count, 0);
    const newIndex = new geo.index.array.constructor(totalCount);
    let offset = 0;
    for (const g of groups) {
      newIndex.set(geo.index.array.subarray(g.start, g.start + g.count), offset);
      offset += g.count;
    }
    const sub = new THREE.BufferGeometry();
    for (const name in geo.attributes) sub.setAttribute(name, geo.attributes[name]);
    sub.setIndex(new THREE.BufferAttribute(newIndex, 1));
    const m = new THREE.Mesh(sub, mats[matIdx]);
    m.castShadow = mesh.castShadow;
    m.receiveShadow = mesh.receiveShadow;
    m.name = mesh.name;
    out.push(m);
  }
  return out;
}
function mergeCarPrimitives(model) {
  const toReplace = [];
  model.traverse((child) => {
    if (!child.isMesh) return;
    const merged = mergeMeshByMaterial(child);
    if (merged) toReplace.push([child, merged]);
  });
  for (const [old, news] of toReplace) {
    const parent = old.parent;
    if (!parent) continue;
    for (const n of news) {
      n.position.copy(old.position);
      n.rotation.copy(old.rotation);
      n.scale.copy(old.scale);
      parent.add(n);
    }
    parent.remove(old);
    old.geometry.dispose();
  }
}
function attachCarGLB(vehicle, spec, paintColour, buildBox) {
  loadModelFile(spec.file).then((model) => {
    let wheels = extractWheels(model, spec.wheels);
    if (!wheels) {
      // GLB loaded but no separable wheels: show it with static wheels
      // (dummy pivots the drive code can spin harmlessly) rather than
      // a box — a still wheel beats a wrong one.
      wheels = spec.wheels.map(([, steers]) => ({ pivot: new THREE.Group(), wheel: new THREE.Group(), steers }));
    }
    const { lampMat, tailMat } = unifyMaterials(model, spec.paint, paintColour);
    // Hide the tiniest Body primitives (badges, screws, trim slivers
    // under 50 triangles): each is a full draw call for a detail
    // invisible past a few metres. The sedan Body has 50 primitives
    // and 11 are under 50 tris — hiding them saves ~11 calls per car.
    // A material hides only when EVERY group using it is tiny, and the
    // headlight/taillight materials never hide.
    model.traverse((child) => {
      if (!child.isMesh || !Array.isArray(child.material)) return;
      const groups = child.geometry.groups;
      if (!groups || !groups.length) return;
      const matMaxTris = new Map();
      for (const g of groups) {
        matMaxTris.set(g.materialIndex, Math.max(matMaxTris.get(g.materialIndex) || 0, Math.floor(g.count / 3)));
      }
      for (const [matIdx, maxTris] of matMaxTris) {
        const m = child.material[matIdx];
        if (maxTris < 50 && m && m !== lampMat && m !== tailMat) m.visible = false;
      }
    });
    // Merge primitives by material (one draw call per material, not per
    // primitive): the sedan Body drops from ~39 visible calls to ~8.
    mergeCarPrimitives(model);
    const wrapper = new THREE.Group();
    wrapper.scale.setScalar(spec.scale);
    wrapper.add(model);
    model.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });
    const placeholder = vehicle.group.getObjectByName('glb-placeholder');
    if (placeholder) vehicle.group.remove(placeholder);
    vehicle.group.add(wrapper);
    vehicle.wheels.length = 0;
    vehicle.wheels.push(...wheels);
    if (lampMat) vehicle.lampMat = lampMat;
    if (tailMat) vehicle.tailMat = tailMat;
    if (vehicle.style === 'taxi') addTaxiSignGLB(vehicle.group);
  }).catch(() => {
    buildBox();
  });
}
function attachBikeGLB(vehicle, lean, paintColour, withRider, buildBox) {
  const spec = GLB_MODELS.bike;
  loadModelFile(spec.file).then((model) => {
    // Parked-pose side stand: hidden — the game holds bikes upright and
    // the stand would jut out sideways while riding.
    const stand = model.getObjectByName('Side_Stand');
    if (stand) stand.visible = false;
    let wheels = extractBikeWheels(model);
    if (!wheels) {
      wheels = spec.wheels.map(([, steers]) => ({ pivot: new THREE.Group(), wheel: new THREE.Group(), steers }));
    }
    const { lampMat, tailMat } = unifyMaterials(model, spec.paint, paintColour);
    mergeCarPrimitives(model);
    const wrapper = new THREE.Group();
    wrapper.scale.setScalar(spec.scale);
    wrapper.add(model);
    model.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });
    const placeholder = lean.getObjectByName('glb-placeholder');
    if (placeholder) lean.remove(placeholder);
    lean.add(wrapper);
    vehicle.wheels.length = 0;
    vehicle.wheels.push(...wheels);
    if (lampMat) vehicle.lampMat = lampMat;
    if (tailMat) vehicle.tailMat = tailMat;
    if (withRider) vehicle.rider = addBikeRider(lean, 0.22, -0.2);
  }).catch(() => {
    buildBox();
  });
}
export function createCar(scene, textures, name, bodyTexture, paintColour, x, z, heading, style = 'sedan') {
  const glb = glbForCar(name, style);
  const boxSpec = STYLE_SPECS[style] || STYLE_SPECS.sedan;
  const boxStyle = style === 'ambulance' ? 'van' : style;
  const dims = glb ? {
    halfLength: glb.halfLength, halfWidth: glb.halfWidth, wheelbase: glb.wheelbase,
    radius: glb.radius, wheelRadius: glb.wheelRadius, maxHp: glb.maxHp,
    accelTune: glb.accelTune, speedTune: glb.speedTune,
  } : {
    halfLength: boxSpec[4], halfWidth: boxSpec[5], wheelbase: boxSpec[6],
    radius: boxSpec[7], wheelRadius: boxSpec[8], maxHp: boxSpec[9],
    accelTune: boxSpec[10], speedTune: boxSpec[11],
  };
  // Taxi and van share the sedan/SUV GLBs but are slower vehicles: the
  // style tune overrides the shared GLB tune so the speed order
  // (sedan > SUV > taxi/van) holds whichever model loads.
  const styleTune = style === 'taxi' ? 1 : style === 'van' ? 0.95 : null;
  if (styleTune !== null) { dims.accelTune = styleTune; dims.speedTune = styleTune; }
  const group = new THREE.Group();
  const wheels = [];
  // Dummy lamp materials until the body attaches: main.js sets their
  // colour every frame, so the fields must exist from the first frame.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1010 });
  // Fake headlights (off until main.js turns them on at night for moving
  // cars). They never cast shadows — an additive beam must not darken.
  const headlightCone = new THREE.Mesh(beamGeometry, beamMaterial);
  headlightCone.position.set(0, 0.75, dims.halfLength + 3.5);
  headlightCone.scale.set(1, 0.4, 1);
  headlightCone.visible = false;
  const headlightPool = new THREE.Mesh(poolGeometry, poolMaterial);
  headlightPool.position.set(0, 0.06, dims.halfLength + 4.4);
  headlightPool.scale.set(2.4, 1, 5);
  headlightPool.visible = false;
  group.add(headlightCone, headlightPool);
  const tailGlow = new THREE.Mesh(poolGeometry, tailPoolMaterial);
  tailGlow.position.set(0, 0.06, -dims.halfLength - 4.4);
  tailGlow.scale.set(2.4, 1, 5);
  tailGlow.visible = false;
  group.add(tailGlow);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  const gt = name === 'SOLSTICE GT' ? 1.12 : 1;
  const vehicle = {
    group,
    name,
    style,
    heading,
    speed: 0,
    steerAngle: 0,
    driven: false,
    impact: 0,
    hp: dims.maxHp,
    maxHp: dims.maxHp,
    baseMaxHp: dims.maxHp,
    nitro: false,
    boosting: false,
    burning: false,
    burnTimer: 0,
    stalledInWater: false,
    sinkTimer: 0,
    maxSpeed: CAR_MAX_SPEED * dims.speedTune * gt,
    accel: CAR_ACCEL * dims.accelTune * gt,
    wheels,
    wheelbase: dims.wheelbase,
    radius: dims.radius,
    halfLength: dims.halfLength,
    halfWidth: dims.halfWidth,
    wheelRadius: dims.wheelRadius,
    lampMat,
    tailMat,
    tailGlow,
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
  const buildBox = () => {
    const placeholder = group.getObjectByName('glb-placeholder');
    if (placeholder) group.remove(placeholder);
    const built = buildBoxBody(name, bodyTexture, paintColour, boxStyle, boxSpec);
    group.add(built.bodyGroup);
    wheels.push(...built.wheels);
    vehicle.lampMat = built.lampMat;
    vehicle.tailMat = built.tailMat;
  };
  if (glb) {
    // Temporary invisible placeholder: the group exists at once with
    // its physics and lights, and the real GLB swaps in when loaded.
    const placeholder = new THREE.Group();
    placeholder.name = 'glb-placeholder';
    placeholder.visible = false;
    group.add(placeholder);
    attachCarGLB(vehicle, glb, paintColour, buildBox);
  } else {
    buildBox();
  }
  return vehicle;
}
// Motorcycles: a 2-wheel model with a seated rider (traffic bikes only —
// parked bikes have no rider), leaning into turns. Same drive model as
// cars, tighter wheelbase, quicker accel, narrower collision radius so a
// bike can thread alleys a car cannot.
export function createBike(scene, name, paintColour, x, z, heading, withRider = false) {
  const spec = GLB_MODELS.bike;
  const group = new THREE.Group();
  const lean = new THREE.Group();
  group.add(lean);
  const wheels = [];
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1010 });
  const headlightCone = new THREE.Mesh(beamGeometry, beamMaterial);
  headlightCone.position.set(0, 0.75, 4.6);
  headlightCone.scale.set(0.7, 0.3, 0.8);
  headlightCone.visible = false;
  const headlightPool = new THREE.Mesh(poolGeometry, poolMaterial);
  headlightPool.position.set(0, 0.06, 5.5);
  headlightPool.scale.set(1.8, 1, 4);
  headlightPool.visible = false;
  lean.add(headlightCone, headlightPool);
  const tailGlow = new THREE.Mesh(poolGeometry, tailPoolMaterial);
  tailGlow.position.set(0, 0.06, -5.5);
  tailGlow.scale.set(1.8, 1, 4);
  tailGlow.visible = false;
  lean.add(tailGlow);
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  const vehicle = {
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
    sinkTimer: 0,
    maxSpeed: CAR_MAX_SPEED * 1.3,
    accel: CAR_ACCEL * 1.3,
    wheels,
    wheelbase: spec.wheelbase,
    radius: spec.radius,
    halfLength: spec.halfLength,
    halfWidth: spec.halfWidth,
    wheelRadius: spec.wheelRadius,
    leanGroup: lean,
    rider: null,
    lampMat,
    tailMat,
    tailGlow,
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
  const buildBox = () => {
    const placeholder = lean.getObjectByName('glb-placeholder');
    if (placeholder) lean.remove(placeholder);
    const built = buildBoxBike(paintColour, withRider);
    lean.add(built.bodyGroup);
    wheels.push(...built.wheels);
    vehicle.lampMat = built.lampMat;
    vehicle.tailMat = built.tailMat;
    vehicle.rider = built.rider;
  };
  const placeholder = new THREE.Group();
  placeholder.name = 'glb-placeholder';
  placeholder.visible = false;
  lean.add(placeholder);
  attachBikeGLB(vehicle, lean, paintColour, withRider, buildBox);
  return vehicle;
}
// Police car with the GLB police livery. police.js needs no change to
// use it: createCar already routes name 'POLICE' to the police GLB, so
// its createPoliceCar gets the GLB through the normal path; this export
// exists for direct callers.
export function createPoliceCarGLB(scene, textures, x, z, heading) {
  return createCar(scene, textures, 'POLICE', textures.carWhite, 0xffffff, x, z, heading);
}
export function createCars(scene, textures) {
  const cars = [];
  const starter = createCar(scene, textures, 'SOLSTICE GT', textures.carRed, 0xff6b35, 4.5, -8, Math.PI);
  cars.push(starter);
  // Parked cars sit at the curb (4.5m off the road centre: the road is
  // 12m wide, a lane centre is 2.5m off, so a parked car clears moving
  // traffic) and parallel to the road — never mid-lane, never diagonal.
  const parkedSpots = [
    [-47.5, -40, Math.PI, 'sedan', 'PALM RUNNER', 0x007aff, 'carBlue'],
    [47.5, -78, 0, 'sedan', 'SUNSET COUPE', 0xffd60a, 'carTaxi'],
    [-99.5, 26, Math.PI, 'pickup', 'DEL SOL PICKUP', 0x2ad0c4, 'carBlue'],
    // CORAL CRUISER sits on the east-west road through (104, 0) instead
    // of the north-south one, so its long axis still runs along x.
    [130, 4.5, Math.PI / 2, 'sedan', 'CORAL CRUISER', 0xff2d78, 'carRed'],
    [4.5, -130, Math.PI, 'van', 'BLUFF VAN', 0xe63946, 'carRed'],
  ];
  for (const [x, z, heading, style, name, paint, textureKey] of parkedSpots) {
    cars.push(createCar(scene, textures, name, textures[textureKey], paint, x, z, heading, style));
  }
  // Ambulance outside the hospital entrance: (26,-26) is the middle of
  // the hospital building box, so it parks at the curb on the road west
  // of it, facing along the road like the other parked cars.
  cars.push(createCar(scene, textures, 'AMBULANCE', textures.carWhite, 0xffffff, 4.5, -26, Math.PI, 'ambulance'));
  return cars;
}
