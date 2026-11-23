// Vehicles: procedural + GLB cars and bikes, one shared arcade drive
// model, and the fake night headlights. Everything in here is written
// to be swapped: a GLB loads in place of a box body, and a failed load
// falls back to the box without the game ever noticing.
import * as THREE from 'three';
import { buildWalkerMesh } from './pedestrians.js';

// Drive-model tuning. Speeds are metres per second; headings are
// radians, with forward = (sin h, cos h).
const ACCEL_BASE = 16;
const BRAKE_FORCE = 34;
const DRAG_COEF = 0.55;
const TOP_SPEED = 38;
const REVERSE_TOP = 11;
const BODY_RADIUS = 1.6;
const SKID_SPEED = 20;
const SKID_STEER = 0.25;

// Scratch math objects for the wheel reparenting below, allocated once
// so GLB setup never allocates per vehicle.
const scratchInv = new THREE.Matrix4();
const scratchMat = new THREE.Matrix4();
const scratchPos = new THREE.Vector3();
const scratchQuat = new THREE.Quaternion();
const scratchScale = new THREE.Vector3();

// Night headlights are faked: an additive cone plus a pool of light on
// the road ahead. Real SpotLights would cost one light per car in the
// forward renderer, so only the driven car gets one; every other car
// shares this geometry and these materials.
const beamGeo = new THREE.ConeGeometry(2.2, 7, 12, 1, true);
beamGeo.rotateX(-Math.PI / 2);
const beamMat = new THREE.MeshBasicMaterial({
  color: 0xfff2cc,
  transparent: true,
  opacity: 0.09,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
  fog: false,
});
const poolGeo = new THREE.CircleGeometry(1, 24);
poolGeo.rotateX(-Math.PI / 2);

function radialGlowTexture(rgb) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grad.addColorStop(0, 'rgba(' + rgb + ',0.85)');
  grad.addColorStop(0.55, 'rgba(' + rgb + ',0.35)');
  grad.addColorStop(1, 'rgba(' + rgb + ',0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

function glowPoolMaterial(rgb) {
  return new THREE.MeshBasicMaterial({
    map: radialGlowTexture(rgb),
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: false,
  });
}
const headPoolMat = glowPoolMaterial('255,242,204');
const tailPoolMat = glowPoolMaterial('255,42,58');

// Taxi roof sign + checker band, drawn once on canvas and shared.
// The sign is MeshBasicMaterial so it glows at night.
let cachedTaxiMats = null;
function getTaxiMaterials() {
  if (cachedTaxiMats) return cachedTaxiMats;
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 128;
  signCanvas.height = 32;
  const sg = signCanvas.getContext('2d');
  sg.fillStyle = '#f2f2f2';
  sg.fillRect(0, 0, 128, 32);
  sg.fillStyle = '#1a1030';
  sg.font = 'bold 24px "Courier New", monospace';
  sg.textAlign = 'center';
  sg.textBaseline = 'middle';
  sg.fillText('TAXI', 64, 17);
  const signMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(signCanvas) });
  const bandCanvas = document.createElement('canvas');
  bandCanvas.width = 64;
  bandCanvas.height = 16;
  const bg = bandCanvas.getContext('2d');
  let col = 0;
  while (col < 8) {
    const darkTop = col % 2 === 0;
    bg.fillStyle = darkTop ? '#1a1030' : '#f2f2f2';
    bg.fillRect(col * 8, 0, 8, 8);
    bg.fillStyle = darkTop ? '#f2f2f2' : '#1a1030';
    bg.fillRect(col * 8, 8, 8, 8);
    col += 1;
  }
  const bandTex = new THREE.CanvasTexture(bandCanvas);
  bandTex.wrapS = THREE.RepeatWrapping;
  bandTex.repeat.x = 6;
  cachedTaxiMats = { sign: signMat, band: new THREE.MeshLambertMaterial({ map: bandTex }) };
  return cachedTaxiMats;
}

// Box-car numbers per style. Rows read:
// [style, width, height, length, bodyY, halfLength, halfWidth,
//  wheelbase, radius, wheelRadius, maxHp, accelTune, speedTune]
// The GLB styles still need these rows: they size the box fallback
// when a model fails to load.
const BOX_SPEC_ROWS = [
  ['sedan', 1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, BODY_RADIUS, 0.38, 100, 1.15, 1.15],
  ['pickup', 1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, BODY_RADIUS, 0.38, 100, 1.08, 1.08],
  ['van', 1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, BODY_RADIUS, 0.38, 100, 0.95, 0.95],
  ['taxi', 1.9, 0.62, 4.2, 0.55, 2.1, 0.95, 2.6, BODY_RADIUS, 0.38, 100, 1, 1],
  ['bus', 2.2, 1.3, 8.0, 0.9, 4.0, 1.1, 3.5, 2.2, 0.44, 150, 0.6, 0.73],
  ['truck', 1.9, 0.62, 4.2, 0.55, 2.6, 1.0, 3.0, 2.0, 0.42, 130, 0.7, 0.8],
  ['ambulance', 2.24, 0.62, 5.2, 0.55, 2.6, 1.12, 2.38, 2.0, 0.34, 130, 0.98, 0.98],
];
const SPEC_KEYS = ['width', 'height', 'length', 'bodyY', 'halfLength', 'halfWidth', 'wheelbase', 'radius', 'wheelRadius', 'maxHp', 'accelTune', 'speedTune'];
const BOX_SPECS = new Map();
for (const row of BOX_SPEC_ROWS) {
  const spec = {};
  let i = 0;
  while (i < SPEC_KEYS.length) {
    spec[SPEC_KEYS[i]] = row[i + 1];
    i += 1;
  }
  BOX_SPECS.set(row[0], spec);
}
function boxSpecFor(style) {
  const found = BOX_SPECS.get(style);
  return found === undefined ? BOX_SPECS.get('sedan') : found;
}

// GLB vehicles (Vinish, CC BY 4.0, decimated + quantized in
// assets/models/). Rows read:
// [key, file, scale, wheelNodes, paintNames,
//  halfLength, halfWidth, wheelbase, wheelRadius, radius,
//  maxHp, accelTune, speedTune]
// wheelNodes entries are [nodeName, steers]. All models face +Z with
// tyres on y=0, like the old box cars. Liveried models (police,
// ambulance) keep their paint, so their paint list is empty.
// Top-speed order (km/h = 38 x speedTune x 3.6): supercar 198 >
// police 189 > motorcycle 178 > sedan 157 > SUV/off-roader 148 >
// taxi 137 > ambulance 134 > van 130 > truck 109 > bus 100. Police
// outruns the motorcycle so a bike cannot outrun every chase.
const STD_WHEELS = [['Wheel_FL', true], ['Wheel_FR', true], ['Wheel_RL', false], ['Wheel_RR', false]];
const GLB_ROWS = [
  ['sedan', 'executive-sedan', 0.85, STD_WHEELS, ['Paint_Blue'], 2.13, 0.92, 2.53, 0.29, BODY_RADIUS, 100, 1.15, 1.15],
  ['supercar', 'mid-engine-supercar', 0.95, STD_WHEELS, ['Paint_Yellow'], 2.11, 1.02, 2.51, 0.31, BODY_RADIUS, 100, 1.45, 1.45],
  ['police', 'police-car', 0.85, STD_WHEELS, [], 2.13, 0.92, 2.53, 0.29, BODY_RADIUS, 100, 1.38, 1.38],
  ['ambulance', 'ambulance', 0.8, [['Wheel_1_Left', true], ['Wheel_1_Right', true], ['Wheel_2_Left', false], ['Wheel_2_Right', false]], [], 2.6, 1.12, 2.38, 0.34, 2.0, 130, 0.98, 0.98],
  ['offroader', 'boxy-off-roader', 0.9, STD_WHEELS, ['Paint_Sand'], 2.15, 1.04, 2.57, 0.37, BODY_RADIUS, 100, 1.08, 1.08],
  ['suv', 'luxury-suv', 0.9, STD_WHEELS, ['Paint_Pearl'], 2.24, 1.06, 2.67, 0.35, BODY_RADIUS, 100, 1.08, 1.08],
  ['bike', 'sport-motorcycle', 1.15, [['Wheel_Front', true], ['Wheel_Rear', false]], ['Paint_Crimson'], 1.1, 0.4, 1.36, 0.36, 0.9, null, null, null],
];
const GLB_KEYS = ['file', 'scale', 'wheels', 'paint', 'halfLength', 'halfWidth', 'wheelbase', 'wheelRadius', 'radius', 'maxHp', 'accelTune', 'speedTune'];
const GLB_MODELS = new Map();
for (const row of GLB_ROWS) {
  const entry = {};
  let i = 0;
  while (i < GLB_KEYS.length) {
    entry[GLB_KEYS[i]] = row[i + 1];
    i += 1;
  }
  GLB_MODELS.set(row[0], entry);
}

// Which GLB a car gets: special names first, then the style table.
const GLB_BY_NAME = new Map([['POLICE', 'police'], ['SOLSTICE GT', 'supercar']]);
const GLB_BY_STYLE = new Map([['ambulance', 'ambulance'], ['pickup', 'offroader'], ['van', 'suv'], ['sedan', 'sedan'], ['taxi', 'sedan']]);
function glbModelFor(name, style) {
  const named = GLB_BY_NAME.get(name);
  if (named !== undefined) return GLB_MODELS.get(named);
  const styled = GLB_BY_STYLE.get(style);
  return styled === undefined ? null : GLB_MODELS.get(styled);
}

// Physics dims shared by the GLB and box paths: both spec shapes carry
// the same named fields, so one picker serves both.
function pickDims(src) {
  return {
    halfLength: src.halfLength,
    halfWidth: src.halfWidth,
    wheelbase: src.wheelbase,
    radius: src.radius,
    wheelRadius: src.wheelRadius,
    maxHp: src.maxHp,
    accelTune: src.accelTune,
    speedTune: src.speedTune,
  };
}

// Water depth limit, shared by the driven car (driveUpdate) and the
// police pursuit (police.js moves its cars directly): the deeper the
// water, the less traction — in deep water the engine gives out
// entirely. Shoreward motion is never capped, so a stalled car can
// always reverse back out. Stall starts in the shallows (~0.8m): a car
// that pushes past the shoreline loses power fast instead of cruising
// on the sea surface.
export function waterCap(city, x, z, heading, speed, cap, maxReverse) {
  const depth = city.waterDepthAt(x, z);
  const out = { speed, depth: 0, stalled: false };
  if (depth <= 0) return out;
  out.depth = depth;
  const shore = city.shoreOutward(x, z);
  const vx = Math.sin(heading) * speed;
  const vz = Math.cos(heading) * speed;
  const pushingOut = Boolean(shore) && vx * shore.x + vz * shore.z > 0;
  if (pushingOut) {
    const grip = Math.max(0, 1 - depth / 0.8);
    out.speed = speed > 0 ? Math.min(speed, cap * grip) : Math.max(speed, -maxReverse * grip);
  }
  out.stalled = depth > 0.8 && Math.abs(out.speed) < 0.5;
  return out;
}

function isSkidding(v) {
  const speedLimit = v.handbraking ? 12 : SKID_SPEED;
  const steerLimit = SKID_STEER * (v.gripMul || 1);
  return Math.abs(v.speed) > speedLimit && Math.abs(v.steerAngle) > steerLimit;
}

// One drive model for cars and bikes: arcade accel/brake/drag,
// grip-scaled steering, bicycle-model yaw (wheelbase per vehicle),
// building collision, and the water depth limit (the sea is the
// boundary — no invisible wall). Split into steps so each reads alone.
function applyThrottle(v, forward, dt, cap, handbrake) {
  if (forward > 0) {
    v.speed += v.accel * (v.boosting ? 1.6 : 1) * dt;
  } else if (forward < 0) {
    if (v.speed > 0.5) v.speed -= BRAKE_FORCE * dt;
    else v.speed -= v.accel * 0.6 * dt;
  } else {
    v.speed -= v.speed * DRAG_COEF * dt;
    if (Math.abs(v.speed) < 0.05) v.speed = 0;
  }
  if (handbrake) v.speed -= v.speed * dt;
  if (v.speed > cap) v.speed = cap;
  if (v.speed < -REVERSE_TOP) v.speed = -REVERSE_TOP;
}

function applyWaterAndSink(v, city, cap, dt) {
  const pos = v.group.position;
  const water = waterCap(city, pos.x, pos.z, v.heading, v.speed, cap, REVERSE_TOP);
  v.speed = water.speed;
  v.stalledInWater = water.stalled;
  // Sink with the depth: at ~1.4m the car is down to its roof. A car
  // stalled in deep water keeps sinking until it is fully under — sit
  // there and you will have to abandon it and swim for shore. Driving
  // back out resets the sink (stalled clears the moment it moves).
  let sink = water.depth * 0.95;
  if (sink > 1.3) sink = 1.3;
  if (water.stalled) {
    v.sinkTimer = (v.sinkTimer || 0) + dt;
    sink += v.sinkTimer * 0.2;
    if (sink > 2.2) sink = 2.2;
  } else {
    v.sinkTimer = 0;
  }
  pos.y = -sink;
}

function applySteering(v, strafe, handbrake, dt, gripMul) {
  const speedAbs = Math.abs(v.speed);
  const grip = Math.min(1, speedAbs / 6) * (1 - speedAbs / v.maxSpeed / 2) * gripMul;
  // Steering is speed-sensitive: full lock at low speed, tapering off
  // as speed rises so the car doesn't spin at highway speed. Was a flat
  // 0.55 rad — at 30 m/s that turned the car ~390°/s, far too twitchy.
  const target = -strafe * 0.4 * grip * (handbrake ? 1.7 : 1);
  const blend = Math.min(1, dt * 6);
  v.steerAngle += (target - v.steerAngle) * blend;
  const yawRate = (v.speed / v.wheelbase) * Math.tan(v.steerAngle);
  v.heading += yawRate * dt * (v.speed < 0 ? -1 : 1);
}

function applyMotionAndCollision(v, city, dt) {
  const pos = v.group.position;
  pos.x += Math.sin(v.heading) * v.speed * dt;
  pos.z += Math.cos(v.heading) * v.speed * dt;
  const beforeX = pos.x;
  const beforeZ = pos.z;
  city.resolveCircle(pos, v.radius);
  if (pos.x !== beforeX || pos.z !== beforeZ) {
    const speedAbs = Math.abs(v.speed);
    v.impact = Math.min(1, speedAbs / v.maxSpeed + 0.3);
    if (v.hp > 0 && v.name !== 'SUNSET COUPE' && speedAbs > 12) {
      v.hp = Math.max(0, v.hp - speedAbs * 0.6);
    }
    if (v.hp <= 0 && !v.burning) {
      v.burning = true;
      v.burnTimer = 3;
    }
    v.speed *= 0.25;
  }
  v.impact = Math.max(0, v.impact - dt * 2);
  v.group.rotation.y = v.heading;
}

function spinWheels(v, dt) {
  for (let i = 0; i < v.wheels.length; i += 1) {
    const w = v.wheels[i];
    w.wheel.rotation.x += (v.speed / v.wheelRadius) * dt;
    w.pivot.rotation.y = w.steers ? v.steerAngle : 0;
  }
}

function driveUpdate(v, dt, input, city, gripMul = 1) {
  v.gripMul = gripMul;
  const axes = input.moveAxes();
  const handbrake = input.isDown('Space');
  v.handbraking = handbrake;
  v.boosting = Boolean(v.nitro) && input.isDown('ShiftLeft');
  const cap = v.boosting ? v.maxSpeed * 1.4 : v.maxSpeed;
  applyThrottle(v, axes.forward, dt, cap, handbrake);
  applyWaterAndSink(v, city, cap, dt);
  applySteering(v, axes.strafe, handbrake, dt, gripMul);
  applyMotionAndCollision(v, city, dt);
  spinWheels(v, dt);
}

// The shared loader (models_loader.js) is imported lazily: a static
// import would break the whole game if the loader file is missing,
// while a failed dynamic import just falls back to box cars below.
let loaderPromise = null;
function fetchModel(name) {
  if (!loaderPromise) {
    loaderPromise = import('./models_loader.js').catch((err) => {
      loaderPromise = null;
      throw err;
    });
  }
  return loaderPromise.then((mod) => mod.loadProp(name).catch((err) => loadUnlisted(mod, name, err)));
}
async function loadUnlisted(mod, name, err) {
  // Models the shared loader does not list yet (boxy-off-roader,
  // luxury-suv): same cache + GLTFLoader via loadGLB, cloned here the
  // way loadProp clones (plain clone: vehicles are not skinned).
  if (!/Unknown prop model/.test(String(err && err.message))) throw err;
  const gltf = await mod.loadGLB('assets/models/' + name + '.glb');
  const group = gltf.scene.clone(true);
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
  });
  return group;
}

// Reparent a wheel node into a steer pivot + spin group, preserving
// its world transform: the pivot steers (rotation.y), the spin group
// rolls (rotation.x) — the same {pivot, wheel, steers} shape
// driveUpdate and traffic.js already use. The spin group has identity
// orientation, so the right-hand wheels (Y-flipped in the GLB) roll
// the same way as the left ones. Returns null if a wheel node is
// missing.
function reparentKeepingWorld(node, parent, pivotPos) {
  scratchMat.copy(scratchInv).multiply(node.matrixWorld);
  scratchMat.decompose(scratchPos, scratchQuat, scratchScale);
  pivotPos.copy(scratchPos);
  node.parent.remove(node);
  node.position.set(0, 0, 0);
  node.quaternion.copy(scratchQuat);
  node.scale.copy(scratchScale);
  parent.add(node);
}

function pullWheels(model, wheelDefs) {
  model.updateMatrixWorld(true);
  scratchInv.copy(model.matrixWorld).invert();
  const out = [];
  let i = 0;
  while (i < wheelDefs.length) {
    const def = wheelDefs[i];
    const node = model.getObjectByName(def[0]);
    if (!node) return null;
    const pivot = new THREE.Group();
    const spin = new THREE.Group();
    pivot.add(spin);
    reparentKeepingWorld(node, spin, pivot.position);
    model.add(pivot);
    out.push({ pivot, wheel: spin, steers: def[1] });
    i += 1;
  }
  return out;
}

// Bike front wheel: steer the whole fork around the steering head (the
// fork + wheel turn together, like a real bike) and spin the wheel on
// its axle inside the fork. The rear wheel uses the car path.
function pullBikeWheels(model) {
  model.updateMatrixWorld(true);
  scratchInv.copy(model.matrixWorld).invert();
  const fork = model.getObjectByName('Fork');
  const front = model.getObjectByName('Wheel_Front');
  const rear = model.getObjectByName('Wheel_Rear');
  if (!fork || !front || !rear) return null;
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
  const steerPivot = new THREE.Group();
  reparentKeepingWorld(fork, steerPivot, steerPivot.position);
  model.add(steerPivot);
  const rearWheels = pullWheels(model, [['Wheel_Rear', false]]);
  if (!rearWheels) return null;
  return [{ pivot: steerPivot, wheel: spinFront, steers: true }, rearWheels[0]];
}

// loadProp clones materials per mesh, so one lamp material becomes many
// instances: unify each named material into ONE instance per vehicle,
// so main.js day/night lampMat/tailMat colour changes hit every lamp
// at once, and the paint recolour covers every painted panel.
function unifyModelMaterials(model, paintNames, paintHex) {
  const shared = new Map();
  const headNames = new Set(['LED', 'Lamp_LED']);
  const tailNames = new Set(['LED_Red', 'Lamp_Red']);
  model.traverse((obj) => {
    if (!obj.isMesh) return;
    const list = Array.isArray(obj.material) ? obj.material : [obj.material];
    const rebuilt = [];
    let touched = false;
    for (const mat of list) {
      if (!mat || !mat.name) {
        rebuilt.push(mat);
        continue;
      }
      let slot = null;
      if (paintNames.includes(mat.name)) slot = 'paint:' + mat.name;
      else if (headNames.has(mat.name)) slot = 'head';
      else if (tailNames.has(mat.name)) slot = 'tail';
      if (slot === null) {
        rebuilt.push(mat);
        continue;
      }
      if (!shared.has(slot)) {
        const copy = mat.clone();
        if (slot.slice(0, 6) === 'paint:') copy.color.setHex(paintHex);
        shared.set(slot, copy);
      }
      rebuilt.push(shared.get(slot));
      touched = true;
    }
    if (touched) obj.material = Array.isArray(obj.material) ? rebuilt : rebuilt[0];
  });
  return { lampMat: shared.get('head') || null, tailMat: shared.get('tail') || null };
}

// Shared trim materials: bumpers + mirrors + spoiler struts (dark),
// hubcaps (light alloy), all shared across every car built.
const darkTrimMat = new THREE.MeshLambertMaterial({ color: 0x2a2a3a });
const alloyMat = new THREE.MeshLambertMaterial({ color: 0xc8c8d0 });

// Small helpers for the box builders below: one line per part instead
// of three (mesh + position + rotation).
function boxMesh(w, h, d, mat) {
  return new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
}
function placePart(mesh, x, y, z, tiltX) {
  mesh.position.set(x, y, z);
  if (tiltX) mesh.rotation.x = tiltX;
  return mesh;
}

function addPickupTop(g, paint, glass) {
  g.add(placePart(boxMesh(1.5, 0.55, 1.4, glass), 0, 1.1, 0.9));
  g.add(placePart(boxMesh(1.55, 0.08, 1.45, paint), 0, 1.4, 0.9));
  g.add(placePart(boxMesh(1.9, 0.35, 0.12, paint), 0, 0.95, -2.0));
  g.add(placePart(boxMesh(1.45, 0.06, 0.8, glass), 0, 1.18, 1.62, -0.6));
}

function addVanTop(g, paint, glass) {
  g.add(placePart(boxMesh(1.85, 1.0, 3.6, paint), 0, 1.35, -0.2));
  g.add(placePart(boxMesh(1.7, 0.5, 0.1, glass), 0, 1.35, 1.62));
}

function addTruckTop(g, paint, glass) {
  g.add(placePart(boxMesh(1.85, 1.0, 1.5, paint), 0, 1.3, 1.5));
  g.add(placePart(boxMesh(1.7, 0.5, 0.1, glass), 0, 1.45, 2.26));
  g.add(placePart(boxMesh(2.0, 1.9, 3.0, paint), 0, 1.35, -0.9));
}

function addSedanTop(g, paint, glass) {
  // Narrower cabin (1.5 vs body 1.9) + sloped windshield and rear
  // window: the wedge profile that reads as a car, not a box.
  g.add(placePart(boxMesh(1.5, 0.55, 2.1, glass), 0, 1.1, -0.2));
  g.add(placePart(boxMesh(1.55, 0.08, 2.15, paint), 0, 1.4, -0.2));
  g.add(placePart(boxMesh(1.45, 0.06, 0.85, glass), 0, 1.16, 1.02, -0.6));
  g.add(placePart(boxMesh(1.45, 0.06, 0.8, glass), 0, 1.16, -1.42, 0.6));
}

// Bus side profile as ops: ['move'|'line', x, y],
// ['arc', cx, cy, r, a0, a1, clockwise], ['quad', cx, cy, x, y]. The
// wheel wells are cut into the profile; the shape extrudes along x
// and is rotated so its length lies on +Z.
const BUS_PROFILE_OPS = [
  ['move', -3.9, 0.35],
  ['line', -3.4, 0.35],
  ['arc', -2.8, 0.35, 0.6, Math.PI, 0, true],
  ['line', 2.2, 0.35],
  ['arc', 2.8, 0.35, 0.6, Math.PI, 0, true],
  ['line', 3.6, 0.35],
  ['quad', 4.05, 0.4, 4.05, 0.9],
  ['line', 3.55, 2.05],
  ['line', -3.7, 2.05],
  ['quad', -4.05, 2.0, -4.05, 1.6],
  ['line', -3.9, 0.35],
];
function busProfileShape() {
  const s = new THREE.Shape();
  for (const op of BUS_PROFILE_OPS) {
    if (op[0] === 'move') s.moveTo(op[1], op[2]);
    else if (op[0] === 'line') s.lineTo(op[1], op[2]);
    else if (op[0] === 'arc') s.absarc(op[1], op[2], op[3], op[4], op[5], op[6]);
    else s.quadraticCurveTo(op[1], op[2], op[3], op[4]);
  }
  return s;
}

function busDestTexture(name) {
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
}

function addBusShell(g, paint, glass, name) {
  // Rounded wedge: the side profile extruded with a bevel, so the bus
  // reads smooth like the GLB vehicles instead of a box. Two-tone
  // Miami city bus: white body and roof, the paint colour kept only
  // as a stripe band below the windows — a solid teal box read as a
  // blue slab, the dark glass on white reads as a bus.
  const busWhite = new THREE.MeshLambertMaterial({ color: 0xf5f2ea });
  const busGeo = new THREE.ExtrudeGeometry(busProfileShape(), {
    depth: 1.96, bevelEnabled: true, bevelThickness: 0.12,
    bevelSize: 0.12, bevelSegments: 3, curveSegments: 12,
  });
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
  for (let side = -1; side <= 1; side += 2) {
    g.add(placePart(boxMesh(0.05, 0.2, 6.6, paint), side * 1.1, 1.32, -0.1));
  }
  // Individual windows: five panes per side, the white body showing
  // between them as pillars — one long glass band looked like a slit.
  for (let side = -1; side <= 1; side += 2) {
    let i = 0;
    while (i < 5) {
      g.add(placePart(boxMesh(0.04, 0.55, 1.14, glass), side * 1.1, 1.68, -2.7 + i * 1.3));
      i += 1;
    }
  }
  g.add(placePart(boxMesh(1.9, 1.0, 0.04, glass), 0, 1.5, 3.86, -0.41));
  const destDark = new THREE.MeshBasicMaterial({ color: 0x1a1030 });
  const destFace = new THREE.MeshBasicMaterial({ map: busDestTexture(name) });
  const dest = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.3, 0.06),
    [destDark, destDark, destDark, destDark, destFace, destDark],
  );
  dest.position.set(0, 1.98, 3.63);
  dest.rotation.x = -0.41;
  g.add(dest);
  const archGeo = new THREE.TorusGeometry(0.55, 0.06, 8, 16, Math.PI);
  archGeo.rotateY(Math.PI / 2);
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      const arch = new THREE.Mesh(archGeo, darkTrimMat);
      arch.position.set(sx * 1.12, 0.44, sz * 2.8);
      g.add(arch);
    }
  }
}

// Box-built car body: the original procedural car, kept for styles with
// no GLB (bus, truck) and as the fallback if a GLB fails to load.
// Builds into its own group so the cast-shadow pass never touches the
// additive headlight meshes that live on the vehicle group.
function buildBoxBody(name, bodyTexture, paintColour, style, spec) {
  const w = spec.width;
  const h = spec.height;
  const len = spec.length;
  const y0 = spec.bodyY;
  const hl = spec.halfLength;
  const wr = spec.wheelRadius;
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ map: bodyTexture });
  const paint = new THREE.MeshLambertMaterial({ color: paintColour });
  // Dark tinted glass (like window film): dark blue-grey at 0.8
  // opacity — the driver stays faintly visible through it, which the
  // carjacking beat needs (driver gets out, runs and screams).
  const glass = new THREE.MeshLambertMaterial({ color: 0x1a2530, transparent: true, opacity: 0.8 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
  const light = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  if (style !== 'bus') {
    g.add(placePart(boxMesh(w, h, len, bodyMat), 0, y0, 0));
  }
  // Wedge silhouette (sedan/taxi/pickup): sloped hood + rear deck
  // panels over the flat body top, so the car reads sleek instead of
  // a box. Van/bus/truck keep their tall tops — the panels would
  // clip them.
  const wedgeStyle = style === 'sedan' || style === 'taxi' || style === 'pickup';
  if (wedgeStyle) {
    g.add(placePart(boxMesh(w * 0.9, 0.08, 0.95, paint), 0, 0.9, 1.5, -0.1));
    g.add(placePart(boxMesh(w * 0.9, 0.08, 0.7, paint), 0, 0.9, -1.68, 0.1));
  }
  if (style === 'pickup') addPickupTop(g, paint, glass);
  else if (style === 'van') addVanTop(g, paint, glass);
  else if (style === 'bus') addBusShell(g, paint, glass, name);
  else if (style === 'truck') addTruckTop(g, paint, glass);
  else addSedanTop(g, paint, glass);
  if (style === 'taxi') {
    const taxiMats = getTaxiMaterials();
    g.add(placePart(boxMesh(0.7, 0.22, 0.3, taxiMats.sign), 0, 1.55, -0.2));
    g.add(placePart(boxMesh(1.94, 0.18, 4.24, taxiMats.band), 0, 0.62, 0));
  }
  // The bus bevel pushes the nose/tail out past the spec half-length,
  // so its lamps sit further forward to stay on the surface.
  const nose = hl + 0.02 + (style === 'bus' ? 0.18 : 0);
  const lampY = style === 'bus' ? 0.9 : 0.62;
  const lampSpread = style === 'bus' ? 1.3 : 1;
  for (let side = -1; side <= 1; side += 2) {
    g.add(placePart(boxMesh(0.34, 0.16, 0.06, light), side * 0.65 * lampSpread, lampY, nose));
  }
  // Taillights: dim red lenses by day, glowing red at night (same
  // fake-light approach as the headlights — no real light per car).
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1010 });
  for (let side = -1; side <= 1; side += 2) {
    g.add(placePart(boxMesh(0.34, 0.16, 0.06, tailMat), side * 0.65 * lampSpread, lampY, -nose));
  }
  // Bumpers front + rear (body half-length, not the spec halfLength —
  // the truck spec's halfLength runs past its body). The bus bumper
  // rides higher, on the rounded nose, not under the flat bottom edge.
  const bumperZ = style === 'bus' ? 4.22 : len / 2 + 0.06;
  const bumperY = style === 'bus' ? 0.85 : 0.35;
  for (let end = 1; end >= -1; end -= 2) {
    g.add(placePart(boxMesh(w * 0.96, 0.2, 0.14, darkTrimMat), 0, bumperY, end * bumperZ));
  }
  // Side mirrors on the cabin front (not the bus — its glass band is
  // the full width already).
  if (style !== 'bus') {
    for (let side = -1; side <= 1; side += 2) {
      g.add(placePart(boxMesh(0.08, 0.14, 0.22, darkTrimMat), side * (w / 2 + 0.05), 1.15, 0.7));
    }
  }
  // Spoiler on sports cars (GT / SPORT / ROADSTER in the name): a wing
  // on two struts at the rear deck.
  if (/\bGT\b|SPORT|ROADSTER/.test(name)) {
    g.add(placePart(boxMesh(1.6, 0.06, 0.35, darkTrimMat), 0, 1.02, -1.95));
    for (let side = -1; side <= 1; side += 2) {
      g.add(placePart(boxMesh(0.08, 0.16, 0.08, darkTrimMat), side * 0.6, 0.92, -1.95));
    }
  }
  const wheelGeo = new THREE.CylinderGeometry(wr, wr, style === 'bus' ? 0.34 : 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const hubGeo = new THREE.CylinderGeometry(wr * 0.55, wr * 0.55, 0.06, 10);
  hubGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  const wz = style === 'bus' ? 2.8 : style === 'truck' ? 1.9 : 1.35;
  const wx = style === 'bus' ? 1.05 : 0.95;
  for (let end = 1; end >= -1; end -= 2) {
    for (let side = -1; side <= 1; side += 2) {
      const pivot = new THREE.Group();
      pivot.position.set(side * wx, wr, end * wz);
      const wheel = new THREE.Mesh(wheelGeo, tyre);
      pivot.add(wheel);
      // Alloy hubcap on the outer face (spins with the wheel —
      // symmetric, so the spin is invisible).
      const hubcap = new THREE.Mesh(hubGeo, alloyMat);
      hubcap.position.set(side * 0.17, 0, 0);
      pivot.add(hubcap);
      g.add(pivot);
      wheels.push({ pivot, wheel, steers: end > 0 });
    }
  }
  g.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { bodyGroup: g, wheels, lampMat: light, tailMat };
}

// Box-built bike: the original procedural bike, kept as the fallback
// if the sport-motorcycle GLB fails to load. Builds into its own
// group under the lean group.
function buildBoxBike(paintColour, withRider) {
  const g = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color: paintColour });
  const dark = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
  const chrome = new THREE.MeshLambertMaterial({ color: 0xc8c8d0 });
  const lamp = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1010 });
  // [width, height, depth, material, x, y, z, tiltX]
  const parts = [
    [0.25, 0.25, 1.7, dark, 0, 0.55, 0, 0],
    [0.38, 0.28, 0.55, paint, 0, 0.72, 0.25, 0],
    [0.34, 0.1, 0.6, dark, 0, 0.68, -0.3, 0],
    [0.65, 0.05, 0.05, chrome, 0, 0.85, 0.75, 0],
    [0.08, 0.55, 0.08, chrome, 0, 0.55, 0.72, 0.3],
    [0.2, 0.12, 0.05, lamp, 0, 0.7, 0.95, 0],
    [0.15, 0.08, 0.05, tailMat, 0, 0.6, -0.95, 0],
  ];
  for (const p of parts) {
    g.add(placePart(boxMesh(p[0], p[1], p[2], p[3]), p[4], p[5], p[6], p[7]));
  }
  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.12, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheels = [];
  for (let i = 0; i < 2; i += 1) {
    const front = i === 0;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0.34, front ? 0.7 : -0.7);
    const wheel = new THREE.Mesh(wheelGeo, dark);
    pivot.add(wheel);
    g.add(pivot);
    wheels.push({ pivot, wheel, steers: front });
  }
  let rider = null;
  if (withRider) rider = addBikeRider(g, 0.02, -0.25);
  g.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  return { bodyGroup: g, wheels, lampMat: lamp, tailMat, rider };
}

// Seated rider for traffic bikes: legs forward to the pegs, arms
// forward to the bars. y/z sit the rider on the seat of whichever
// bike body.
function addBikeRider(parent, y, z) {
  const rider = buildWalkerMesh(0x3da86b, 0x2a2a3a, 0xd9a077, 0x201510, 'cap', 1);
  const grp = rider.group;
  grp.position.set(0, y, z);
  grp.rotation.x = 0.2;
  const pose = [
    [rider.legLeft, -1.0],
    [rider.legRight, -1.0],
    [rider.armLeft, -1.1],
    [rider.armRight, -1.1],
  ];
  for (const entry of pose) entry[0].rotation.x = entry[1];
  parent.add(grp);
  return grp;
}

// Taxi roof sign on the GLB sedan roof (no checker band: the flat
// band would clip the sculpted body; the sign alone reads as taxi).
function addTaxiSignGLB(group) {
  const mats = getTaxiMaterials();
  const sign = boxMesh(0.7, 0.22, 0.3, mats.sign);
  sign.position.set(0, 1.42, -0.2);
  sign.castShadow = true;
  group.add(sign);
}

// Merge a multi-material mesh's groups by material: one draw call per
// material instead of one per primitive. A sedan Body has 50
// primitives across ~8 materials — merging saves ~40 calls per car,
// ~800 across the 20 cars on the road. Hidden materials (the
// tiny-primitive pass) are dropped entirely. Attributes are SHARED
// with the new meshes (not cloned): disposing the old geometry frees
// its GPU buffers and three re-uploads the shared attributes once
// for the merged meshes.
function mergeByMaterial(mesh) {
  const geo = mesh.geometry;
  const mats = mesh.material;
  if (!Array.isArray(mats) || !geo.groups || geo.groups.length <= 1 || !geo.index) return null;
  const byMat = new Map();
  let gi = 0;
  while (gi < geo.groups.length) {
    const grp = geo.groups[gi];
    gi += 1;
    const m = mats[grp.materialIndex];
    if (!m || m.visible === false) continue;
    if (!byMat.has(grp.materialIndex)) byMat.set(grp.materialIndex, []);
    byMat.get(grp.materialIndex).push(grp);
  }
  if (byMat.size === 0) return [];
  let multi = false;
  for (const groups of byMat.values()) {
    if (groups.length > 1) {
      multi = true;
      break;
    }
  }
  if (!multi && byMat.size === geo.groups.length) return null;
  const merged = [];
  for (const [matIdx, groups] of byMat) {
    let total = 0;
    for (const grp of groups) total += grp.count;
    const indexArray = new geo.index.array.constructor(total);
    let at = 0;
    for (const grp of groups) {
      indexArray.set(geo.index.array.subarray(grp.start, grp.start + grp.count), at);
      at += grp.count;
    }
    const sub = new THREE.BufferGeometry();
    for (const name in geo.attributes) sub.setAttribute(name, geo.attributes[name]);
    sub.setIndex(new THREE.BufferAttribute(indexArray, 1));
    const m = new THREE.Mesh(sub, mats[matIdx]);
    m.castShadow = mesh.castShadow;
    m.receiveShadow = mesh.receiveShadow;
    m.name = mesh.name;
    merged.push(m);
  }
  return merged;
}

function mergeModelPrimitives(model) {
  const swaps = [];
  model.traverse((child) => {
    if (!child.isMesh) return;
    const merged = mergeByMaterial(child);
    if (merged) swaps.push([child, merged]);
  });
  for (const pair of swaps) {
    const old = pair[0];
    const parent = old.parent;
    if (!parent) continue;
    for (const n of pair[1]) {
      n.position.copy(old.position);
      n.rotation.copy(old.rotation);
      n.scale.copy(old.scale);
      parent.add(n);
    }
    parent.remove(old);
    old.geometry.dispose();
  }
}

// Hide the tiniest Body primitives (badges, screws, trim slivers
// under 50 triangles): each is a full draw call for a detail
// invisible past a few metres. The sedan Body has 50 primitives and
// 11 are under 50 tris — hiding them saves ~11 calls per car. A
// material hides only when EVERY group using it is tiny, and the
// headlight/taillight materials never hide.
function hideTinyPrimitives(model, lampMat, tailMat) {
  model.traverse((child) => {
    if (!child.isMesh || !Array.isArray(child.material)) return;
    const groups = child.geometry.groups;
    if (!groups || groups.length === 0) return;
    const biggest = new Map();
    for (const grp of groups) {
      const tris = Math.floor(grp.count / 3);
      const prev = biggest.get(grp.materialIndex) || 0;
      if (tris > prev) biggest.set(grp.materialIndex, tris);
    }
    for (const [matIdx, maxTris] of biggest) {
      const m = child.material[matIdx];
      if (maxTris < 50 && m && m !== lampMat && m !== tailMat) m.visible = false;
    }
  });
}

function dummyWheels(wheelDefs) {
  const out = [];
  for (const def of wheelDefs) {
    out.push({ pivot: new THREE.Group(), wheel: new THREE.Group(), steers: def[1] });
  }
  return out;
}

// Swap the GLB in for a car's placeholder once loaded; on any failure
// build the box car instead — the game never shows a missing vehicle.
// The wheels array is mutated in place: driveUpdate and traffic.js
// read it every frame, so the swap needs no other hookup.
function attachCarGLB(vehicle, spec, paintColour, buildBox) {
  fetchModel(spec.file).then((model) => {
    let wheels = pullWheels(model, spec.wheels);
    if (!wheels) {
      // GLB loaded but no separable wheels: show it with static
      // wheels (dummy pivots the drive code can spin harmlessly)
      // rather than a box — a still wheel beats a wrong one.
      wheels = dummyWheels(spec.wheels);
    }
    const mats = unifyModelMaterials(model, spec.paint, paintColour);
    hideTinyPrimitives(model, mats.lampMat, mats.tailMat);
    // Merge primitives by material (one draw call per material, not
    // per primitive): the sedan Body drops from ~39 visible calls
    // to ~8.
    mergeModelPrimitives(model);
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
    for (const w of wheels) vehicle.wheels.push(w);
    if (mats.lampMat) vehicle.lampMat = mats.lampMat;
    if (mats.tailMat) vehicle.tailMat = mats.tailMat;
    if (vehicle.style === 'taxi') addTaxiSignGLB(vehicle.group);
  }).catch(() => {
    buildBox();
  });
}

function attachBikeGLB(vehicle, lean, paintColour, withRider, buildBox) {
  const spec = GLB_MODELS.get('bike');
  fetchModel(spec.file).then((model) => {
    // Parked-pose side stand: hidden — the game holds bikes upright
    // and the stand would jut out sideways while riding.
    const stand = model.getObjectByName('Side_Stand');
    if (stand) stand.visible = false;
    let wheels = pullBikeWheels(model);
    if (!wheels) wheels = dummyWheels(spec.wheels);
    const mats = unifyModelMaterials(model, spec.paint, paintColour);
    mergeModelPrimitives(model);
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
    for (const w of wheels) vehicle.wheels.push(w);
    if (mats.lampMat) vehicle.lampMat = mats.lampMat;
    if (mats.tailMat) vehicle.tailMat = mats.tailMat;
    if (withRider) vehicle.rider = addBikeRider(lean, 0.22, -0.2);
  }).catch(() => {
    buildBox();
  });
}

// Fake headlights (off until main.js turns them on at night for moving
// cars). They never cast shadows — an additive beam must not darken.
function addFakeLights(host, conePos, coneScale, poolPos, poolScale, tailPos, tailScale) {
  const cone = new THREE.Mesh(beamGeo, beamMat);
  cone.position.set(conePos[0], conePos[1], conePos[2]);
  cone.scale.set(coneScale[0], coneScale[1], coneScale[2]);
  cone.visible = false;
  const pool = new THREE.Mesh(poolGeo, headPoolMat);
  pool.position.set(poolPos[0], poolPos[1], poolPos[2]);
  pool.scale.set(poolScale[0], poolScale[1], poolScale[2]);
  pool.visible = false;
  const tail = new THREE.Mesh(poolGeo, tailPoolMat);
  tail.position.set(tailPos[0], tailPos[1], tailPos[2]);
  tail.scale.set(tailScale[0], tailScale[1], tailScale[2]);
  tail.visible = false;
  host.add(cone, pool, tail);
  return { headlightCone: cone, headlightPool: pool, tailGlow: tail };
}

export function createCar(scene, textures, name, bodyTexture, paintColour, x, z, heading, style = 'sedan') {
  const glb = glbModelFor(name, style);
  const box = boxSpecFor(style);
  const fallbackStyle = style === 'ambulance' ? 'van' : style;
  const dims = glb ? pickDims(glb) : pickDims(box);
  // Taxi and van share the sedan/SUV GLBs but are slower vehicles:
  // the style tune overrides the shared GLB tune so the speed order
  // (sedan > SUV > taxi/van) holds whichever model loads.
  let tune = null;
  if (style === 'taxi') tune = 1;
  else if (style === 'van') tune = 0.95;
  if (tune !== null) {
    dims.accelTune = tune;
    dims.speedTune = tune;
  }
  const group = new THREE.Group();
  const wheels = [];
  // Dummy lamp materials until the body attaches: main.js sets their
  // colour every frame, so the fields must exist from the first frame.
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1010 });
  const lights = addFakeLights(
    group,
    [0, 0.75, dims.halfLength + 3.5], [1, 0.4, 1],
    [0, 0.06, dims.halfLength + 4.4], [2.4, 1, 5],
    [0, 0.06, -dims.halfLength - 4.4], [2.4, 1, 5],
  );
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  const gtBoost = name === 'SOLSTICE GT' ? 1.12 : 1;
  const vehicle = {
    group,
    name,
    style,
    heading,
    speed: 0,
    steerAngle: 0,
    impact: 0,
    hp: dims.maxHp,
    maxHp: dims.maxHp,
    baseMaxHp: dims.maxHp,
    maxSpeed: TOP_SPEED * dims.speedTune * gtBoost,
    accel: ACCEL_BASE * dims.accelTune * gtBoost,
    wheelbase: dims.wheelbase,
    radius: dims.radius,
    halfLength: dims.halfLength,
    halfWidth: dims.halfWidth,
    wheelRadius: dims.wheelRadius,
    wheels,
    lampMat,
    tailMat,
    tailGlow: lights.tailGlow,
    headlightCone: lights.headlightCone,
    headlightPool: lights.headlightPool,
    driven: false,
    nitro: false,
    boosting: false,
    burning: false,
    burnTimer: 0,
    stalledInWater: false,
    sinkTimer: 0,
    get position() {
      return group.position;
    },
    get skidding() {
      return isSkidding(this);
    },
    update(dt, input, city, gripMul = 1) {
      driveUpdate(this, dt, input, city, gripMul);
    },
  };
  function buildBox() {
    const placeholder = group.getObjectByName('glb-placeholder');
    if (placeholder) group.remove(placeholder);
    const built = buildBoxBody(name, bodyTexture, paintColour, fallbackStyle, box);
    group.add(built.bodyGroup);
    for (const w of built.wheels) wheels.push(w);
    vehicle.lampMat = built.lampMat;
    vehicle.tailMat = built.tailMat;
  }
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

// Motorcycles: a 2-wheel model with a seated rider (traffic bikes
// only — parked bikes have no rider), leaning into turns. Same drive
// model as cars, tighter wheelbase, quicker accel, narrower collision
// radius so a bike can thread alleys a car cannot.
export function createBike(scene, name, paintColour, x, z, heading, withRider = false) {
  const spec = GLB_MODELS.get('bike');
  const group = new THREE.Group();
  const lean = new THREE.Group();
  group.add(lean);
  const wheels = [];
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x7a1010 });
  const lights = addFakeLights(
    lean,
    [0, 0.75, 4.6], [0.7, 0.3, 0.8],
    [0, 0.06, 5.5], [1.8, 1, 4],
    [0, 0.06, -5.5], [1.8, 1, 4],
  );
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  const vehicle = {
    group,
    name,
    heading,
    style: 'bike',
    speed: 0,
    steerAngle: 0,
    impact: 0,
    hp: 100,
    maxHp: 100,
    baseMaxHp: 100,
    maxSpeed: TOP_SPEED * 1.3,
    accel: ACCEL_BASE * 1.3,
    wheelbase: spec.wheelbase,
    radius: spec.radius,
    halfLength: spec.halfLength,
    halfWidth: spec.halfWidth,
    wheelRadius: spec.wheelRadius,
    wheels,
    leanGroup: lean,
    rider: null,
    lampMat,
    tailMat,
    tailGlow: lights.tailGlow,
    headlightCone: lights.headlightCone,
    headlightPool: lights.headlightPool,
    driven: false,
    nitro: false,
    boosting: false,
    burning: false,
    burnTimer: 0,
    stalledInWater: false,
    sinkTimer: 0,
    get position() {
      return group.position;
    },
    get skidding() {
      return isSkidding(this);
    },
    update(dt, input, city, gripMul = 1) {
      driveUpdate(this, dt, input, city, gripMul);
      // Lean INTO the turn: a positive rotation.z tilts the top
      // toward -x (the bike's right), so the lean is the negative
      // of the steer.
      lean.rotation.z = -this.steerAngle * 0.8;
    },
  };
  function buildBox() {
    const placeholder = lean.getObjectByName('glb-placeholder');
    if (placeholder) lean.remove(placeholder);
    const built = buildBoxBike(paintColour, withRider);
    lean.add(built.bodyGroup);
    for (const w of built.wheels) wheels.push(w);
    vehicle.lampMat = built.lampMat;
    vehicle.tailMat = built.tailMat;
    vehicle.rider = built.rider;
  }
  const placeholder = new THREE.Group();
  placeholder.name = 'glb-placeholder';
  placeholder.visible = false;
  lean.add(placeholder);
  attachBikeGLB(vehicle, lean, paintColour, withRider, buildBox);
  return vehicle;
}

// Police car with the GLB police livery. police.js needs no change to
// use it: createCar already routes name 'POLICE' to the police GLB, so
// its createPoliceCar gets the GLB through the normal path; this
// export exists for direct callers.
export function createPoliceCarGLB(scene, textures, x, z, heading) {
  return createCar(scene, textures, 'POLICE', textures.carWhite, 0xffffff, x, z, heading);
}

export function createCars(scene, textures) {
  const fleet = [];
  fleet.push(createCar(scene, textures, 'SOLSTICE GT', textures.carRed, 0xff6b35, 4.5, -8, Math.PI));
  // Parked cars sit at the curb (4.5m off the road centre: the road
  // is 12m wide, a lane centre is 2.5m off, so a parked car clears
  // moving traffic) and parallel to the road — never mid-lane, never
  // diagonal.
  const parked = [
    { x: -47.5, z: -40, heading: Math.PI, style: 'sedan', name: 'PALM RUNNER', paint: 0x007aff, tex: 'carBlue' },
    { x: 47.5, z: -78, heading: 0, style: 'sedan', name: 'SUNSET COUPE', paint: 0xffd60a, tex: 'carTaxi' },
    { x: -99.5, z: 26, heading: Math.PI, style: 'pickup', name: 'DEL SOL PICKUP', paint: 0x2ad0c4, tex: 'carBlue' },
    // CORAL CRUISER sits on the east-west road through (104, 0)
    // instead of the north-south one, so its long axis still runs
    // along x.
    { x: 130, z: 4.5, heading: Math.PI / 2, style: 'sedan', name: 'CORAL CRUISER', paint: 0xff2d78, tex: 'carRed' },
    { x: 4.5, z: -130, heading: Math.PI, style: 'van', name: 'BLUFF VAN', paint: 0xe63946, tex: 'carRed' },
  ];
  for (const spot of parked) {
    fleet.push(createCar(scene, textures, spot.name, textures[spot.tex], spot.paint, spot.x, spot.z, spot.heading, spot.style));
  }
  // Ambulance outside the hospital entrance: (26,-26) is the middle
  // of the hospital building box, so it parks at the curb on the road
  // west of it, facing along the road like the other parked cars.
  fleet.push(createCar(scene, textures, 'AMBULANCE', textures.carWhite, 0xffffff, 4.5, -26, Math.PI, 'ambulance'));
  return fleet;
}
