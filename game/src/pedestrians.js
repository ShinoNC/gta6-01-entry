// The crowd. This module spawns the people who walk the sidewalks,
// keeps them strolling up and down their street, and sends them running
// when a speeding car or a gunshot gets too close. The same figure
// factory also builds the beach crowd, gang members, officers, passengers
// and bike riders, so every person in the city shares one body.
import * as THREE from 'three';
import { averageDensity, densityForMinute, districtNameAt, NIGHTLIFE_DISTRICTS, roadLines } from './city.js';
import { chance, pick, range } from './random.js';
import { CIVILIAN_MODELS, findBone, loadPerson, normaliseHeight, playClip, recolourPolice, setPersonColours } from './models_loader.js';

// Wardrobe. The three exported palettes keep their exact order: main.js
// and traffic.js index into them by position, so a reorder would change
// who wears what. The trouser and cap palettes are module-private.
export const SHIRT_COLOURS = [
  0xff5a7a, 0x7ac4ff,
  0xffd978, 0x7affc4,
  0xc47aff, 0xff9a5a,
  0xffffff, 0x5ad0d0,
];
export const SKIN_COLOURS = [
  0xe8b07a, 0xc98a5a,
  0x8a5a3a, 0xf2c9a0,
];
export const HAIR_COLOURS = [
  0x241a2a, 0x4a2a1a, 0x8a6a3a,
  0xd8d8d8, 0x1a1a1a, 0x7a3a2a,
];
const TROUSER_COLOURS = [
  0x2a4a8a, 0x3a3a44,
  0x6b4a2a, 0x2a6b4a,
];
const CAP_COLOURS = [
  0xffd978, 0x7ac4ff,
  0xff5a7a, 0xe8e8e8,
];

// Crowd tuning. Every value here is a gameplay constant: the counts,
// radii and speeds the city was balanced around. Rename freely, but the
// numbers stay exactly as they are.
const WALKER_TOTAL = 35;
const TITLE_SEED_TOTAL = 40;
const BUBBLE_RADIUS = 250;
const BUBBLE_NEAR = 120;
const BUBBLE_FAR = 180;
const PARK_X = 10000;
const PARK_Z = 10000;
const REVIVE_WAIT = 5;
const NIGHT_STRIP_BIAS = 0.6;
const KERB_GAP = 7.6;
const PACE_LO = 1.1;
const PACE_HI = 2.0;
const PANIC_SPEED = 6.5;
const PANIC_TIME = 4;
const DOWN_TIME = 3;
const CAR_STARTLE = 11;
const SHOT_STARTLE = 28;
const YELL_GAP = 4;
const LIMB_SWING = 0.5;
const FREEZE_ODDS = 0.2;
const RESTEER_GAP = 0.6;
const FIGURE_HEIGHT = 1.8;

// Cap colours cycle in order, so two caps standing next to each other
// rarely match. The wheel starts at index 0 and steps forward before
// each pick, so the very first cap drawn is CAP_COLOURS[1].
const nextCapColour = (() => {
  let at = 0;
  return () => {
    at += 1;
    if (at >= CAP_COLOURS.length) at = 0;
    return CAP_COLOURS[at];
  };
})();

// A limb that survives the box-to-GLB body swap. Other systems (police,
// gangs, traffic, beach, sidejobs) write to limb.rotation.x/y/z directly,
// sometimes every frame, so this remembers the pose and pushes it into
// whichever body is live: the box mesh at first, the GLB bone once the
// model arrives. When the mixer takes over, forwarding stops and the
// animation clip owns the limb instead.
class LimbLink {
  constructor() {
    this.pose = { x: 0, y: 0, z: 0 };
    this.boxPart = null;
    this.bonePart = null;
    this.driven = false;
    const self = this;
    this.rotation = {
      get x() { return self.pose.x; },
      set x(v) { self.pose.x = v; self.push(); },
      get y() { return self.pose.y; },
      set y(v) { self.pose.y = v; self.push(); },
      get z() { return self.pose.z; },
      set z(v) { self.pose.z = v; self.push(); },
      set(x, y, z) {
        self.pose.x = x;
        self.pose.y = y;
        self.pose.z = z;
        self.push();
      },
    };
  }
  push() {
    if (this.driven) return;
    const part = this.bonePart || this.boxPart;
    if (!part) return;
    part.rotation.x = this.pose.x;
    part.rotation.y = this.pose.y;
    part.rotation.z = this.pose.z;
  }
  bindBox(mesh) {
    this.boxPart = mesh;
    this.push();
  }
  bindBone(bone) {
    this.bonePart = bone;
    this.push();
  }
  setLive(on) {
    this.driven = on;
    if (!on) this.push();
  }
}

// One box part: [width, height, depth, material key, x, y, z]. The core
// body is built from this table instead of one mesh call per part.
const CORE_PARTS = [
  [0.66, 0.8, 0.4, 'shirt', 0, 1.1, 0],
  [0.46, 0.46, 0.46, 'skin', 0, 1.78, 0],
  [0.5, 0.16, 0.5, 'hair', 0, 2.03, 0],
];

function boxPart(w, h, d, material, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  return mesh;
}

// Hats only exist on the box body: GLB people bring their own hair and
// headwear. Each builder takes the group, the shirt material (for the
// bandana) and the cap-colour wheel (for the cap).
function addCapHat(group, _shirt, nextColour) {
  const fabric = new THREE.MeshLambertMaterial({ color: nextColour() });
  group.add(boxPart(0.52, 0.14, 0.52, fabric, 0, 2.12, 0));
  group.add(boxPart(0.5, 0.05, 0.24, fabric, 0, 2.08, 0.32));
}
function addBrimHat(group) {
  const straw = new THREE.MeshLambertMaterial({ color: 0xf2e2b0 });
  group.add(boxPart(0.72, 0.08, 0.72, straw, 0, 2.1, 0));
  group.add(boxPart(0.4, 0.18, 0.4, straw, 0, 2.2, 0));
}
function addBandana(group, shirt) {
  // Gang bandana: a shirt-coloured band across the forehead.
  group.add(boxPart(0.5, 0.14, 0.5, shirt, 0, 1.98, 0));
}
function addPoliceKit(group) {
  // Unmistakable officer: navy cap with a light-blue band and brim, a
  // gold chest badge, and a dark belt. A navy shirt on its own reads as
  // just another civilian.
  const navy = new THREE.MeshLambertMaterial({ color: 0x1a2a6b });
  const bandMat = new THREE.MeshLambertMaterial({ color: 0x7ac4ff });
  const badgeMat = new THREE.MeshLambertMaterial({ color: 0xffd978 });
  const beltMat = new THREE.MeshLambertMaterial({ color: 0x14141c });
  group.add(boxPart(0.52, 0.14, 0.52, navy, 0, 2.12, 0));
  group.add(boxPart(0.54, 0.06, 0.54, bandMat, 0, 2.06, 0));
  group.add(boxPart(0.5, 0.05, 0.24, navy, 0, 2.08, 0.32));
  group.add(boxPart(0.14, 0.16, 0.03, badgeMat, 0.16, 1.28, 0.21));
  group.add(boxPart(0.68, 0.09, 0.42, beltMat, 0, 0.74, 0));
}
const HAT_BUILDERS = {
  cap: addCapHat,
  brim: addBrimHat,
  bandana: addBandana,
  police: addPoliceKit,
};

// The boxy placeholder figure: built instantly, hidden until the GLB
// model lands, and the fallback if the download fails outright. Returns
// the group plus the four limb meshes the proxies attach to.
function buildBoxFigure(shirtColour, pantsColour, skinColour, hairColour, hat) {
  const group = new THREE.Group();
  const mats = {
    shirt: new THREE.MeshLambertMaterial({ color: shirtColour }),
    pants: new THREE.MeshLambertMaterial({ color: pantsColour }),
    skin: new THREE.MeshLambertMaterial({ color: skinColour }),
    hair: new THREE.MeshLambertMaterial({ color: hairColour }),
  };
  for (const [w, h, d, key, x, y, z] of CORE_PARTS) {
    group.add(boxPart(w, h, d, mats[key], x, y, z));
  }
  const hatBuilder = HAT_BUILDERS[hat];
  if (hatBuilder) hatBuilder(group, mats.shirt, nextCapColour);
  const legGeo = new THREE.BoxGeometry(0.24, 0.72, 0.24);
  legGeo.translate(0, -0.36, 0);
  const armGeo = new THREE.BoxGeometry(0.18, 0.7, 0.18);
  armGeo.translate(0, -0.35, 0);
  const limbs = {};
  const limbSpecs = [
    ['legLeft', legGeo, mats.pants, -0.18, 0.72],
    ['legRight', legGeo, mats.pants, 0.18, 0.72],
    ['armLeft', armGeo, mats.skin, -0.44, 1.42],
    ['armRight', armGeo, mats.skin, 0.44, 1.42],
  ];
  for (const [key, geo, mat, x, y] of limbSpecs) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, 0);
    limbs[key] = mesh;
    group.add(mesh);
  }
  return { group, ...limbs };
}

// Build one walker. Synchronous like before: the box figure goes into
// the group right away (hidden), and the GLB person swaps in when its
// cached download lands. 'police' picks the recoloured soldier; everyone
// else gets a random civilian model in the caller's colours. The model
// pick uses Math.random, never the shared rng, so seeded layouts stay put.
export function buildWalkerMesh(shirtColour, pantsColour, skinColour, hairColour, hat, heightScale) {
  const group = new THREE.Group();
  const figure = buildBoxFigure(shirtColour, pantsColour, skinColour, hairColour, hat);
  figure.group.scale.setScalar(heightScale);
  // Hidden until the GLB arrives: on a fresh load the box figures used
  // to stroll around as pixel blocks while the models streamed in. The
  // box only ever shows if the GLB load actually fails (see the catch).
  figure.group.visible = false;
  group.add(figure.group);
  const links = {
    legLeft: new LimbLink(),
    legRight: new LimbLink(),
    armLeft: new LimbLink(),
    armRight: new LimbLink(),
  };
  links.legLeft.bindBox(figure.legLeft);
  links.legRight.bindBox(figure.legRight);
  links.armLeft.bindBox(figure.armLeft);
  links.armRight.bindBox(figure.armRight);
  const modelName = hat === 'police'
    ? 'soldier'
    : CIVILIAN_MODELS[Math.floor(Math.random() * CIVILIAN_MODELS.length)];
  const walker = {
    group,
    legLeft: links.legLeft,
    legRight: links.legRight,
    armLeft: links.armLeft,
    armRight: links.armRight,
    mode: 'box',
    model: null,
    mixer: null,
    clips: null,
    bones: null,
    armsUp: false,
    ready: null,
    // Switch the walk/run/idle clip; only meaningful once the GLB is live.
    setLocomotion(clip, timeScale = 1) {
      if (this.mode !== 'glb') return;
      playClip(this.mixer, this.clips, clip, timeScale);
    },
    // Hands-up pose for frozen peds: applied after the mixer update, so
    // it wins over the clip while set; the clip retakes the arms when
    // cleared.
    setArmsUp(up) {
      this.armsUp = up;
    },
    // Advance the mixer. Owners that call this own the bones — limb
    // proxy writes stop forwarding, the clip drives the body instead.
    update(dt) {
      if (this.mode !== 'glb' || !this.mixer) return;
      links.legLeft.setLive(true);
      links.legRight.setLive(true);
      links.armLeft.setLive(true);
      links.armRight.setLive(true);
      this.mixer.update(dt);
      if (this.armsUp && this.bones) {
        for (const side of ['UpperArm_L', 'UpperArm_R']) {
          const bone = this.bones.get(side);
          if (bone) bone.rotation.x = -2.4;
        }
      }
    },
  };
  walker.ready = (async () => {
    try {
      const person = await loadPerson(modelName);
      if (hat === 'police') recolourPolice(person.group);
      else {
        setPersonColours(person.group, {
          skin: skinColour,
          hair: hairColour,
          shirt: shirtColour,
          pants: pantsColour,
        });
      }
      normaliseHeight(person.group, FIGURE_HEIGHT);
      person.group.scale.multiplyScalar(heightScale);
      figure.group.visible = false;
      group.add(person.group);
      walker.model = person.group;
      walker.mixer = person.mixer;
      walker.clips = person.clips;
      walker.bones = person.bones;
      walker.mode = 'glb';
      links.legLeft.bindBone(findBone(person.group, 'upperleg_l'));
      links.legRight.bindBone(findBone(person.group, 'upperleg_r'));
      links.armLeft.bindBone(findBone(person.group, 'upperarm_l'));
      links.armRight.bindBone(findBone(person.group, 'upperarm_r'));
      // Walkers do not cast shadows: with 90 peds on the 10x10 map their
      // shadow pass would cost ~600 draw calls for shadows nobody sees.
    } catch (err) {
      // GLB failed: only now does the box figure show, as a true fallback.
      figure.group.visible = true;
      console.warn('Walker GLB failed, box fallback:', err);
    }
    return walker;
  })();
  return walker;
}

// A lifeguard standing on the beach: a Vinish Casual Woman recoloured
// lifeguard-red, idling on the spot (loadPerson starts the Idle clip;
// beach.js updates the mixer each frame), with the same box fallback as
// everyone else. Placement is the caller's job — beach.js owns the sand
// ring (see the PEOPLE report).
export function createLifeguard(scene, x, z) {
  const group = new THREE.Group();
  const figure = buildBoxFigure(0xd7263d, 0xd7263d, 0xe8b07a, 0x241a2a, 'none');
  // Hidden until the GLB arrives (same as walkers: no pixel box on load).
  figure.group.visible = false;
  group.add(figure.group);
  group.position.set(x, 0, z);
  scene.add(group);
  const guard = { group, mode: 'box', model: null, mixer: null, clips: null, ready: null };
  guard.ready = (async () => {
    try {
      const person = await loadPerson('casual-woman');
      setPersonColours(person.group, { shirt: 0xd7263d, pants: 0xd7263d });
      normaliseHeight(person.group, FIGURE_HEIGHT);
      figure.group.visible = false;
      group.add(person.group);
      guard.model = person.group;
      guard.mixer = person.mixer;
      guard.clips = person.clips;
      guard.mode = 'glb';
    } catch (err) {
      // GLB failed: only now does the box figure show, as a true fallback.
      figure.group.visible = true;
      console.warn('Lifeguard GLB failed, box fallback:', err);
    }
    return guard;
  })();
  return guard;
}

export class Pedestrians {
  constructor(scene, rng, onScream) {
    this.rng = rng;
    this.onScream = onScream;
    this.lines = roadLines();
    this.nightlifeLine = null;
    for (const line of this.lines) {
      if (line.axis === 'x' && line.at === 0) {
        this.nightlifeLine = line;
        break;
      }
    }
    // Title-view cluster: the roads the title camera sees (orbit centre
    // (0,200), looking north at downtown). Peds spawned here make the
    // title screen look crowded from the first frame.
    this.titleLines = [];
    for (const line of this.lines) {
      const seenFromTitle = (line.axis === 'z' && Math.abs(line.at) <= 104)
        || (line.axis === 'x' && line.at >= 104 && line.at <= 260);
      if (seenFromTitle) this.titleLines.push(line);
    }
    this.screamCooldown = 0;
    this.peds = [];
    this.target = WALKER_TOTAL;
    this.night = false;
    for (let i = 0; i < WALKER_TOTAL; i += 1) {
      this.peds.push(this.makePed(scene, i < TITLE_SEED_TOTAL));
    }
  }

  // Spawn one walker. The rng draws happen in a fixed order — hat, then
  // the four colours, height, road, side, direction, position, pace,
  // walk phase — because the shared rng is seeded: any reorder would
  // shift every seeded layout downstream.
  makePed(scene, clustered) {
    const rng = this.rng;
    let hat = 'none';
    if (chance(rng, 0.3)) hat = 'cap';
    else if (chance(rng, 0.2)) hat = 'brim';
    const mesh = buildWalkerMesh(
      pick(rng, SHIRT_COLOURS),
      pick(rng, TROUSER_COLOURS),
      pick(rng, SKIN_COLOURS),
      pick(rng, HAIR_COLOURS),
      hat,
      range(rng, 0.88, 1.08),
    );
    const line = pick(rng, clustered ? this.titleLines : this.lines);
    const side = rng() < 0.5 ? -1 : 1;
    const direction = rng() < 0.5 ? -1 : 1;
    let along;
    if (clustered) {
      along = line.axis === 'z' ? 100 + rng() * 200 : -150 + rng() * 300;
    } else {
      along = line.from + rng() * (line.to - line.from);
    }
    const ped = {
      mesh,
      line,
      side,
      direction,
      along,
      walkSpeed: PACE_LO + rng() * (PACE_HI - PACE_LO),
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
    return ped;
  }

  get fleeingCount() {
    let count = 0;
    for (const ped of this.peds) {
      if (ped.fleeTimer > 0) count += 1;
    }
    return count;
  }

  get activeCount() {
    let count = 0;
    for (const ped of this.peds) {
      if (!ped.dormant) count += 1;
    }
    return count;
  }

  // Time-of-day density: the street thins out at night (see city.js).
  // Nobody pops: a ped only leaves when it reaches the end of its walk,
  // and dormant peds respawn from the map edge, so nothing ever appears
  // or vanishes in view.
  setDensity(minutes) {
    const density = averageDensity(minutes);
    this.target = Math.max(1, Math.round(WALKER_TOTAL * density));
    this.night = densityForMinute(minutes) < 0.7;
  }

  update(dt, city, playerCar, gunshot, playerPos) {
    this.screamCooldown -= dt;
    this.frame = (this.frame || 0) + 1;
    if (playerPos) this.recyclePass(playerPos);
    let pedIdx = 0;
    for (const ped of this.peds) {
      this.stepPed(ped, pedIdx, dt, city, playerCar, gunshot, playerPos);
      pedIdx += 1;
    }
  }

  // One ped, one frame. Returns early for the states that skip the
  // shared animation pass (invisible, dormant, knocked down, frozen).
  stepPed(ped, pedIdx, dt, city, playerCar, gunshot, playerPos) {
    // Hidden peds (culled by distance on the title screen) skip all
    // processing: no mixer update, no movement. They resume frozen in
    // place when visible again.
    if (!ped.mesh.group.visible) return;
    if (ped.dormant) {
      ped.retryTimer -= dt;
      if (ped.retryTimer > 0) return;
      ped.retryTimer = REVIVE_WAIT;
      if (this.activeCount < this.target) this.respawnPed(ped);
      return;
    }
    const pos = ped.mesh.group.position;
    if (ped.knockedTimer > 0) {
      ped.knockedTimer -= dt;
      if (ped.knockedTimer <= 0) {
        ped.mesh.group.rotation.x = 0;
        ped.mesh.group.position.y = 0;
        this.fleeFrom(ped, ped.lastHitX, ped.lastHitZ);
      }
      return;
    }
    if (ped.fleeTimer > 0) {
      if (this.stepFleeing(ped, dt, city, pos)) return;
    } else if (!this.stepWalking(ped, dt, pos, playerCar, gunshot)) {
      return;
    }
    this.animatePed(ped, dt, pedIdx, playerPos);
  }

  // A fleeing ped. Returns true when the ped handled its own animation
  // (frozen: hands up, idle clip), so the shared pass must not run.
  stepFleeing(ped, dt, city, pos) {
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
      return true;
    }
    ped.resteeerTimer -= dt;
    if (ped.resteeerTimer <= 0) this.steerFlee(ped, pos);
    const beforeX = pos.x;
    const beforeZ = pos.z;
    pos.x += ped.fleeDx * PANIC_SPEED * dt;
    pos.z += ped.fleeDz * PANIC_SPEED * dt;
    city.resolveCircle(pos, 0.7);
    const moved = Math.hypot(pos.x - beforeX, pos.z - beforeZ);
    if (moved < PANIC_SPEED * dt * 0.3) {
      // Blocked (wall or kerb): turn 90 degrees and try another way.
      const oldDx = ped.fleeDx;
      ped.fleeDx = -ped.fleeDz;
      ped.fleeDz = oldDx;
    }
    ped.mesh.group.rotation.y = Math.atan2(ped.fleeDx, ped.fleeDz);
    ped.walkPhase += dt * PANIC_SPEED * 1.6;
    if (ped.fleeTimer <= 0) {
      // Back to walking: re-anchor to the road at the current spot.
      const along = ped.line.axis === 'z' ? pos.z : pos.x;
      ped.along = along < ped.line.from ? ped.line.from : along > ped.line.to ? ped.line.to : along;
    }
    return false;
  }

  // Re-aim a fleeing ped: away from the threat, biased back toward the
  // sidewalk it came from so peds do not sprint into the middle of the
  // road and stay there.
  steerFlee(ped, pos) {
    ped.resteeerTimer = RESTEER_GAP;
    const awayX = pos.x - ped.fleeFromX;
    const awayZ = pos.z - ped.fleeFromZ;
    const awayDist = Math.hypot(awayX, awayZ) || 1;
    let dx = awayX / awayDist;
    let dz = awayZ / awayDist;
    const lateral = ped.line.axis === 'z' ? pos.x - ped.line.at : pos.z - ped.line.at;
    const kerbSide = lateral >= 0 ? 1 : -1;
    if (ped.line.axis === 'z') dx += kerbSide * 0.6;
    else dz += kerbSide * 0.6;
    const len = Math.hypot(dx, dz) || 1;
    ped.fleeDx = dx / len;
    ped.fleeDz = dz / len;
  }

  // A walking ped. Returns false when the ped went dormant or respawned
  // at the end of its walk, so no animation runs this frame.
  stepWalking(ped, dt, pos, playerCar, gunshot) {
    ped.along += ped.direction * ped.walkSpeed * dt;
    if (ped.along < ped.line.from || ped.along > ped.line.to) {
      // End of the walk: when the street is over its density target the
      // ped heads home — except in the nightlife districts, which stay
      // busy while the residential streets empty out.
      const nightlife = NIGHTLIFE_DISTRICTS.includes(districtNameAt(pos.x, pos.z));
      if (this.activeCount > this.target && !nightlife) {
        this.goDormant(ped);
        return false;
      }
      // At night, a residential ped reaching the end of its walk drifts
      // toward the nightlife strip instead of turning around (respawn
      // re-rolls the line, 60% nightlife) — the busy districts stay
      // busier while residential streets empty out.
      if (this.night && !nightlife && this.rng() < 0.5) {
        this.respawnPed(ped);
        return false;
      }
      ped.direction *= -1;
    }
    this.placeOnSidewalk(ped);
    ped.walkPhase += dt * ped.walkSpeed * 1.6;
    if (playerCar && Math.abs(playerCar.speed) > 4) {
      const carPos = playerCar.position;
      const dx = pos.x - carPos.x;
      const dz = pos.z - carPos.z;
      if (dx * dx + dz * dz < CAR_STARTLE * CAR_STARTLE) this.fleeFrom(ped, carPos.x, carPos.z);
    }
    if (gunshot) {
      const dx = pos.x - gunshot.x;
      const dz = pos.z - gunshot.z;
      if (dx * dx + dz * dz < SHOT_STARTLE * SHOT_STARTLE) this.fleeFrom(ped, gunshot.x, gunshot.z);
    }
    return true;
  }

  // GLB peds walk on their clips (run while fleeing); box peds keep the
  // procedural limb swing. Clip speed follows walk speed, so feet
  // roughly match the ground.
  animatePed(ped, dt, pedIdx, playerPos) {
    const pos = ped.mesh.group.position;
    if (ped.mesh.mode === 'glb') {
      ped.mesh.setArmsUp(false);
      if (ped.fleeTimer > 0) ped.mesh.setLocomotion('run', 1.4);
      else {
        const pace = ped.walkSpeed / 1.4;
        ped.mesh.setLocomotion('walk', pace < 0.6 ? 0.6 : pace > 1.6 ? 1.6 : pace);
      }
      // Mixer LOD: beyond 80m the pose freezes (feet slide, invisible
      // at that range); 45-80m updates at half rate, staggered across
      // frames by ped index so the load spreads evenly.
      const dx = playerPos ? pos.x - playerPos.x : 0;
      const dz = playerPos ? pos.z - playerPos.z : 0;
      const d2 = dx * dx + dz * dz;
      if (d2 <= 2025) ped.mesh.update(dt);
      else if (d2 <= 6400 && (this.frame + pedIdx) % 2 === 0) ped.mesh.update(dt * 2);
    } else {
      const swing = Math.sin(ped.walkPhase) * LIMB_SWING;
      ped.mesh.legLeft.rotation.x = swing;
      ped.mesh.legRight.rotation.x = -swing;
      if (!ped.frozen) {
        ped.mesh.armLeft.rotation.x = -swing * 0.8;
        ped.mesh.armRight.rotation.x = swing * 0.8;
      }
    }
  }

  // Spawn bubble: teleport a far-away ped to a road near the focus
  // instead of letting it walk the empty outskirts. Runs before the
  // visibility skip so culled peds get recycled too.
  recyclePass(playerPos) {
    const r2 = BUBBLE_RADIUS * BUBBLE_RADIUS;
    for (const ped of this.peds) {
      if (ped.dormant) continue;
      const p = ped.mesh.group.position;
      const dx = p.x - playerPos.x;
      const dz = p.z - playerPos.z;
      if (dx * dx + dz * dz > r2) this.recycleNearFocus(ped, playerPos.x, playerPos.z);
    }
  }

  scareFrom(x, z, range) {
    const r2 = range * range;
    for (const ped of this.peds) {
      if (ped.dormant || ped.knockedTimer > 0 || ped.fleeTimer > 0) continue;
      const pos = ped.mesh.group.position;
      const dx = pos.x - x;
      const dz = pos.z - z;
      if (dx * dx + dz * dz < r2) this.fleeFrom(ped, x, z);
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
    ped.fleeTimer = PANIC_TIME;
    ped.resteeerTimer = 0;
    ped.frozen = chance(this.rng, FREEZE_ODDS);
    if (this.screamCooldown > 0) return;
    this.screamCooldown = YELL_GAP;
    this.onScream();
  }

  knockDown(ped, fromX, fromZ, seconds = DOWN_TIME) {
    ped.knockedTimer = seconds;
    ped.fleeTimer = 0;
    ped.frozen = false;
    ped.mesh.setArmsUp(false);
    ped.lastHitX = fromX;
    ped.lastHitZ = fromZ;
    ped.mesh.group.rotation.x = Math.PI / 2;
    ped.mesh.group.position.y = 0.4;
  }

  placeOnSidewalk(ped) {
    const offset = KERB_GAP * ped.side;
    const group = ped.mesh.group;
    if (ped.line.axis === 'z') {
      group.position.set(ped.line.at + offset, 0, ped.along);
      group.rotation.y = ped.direction > 0 ? 0 : Math.PI;
    } else {
      group.position.set(ped.along, 0, ped.line.at + offset);
      group.rotation.y = ped.direction > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
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

  // Spawn bubble: pick a road near the focus and drop the ped on it at
  // a random distance, so the crowd stays where the player can see it.
  recycleNearFocus(ped, fx, fz) {
    const near = [];
    for (const line of this.lines) {
      const gap = line.axis === 'z' ? Math.abs(line.at - fx) : Math.abs(line.at - fz);
      if (gap <= 150) near.push(line);
    }
    const line = pick(this.rng, near.length > 0 ? near : this.lines);
    const target = line.axis === 'z' ? fz : fx;
    const dist = BUBBLE_NEAR + this.rng() * (BUBBLE_FAR - BUBBLE_NEAR);
    const sign = this.rng() < 0.5 ? -1 : 1;
    ped.line = line;
    ped.side = this.rng() < 0.5 ? -1 : 1;
    ped.direction = this.rng() < 0.5 ? -1 : 1;
    const spot = target + sign * dist;
    ped.along = spot < line.from ? line.from : spot > line.to ? line.to : spot;
    ped.fleeTimer = 0;
    ped.knockedTimer = 0;
    ped.frozen = false;
    ped.mesh.setArmsUp(false);
    this.placeOnSidewalk(ped);
  }

  goDormant(ped) {
    ped.dormant = true;
    ped.retryTimer = REVIVE_WAIT;
    ped.mesh.group.visible = false;
    ped.mesh.group.position.set(PARK_X, 0, PARK_Z);
  }

  pickLine() {
    if (this.night && this.nightlifeLine && this.rng() < NIGHT_STRIP_BIAS) return this.nightlifeLine;
    return pick(this.rng, this.lines);
  }
}
