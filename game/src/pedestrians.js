import * as THREE from 'three';
import { roadLines, averageDensity, densityForMinute, districtNameAt, NIGHTLIFE_DISTRICTS } from './city.js';
import { chance, pick, range } from './random.js';
import { loadPerson, recolourPolice, setPersonColours, findBone, normaliseHeight, playClip, CIVILIAN_MODELS } from './models_loader.js';
const PEDESTRIAN_COUNT = 35;
const TITLE_CLUSTER_COUNT = 40;
// Spawn bubble: a ped beyond RECYCLE_RADIUS of the focus (player or
// title camera) is teleported back to a road RECYCLE_MIN-MAX_DIST
// from the focus. It was invisible out there (past the 180m cull),
// and at 120m+ a ped is a few pixels tall, so the pop is negligible.
const RECYCLE_RADIUS = 250;
const RECYCLE_MIN_DIST = 120;
const RECYCLE_MAX_DIST = 180;
const DORMANT_X = 10000;
const DORMANT_Z = 10000;
const RESPAWN_RETRY_SECONDS = 5;
const NIGHTLIFE_LINE_BIAS = 0.6;
const SIDEWALK_OFFSET = 7.6;
const WALK_MIN_SPEED = 1.1;
const WALK_MAX_SPEED = 2.0;
const FLEE_SPEED = 6.5;
const FLEE_SECONDS = 4;
const KNOCKED_DOWN_SECONDS = 3;
const CAR_SCARE_RANGE = 11;
const GUNSHOT_SCARE_RANGE = 28;
const SCREAM_COOLDOWN_SECONDS = 4;
const LEG_SWING = 0.5;
const FREEZE_CHANCE = 0.2;
const FLEE_RESTEEER_SECONDS = 0.6;
const PERSON_HEIGHT = 1.8;
export const SHIRT_COLOURS = [0xff5a7a, 0x7ac4ff, 0xffd978, 0x7affc4, 0xc47aff, 0xff9a5a, 0xffffff, 0x5ad0d0];
const PANTS_COLOURS = [0x2a4a8a, 0x3a3a44, 0x6b4a2a, 0x2a6b4a];
export const SKIN_COLOURS = [0xe8b07a, 0xc98a5a, 0x8a5a3a, 0xf2c9a0];
export const HAIR_COLOURS = [0x241a2a, 0x4a2a1a, 0x8a6a3a, 0xd8d8d8, 0x1a1a1a, 0x7a3a2a];
const HAT_COLOURS = [0xffd978, 0x7ac4ff, 0xff5a7a, 0xe8e8e8];
// A limb handle that keeps working across the box -> GLB swap. Callers
// (police, gangs, traffic, beach, sidejobs) set limb.rotation.x/y/z on the
// object buildWalkerMesh returned, synchronously, sometimes every frame —
// so the handle stores the pose and forwards it to whichever body is live:
// the box limb, or the matching bone once the GLB arrives. Owners that
// drive the mixer (Pedestrians.update) flip the handle live, and the clip
// owns the bones from then on instead.
function makeLimbProxy() {
  const stored = { x: 0, y: 0, z: 0 };
  let boxMesh = null;
  let bone = null;
  let live = false;
  const apply = () => {
    if (live) return;
    const target = bone || boxMesh;
    if (!target) return;
    target.rotation.x = stored.x;
    target.rotation.y = stored.y;
    target.rotation.z = stored.z;
  };
  const rotation = {};
  for (const axis of ['x', 'y', 'z']) {
    Object.defineProperty(rotation, axis, {
      enumerable: true,
      get: () => stored[axis],
      set: (v) => {
        stored[axis] = v;
        apply();
      },
    });
  }
  rotation.set = (x, y, z) => {
    stored.x = x;
    stored.y = y;
    stored.z = z;
    apply();
  };
  return {
    rotation,
    bindBox(mesh) {
      boxMesh = mesh;
      apply();
    },
    bindBone(b) {
      bone = b;
      apply();
    },
    setLive(v) {
      live = v;
      if (!v) apply();
    },
  };
}
// The old box figure, kept as the instant placeholder and the fallback if
// a GLB fails to load. Hats live here only: the GLB models bring their own
// hair and headwear, so cap/brim/bandana show on the box body alone.
function buildBoxFigure(shirtColour, pantsColour, skinColour, hairColour, hat) {
  const group = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: shirtColour });
  const pants = new THREE.MeshLambertMaterial({ color: pantsColour });
  const skin = new THREE.MeshLambertMaterial({ color: skinColour });
  const hair = new THREE.MeshLambertMaterial({ color: hairColour });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.8, 0.4), shirt);
  torso.position.y = 1.1;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 0.46), skin);
  head.position.y = 1.78;
  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.5), hair);
  hairTop.position.y = 2.03;
  group.add(torso, head, hairTop);
  if (hat === 'cap') {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.52), new THREE.MeshLambertMaterial({ color: pickHatColour() }));
    cap.position.y = 2.12;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.24), cap.material);
    brim.position.set(0, 2.08, 0.32);
    group.add(cap, brim);
  } else if (hat === 'brim') {
    const brimHat = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.08, 0.72), new THREE.MeshLambertMaterial({ color: 0xf2e2b0 }));
    brimHat.position.y = 2.1;
    const crown = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.4), brimHat.material);
    crown.position.y = 2.2;
    group.add(brimHat, crown);
  } else if (hat === 'bandana') {
    // Gang bandana: a shirt-coloured band across the forehead.
    const bandana = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.5), shirt);
    bandana.position.y = 1.98;
    group.add(bandana);
  } else if (hat === 'police') {
    // Unmistakable officer: navy cap with a light-blue band and brim, a
    // gold chest badge, and a dark belt — a navy shirt alone reads as a
    // civilian.
    const capMat = new THREE.MeshLambertMaterial({ color: 0x1a2a6b });
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.52), capMat);
    cap.position.y = 2.12;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.06, 0.54), new THREE.MeshLambertMaterial({ color: 0x7ac4ff }));
    band.position.y = 2.06;
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.24), capMat);
    brim.position.set(0, 2.08, 0.32);
    const badge = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.16, 0.03), new THREE.MeshLambertMaterial({ color: 0xffd978 }));
    badge.position.set(0.16, 1.28, 0.21);
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.09, 0.42), new THREE.MeshLambertMaterial({ color: 0x14141c }));
    belt.position.y = 0.74;
    group.add(cap, band, brim, badge, belt);
  }
  function limb(geometry, material, x, y) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, 0);
    return mesh;
  }
  const legGeometry = new THREE.BoxGeometry(0.24, 0.72, 0.24);
  legGeometry.translate(0, -0.36, 0);
  const armGeometry = new THREE.BoxGeometry(0.18, 0.7, 0.18);
  armGeometry.translate(0, -0.35, 0);
  const legLeft = limb(legGeometry, pants, -0.18, 0.72);
  const legRight = limb(legGeometry, pants, 0.18, 0.72);
  const armLeft = limb(armGeometry, skin, -0.44, 1.42);
  const armRight = limb(armGeometry, skin, 0.44, 1.42);
  group.add(legLeft, legRight, armLeft, armRight);
  return { group, legLeft, legRight, armLeft, armRight };
}
// Synchronous like before: the box figure is in the group at once, the GLB
// person swaps in when its (cached, shared) download lands. 'police' picks
// the recoloured soldier; everyone else gets a random civilian model with
// the caller's colours. The model pick uses Math.random, never the shared
// rng, so seeded layouts do not shift.
export function buildWalkerMesh(shirtColour, pantsColour, skinColour, hairColour, hat, heightScale) {
  const group = new THREE.Group();
  const box = buildBoxFigure(shirtColour, pantsColour, skinColour, hairColour, hat);
  box.group.scale.setScalar(heightScale);
  // Hidden until the GLB arrives: on a fresh load the box figures used
  // to walk around as pixel blocks while the models streamed in. The
  // box only ever shows if the GLB load actually fails (see .catch).
  box.group.visible = false;
  group.add(box.group);
  const legLeft = makeLimbProxy();
  const legRight = makeLimbProxy();
  const armLeft = makeLimbProxy();
  const armRight = makeLimbProxy();
  legLeft.bindBox(box.legLeft);
  legRight.bindBox(box.legRight);
  armLeft.bindBox(box.armLeft);
  armRight.bindBox(box.armRight);
  const modelName = hat === 'police'
    ? 'soldier'
    : CIVILIAN_MODELS[Math.floor(Math.random() * CIVILIAN_MODELS.length)];
  const mesh = {
    group,
    legLeft,
    legRight,
    armLeft,
    armRight,
    mode: 'box',
    model: null,
    mixer: null,
    clips: null,
    bones: null,
    armsUp: false,
    ready: null,
    // Switch the walk/run/idle clip; only meaningful once the GLB is live.
    setLocomotion(clip, timeScale = 1) {
      if (this.mode === 'glb') playClip(this.mixer, this.clips, clip, timeScale);
    },
    // Hands-up pose for frozen peds: applied after the mixer update, so it
    // wins over the clip while set; the clip retakes the arms when cleared.
    setArmsUp(up) {
      this.armsUp = up;
    },
    // Advance the mixer. Owners that call this own the bones — limb proxy
    // writes stop forwarding, the clip drives the body instead.
    update(dt) {
      if (this.mode !== 'glb' || !this.mixer) return;
      legLeft.setLive(true);
      legRight.setLive(true);
      armLeft.setLive(true);
      armRight.setLive(true);
      this.mixer.update(dt);
      if (this.armsUp && this.bones) {
        const upL = this.bones.get('UpperArm_L');
        const upR = this.bones.get('UpperArm_R');
        if (upL) upL.rotation.x = -2.4;
        if (upR) upR.rotation.x = -2.4;
      }
    },
  };
  mesh.ready = loadPerson(modelName).then((person) => {
    if (hat === 'police') recolourPolice(person.group);
    else {
      setPersonColours(person.group, {
        skin: skinColour,
        hair: hairColour,
        shirt: shirtColour,
        pants: pantsColour,
      });
    }
    normaliseHeight(person.group, PERSON_HEIGHT);
    person.group.scale.multiplyScalar(heightScale);
    box.group.visible = false;
    group.add(person.group);
    mesh.model = person.group;
    mesh.mixer = person.mixer;
    mesh.clips = person.clips;
    mesh.bones = person.bones;
    mesh.mode = 'glb';
    legLeft.bindBone(findBone(person.group, 'upperleg_l'));
    legRight.bindBone(findBone(person.group, 'upperleg_r'));
    armLeft.bindBone(findBone(person.group, 'upperarm_l'));
    armRight.bindBone(findBone(person.group, 'upperarm_r'));
    // Walkers do not cast shadows: with 90 peds on the 10x10 map their
    // shadow pass would cost ~600 draw calls for shadows nobody sees.
    return mesh;
  }).catch((err) => {
    // GLB failed: only now does the box figure show, as a true fallback.
    box.group.visible = true;
    console.warn('Walker GLB failed, box fallback:', err);
    return mesh;
  });
  return mesh;
}
// A lifeguard standing on the beach: a Vinish Casual Woman recoloured
// lifeguard-red, idling on the spot (loadPerson starts the Idle clip;
// beach.js updates the mixer each frame), with the same box fallback as
// everyone else. Placement is the caller's job — beach.js owns the sand
// ring (see the PEOPLE report).
export function createLifeguard(scene, x, z) {
  const group = new THREE.Group();
  const box = buildBoxFigure(0xd7263d, 0xd7263d, 0xe8b07a, 0x241a2a, 'none');
  // Hidden until the GLB arrives (same as walkers: no pixel box on load).
  box.group.visible = false;
  group.add(box.group);
  group.position.set(x, 0, z);
  scene.add(group);
  const handle = { group, mode: 'box', model: null, mixer: null, clips: null, ready: null };
  handle.ready = loadPerson('casual-woman').then((person) => {
    setPersonColours(person.group, { shirt: 0xd7263d, pants: 0xd7263d });
    normaliseHeight(person.group, PERSON_HEIGHT);
    box.group.visible = false;
    group.add(person.group);
    handle.model = person.group;
    handle.mixer = person.mixer;
    handle.clips = person.clips;
    handle.mode = 'glb';
    return handle;
  }).catch((err) => {
    // GLB failed: only now does the box figure show, as a true fallback.
    box.group.visible = true;
    console.warn('Lifeguard GLB failed, box fallback:', err);
    return handle;
  });
  return handle;
}
let hatColourIndex = 0;
function pickHatColour() {
  hatColourIndex = (hatColourIndex + 1) % HAT_COLOURS.length;
  return HAT_COLOURS[hatColourIndex];
}
export class Pedestrians {
  constructor(scene, rng, onScream) {
    this.lines = roadLines();
    this.nightlifeLine = this.lines.find((line) => line.axis === 'x' && line.at === 0);
    // Title-view cluster: roads the title camera sees (orbit centre
    // (0,200), looking north at downtown). Peds spawned here make the
    // title screen look crowded from the first frame.
    this.titleLines = this.lines.filter((line) =>
      (line.axis === 'z' && Math.abs(line.at) <= 104) ||
      (line.axis === 'x' && line.at >= 104 && line.at <= 260));
    this.rng = rng;
    this.onScream = onScream;
    this.screamCooldown = 0;
    this.peds = [];
    this.target = PEDESTRIAN_COUNT;
    this.night = false;
    for (let i = 0; i < PEDESTRIAN_COUNT; i += 1) {
      const hat = chance(rng, 0.3) ? 'cap' : chance(rng, 0.2) ? 'brim' : 'none';
      const mesh = buildWalkerMesh(
        pick(rng, SHIRT_COLOURS),
        pick(rng, PANTS_COLOURS),
        pick(rng, SKIN_COLOURS),
        pick(rng, HAIR_COLOURS),
        hat,
        range(rng, 0.88, 1.08),
      );
      const line = i < TITLE_CLUSTER_COUNT ? pick(rng, this.titleLines) : pick(rng, this.lines);
      const ped = {
        mesh,
        line,
        side: rng() < 0.5 ? -1 : 1,
        direction: rng() < 0.5 ? -1 : 1,
        along: i < TITLE_CLUSTER_COUNT
          ? (line.axis === 'z' ? 100 + rng() * 200 : -150 + rng() * 300)
          : line.from + rng() * (line.to - line.from),
        walkSpeed: WALK_MIN_SPEED + rng() * (WALK_MAX_SPEED - WALK_MIN_SPEED),
        fleeTimer: 0,
        fleeDx: 0,
        fleeDz: 1,
        fleeFromX: 0,
        fleeFromZ: 0,
        resteeerTimer: 0,
        frozen: false,
        knockedTimer: 0,
        lastHitX: 0,
        lastHitZ: 0,
        walkPhase: rng() * 6,
        dormant: false,
        retryTimer: 0,
      };
      this.placeOnSidewalk(ped);
      scene.add(mesh.group);
      this.peds.push(ped);
    }
  }
  get fleeingCount() {
    return this.peds.filter((ped) => ped.fleeTimer > 0).length;
  }
  get activeCount() {
    return this.peds.filter((ped) => !ped.dormant).length;
  }
  // Time-of-day density: the street thins out at night (see city.js).
  // Existing peds walk off naturally — a ped only leaves when it reaches
  // the end of its walk, and dormant peds respawn from the map edge, so
  // nothing ever pops in or out in view.
  setDensity(minutes) {
    this.target = Math.max(1, Math.round(PEDESTRIAN_COUNT * averageDensity(minutes)));
    this.night = densityForMinute(minutes) < 0.7;
  }
  pickLine() {
    if (this.night && this.nightlifeLine && this.rng() < NIGHTLIFE_LINE_BIAS) return this.nightlifeLine;
    return pick(this.rng, this.lines);
  }
  respawnPed(ped) {
    ped.line = this.pickLine();
    ped.side = this.rng() < 0.5 ? -1 : 1;
    ped.direction = this.rng() < 0.5 ? -1 : 1;
    ped.along = ped.direction > 0 ? ped.line.from : ped.line.to;
    ped.fleeTimer = 0;
    ped.knockedTimer = 0;
    ped.frozen = false;
    ped.dormant = false;
    ped.mesh.setArmsUp(false);
    ped.mesh.group.visible = true;
    this.placeOnSidewalk(ped);
  }
  // Spawn bubble: teleport a far-away ped to a road near the focus
  // instead of letting it walk the empty outskirts. Keeps all peds
  // in the visible area instead of spread thin over the island.
  recycleNearFocus(ped, fx, fz) {
    const near = this.lines.filter((line) =>
      line.axis === 'z' ? Math.abs(line.at - fx) <= 150 : Math.abs(line.at - fz) <= 150);
    const line = pick(this.rng, near.length ? near : this.lines);
    const target = line.axis === 'z' ? fz : fx;
    const dist = RECYCLE_MIN_DIST + this.rng() * (RECYCLE_MAX_DIST - RECYCLE_MIN_DIST);
    const sign = this.rng() < 0.5 ? -1 : 1;
    ped.line = line;
    ped.side = this.rng() < 0.5 ? -1 : 1;
    ped.direction = this.rng() < 0.5 ? -1 : 1;
    ped.along = Math.max(line.from, Math.min(line.to, target + sign * dist));
    ped.fleeTimer = 0;
    ped.knockedTimer = 0;
    ped.frozen = false;
    ped.mesh.setArmsUp(false);
    this.placeOnSidewalk(ped);
  }
  goDormant(ped) {
    ped.dormant = true;
    ped.retryTimer = RESPAWN_RETRY_SECONDS;
    ped.mesh.group.visible = false;
    ped.mesh.group.position.set(DORMANT_X, 0, DORMANT_Z);
  }
  placeOnSidewalk(ped) {
    const offset = SIDEWALK_OFFSET * ped.side;
    if (ped.line.axis === 'z') {
      ped.mesh.group.position.set(ped.line.at + offset, 0, ped.along);
      ped.mesh.group.rotation.y = ped.direction > 0 ? 0 : Math.PI;
    } else {
      ped.mesh.group.position.set(ped.along, 0, ped.line.at + offset);
      ped.mesh.group.rotation.y = ped.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
  }
  fleeFrom(ped, fromX, fromZ) {
    const pos = ped.mesh.group.position;
    const dx = pos.x - fromX;
    const dz = pos.z - fromZ;
    const dist = Math.hypot(dx, dz) || 1;
    ped.fleeDx = dx / dist;
    ped.fleeDz = dz / dist;
    ped.fleeFromX = fromX;
    ped.fleeFromZ = fromZ;
    ped.fleeTimer = FLEE_SECONDS;
    ped.resteeerTimer = 0;
    ped.frozen = chance(this.rng, FREEZE_CHANCE);
    if (this.screamCooldown <= 0) {
      this.screamCooldown = SCREAM_COOLDOWN_SECONDS;
      this.onScream();
    }
  }
  scareFrom(x, z, range) {
    for (const ped of this.peds) {
      if (ped.dormant || ped.knockedTimer > 0 || ped.fleeTimer > 0) continue;
      const pos = ped.mesh.group.position;
      if (Math.hypot(pos.x - x, pos.z - z) < range) this.fleeFrom(ped, x, z);
    }
  }
  knockDown(ped, fromX, fromZ, seconds = KNOCKED_DOWN_SECONDS) {
    ped.knockedTimer = seconds;
    ped.fleeTimer = 0;
    ped.frozen = false;
    ped.mesh.setArmsUp(false);
    ped.lastHitX = fromX;
    ped.lastHitZ = fromZ;
    ped.mesh.group.rotation.x = Math.PI / 2;
    ped.mesh.group.position.y = 0.4;
  }
  update(dt, city, playerCar, gunshot, playerPos) {
    this.screamCooldown -= dt;
    this.frame = (this.frame || 0) + 1;
    // Spawn bubble: recycle peds that drifted too far from the focus
    // (player in game, camera on the title screen). Runs before the
    // visibility skip so culled peds get recycled too.
    if (playerPos) {
      const r2 = RECYCLE_RADIUS * RECYCLE_RADIUS;
      for (const ped of this.peds) {
        if (ped.dormant) continue;
        const p = ped.mesh.group.position;
        const dx = p.x - playerPos.x, dz = p.z - playerPos.z;
        if (dx * dx + dz * dz > r2) this.recycleNearFocus(ped, playerPos.x, playerPos.z);
      }
    }
    for (let pedIdx = 0; pedIdx < this.peds.length; pedIdx += 1) {
      const ped = this.peds[pedIdx];
      // Hidden peds (culled by distance on the title screen) skip
      // all processing: no mixer update, no movement. They resume
      // frozen in place when visible again.
      if (!ped.mesh.group.visible) continue;
      if (ped.dormant) {
        ped.retryTimer -= dt;
        if (ped.retryTimer <= 0) {
          ped.retryTimer = RESPAWN_RETRY_SECONDS;
          if (this.activeCount < this.target) this.respawnPed(ped);
        }
        continue;
      }
      const pos = ped.mesh.group.position;
      if (ped.knockedTimer > 0) {
        ped.knockedTimer -= dt;
        if (ped.knockedTimer <= 0) {
          ped.mesh.group.rotation.x = 0;
          ped.mesh.group.position.y = 0;
          this.fleeFrom(ped, ped.lastHitX, ped.lastHitZ);
        }
        continue;
      }
      if (ped.fleeTimer > 0) {
        ped.fleeTimer -= dt;
        if (ped.frozen) {
          if (ped.mesh.mode === 'glb') {
            ped.mesh.setLocomotion('idle', 1);
            ped.mesh.setArmsUp(true);
            ped.mesh.update(dt);
          } else {
            ped.mesh.armLeft.rotation.x = -2.4;
            ped.mesh.armRight.rotation.x = -2.4;
          }
          if (ped.fleeTimer <= 1) ped.frozen = false;
          continue;
        }
        ped.resteeerTimer -= dt;
        if (ped.resteeerTimer <= 0) {
          ped.resteeerTimer = FLEE_RESTEEER_SECONDS;
          const awayX = pos.x - ped.fleeFromX;
          const awayZ = pos.z - ped.fleeFromZ;
          const awayDist = Math.hypot(awayX, awayZ) || 1;
          let dx = awayX / awayDist;
          let dz = awayZ / awayDist;
          const lateral = ped.line.axis === 'z' ? pos.x - ped.line.at : pos.z - ped.line.at;
          const sidewalkBias = lateral >= 0 ? 1 : -1;
          if (ped.line.axis === 'z') dx += sidewalkBias * 0.6;
          else dz += sidewalkBias * 0.6;
          const len = Math.hypot(dx, dz) || 1;
          ped.fleeDx = dx / len;
          ped.fleeDz = dz / len;
        }
        const beforeX = pos.x;
        const beforeZ = pos.z;
        pos.x += ped.fleeDx * FLEE_SPEED * dt;
        pos.z += ped.fleeDz * FLEE_SPEED * dt;
        city.resolveCircle(pos, 0.7);
        if (Math.hypot(pos.x - beforeX, pos.z - beforeZ) < FLEE_SPEED * dt * 0.3) {
          const oldDx = ped.fleeDx;
          ped.fleeDx = -ped.fleeDz;
          ped.fleeDz = oldDx;
        }
        ped.mesh.group.rotation.y = Math.atan2(ped.fleeDx, ped.fleeDz);
        ped.walkPhase += dt * FLEE_SPEED * 1.6;
        if (ped.fleeTimer <= 0) {
          ped.along = ped.line.axis === 'z' ? pos.z : pos.x;
          ped.along = Math.max(ped.line.from, Math.min(ped.line.to, ped.along));
        }
      } else {
        ped.along += ped.direction * ped.walkSpeed * dt;
        if (ped.along < ped.line.from || ped.along > ped.line.to) {
          // End of the walk: when the street is over its density target
          // the ped heads home — except in the nightlife districts, which
          // stay busy while the residential streets empty out.
          const nightlife = NIGHTLIFE_DISTRICTS.includes(districtNameAt(pos.x, pos.z));
          if (this.activeCount > this.target && !nightlife) {
            this.goDormant(ped);
            continue;
          }
          // At night, a residential ped reaching the end of its walk
          // drifts toward the nightlife strip instead of turning around
          // (respawn re-rolls the line, 60% nightlife) — the busy
          // districts stay busier while residential streets empty out.
          if (this.night && !nightlife && this.rng() < 0.5) {
            this.respawnPed(ped);
            continue;
          }
          ped.direction *= -1;
        }
        this.placeOnSidewalk(ped);
        ped.walkPhase += dt * ped.walkSpeed * 1.6;
        if (playerCar && Math.abs(playerCar.speed) > 4) {
          const carPos = playerCar.position;
          if (Math.hypot(pos.x - carPos.x, pos.z - carPos.z) < CAR_SCARE_RANGE) {
            this.fleeFrom(ped, carPos.x, carPos.z);
          }
        }
        if (gunshot && Math.hypot(pos.x - gunshot.x, pos.z - gunshot.z) < GUNSHOT_SCARE_RANGE) {
          this.fleeFrom(ped, gunshot.x, gunshot.z);
        }
      }
      // GLB peds walk on their clips (run while fleeing); box peds keep
      // the procedural limb swing. Clip speed follows walk speed, so feet
      // roughly match the ground.
      if (ped.mesh.mode === 'glb') {
        ped.mesh.setArmsUp(false);
        if (ped.fleeTimer > 0) ped.mesh.setLocomotion('run', 1.4);
        else {
          ped.mesh.setLocomotion('walk', Math.max(0.6, Math.min(1.6, ped.walkSpeed / 1.4)));
        }
        // Mixer LOD: beyond 80m the pose freezes (feet slide, invisible
        // at that range); 45-80m updates at half rate, staggered across
        // frames by ped index so the load spreads evenly.
        const dx = playerPos ? pos.x - playerPos.x : 0;
        const dz = playerPos ? pos.z - playerPos.z : 0;
        const d2 = dx * dx + dz * dz;
        if (d2 <= 45 * 45) ped.mesh.update(dt);
        else if (d2 <= 80 * 80 && (this.frame + pedIdx) % 2 === 0) ped.mesh.update(dt * 2);
      } else {
        const swing = Math.sin(ped.walkPhase) * LEG_SWING;
        ped.mesh.legLeft.rotation.x = swing;
        ped.mesh.legRight.rotation.x = -swing;
        if (!ped.frozen) {
          ped.mesh.armLeft.rotation.x = -swing * 0.8;
          ped.mesh.armRight.rotation.x = swing * 0.8;
        }
      }
    }
  }
}
