import * as THREE from 'three';
import { loadPerson, setPersonColours, findBone, normaliseHeight, playClip } from './models_loader.js';

// Movement and body tuning, grouped by concern. Every number matches the
// shipped behaviour exactly; only the layout changed.
const MOVE = {
  walk: 6,
  run: 9.5,
  turn: 1.8,
  radius: 0.7,
  legSwing: 0.55,
  jump: 7.5,
  gravity: 22,
  height: 1.8,
  backpedal: 0.6,
  swim: 3,
  stepRate: 1.4,
  bob: 0.06,
};
const WATER = {
  swimIn: 1,
  swimOut: 0.7,
  jumpMax: 0.5,
  drain: 8,
  refill: 15,
  wadeFloor: 0.35,
  wadeSlope: 0.45,
};
const PUNCH = { total: 0.45, extend: 0.12, hold: 0.08 };
// Punch pose as data: [bone, rotX, rotY, rotZ], each angle scaled by the
// punch envelope. The right arm drives straight ahead; the left guards.
const PUNCH_POSE = [
  ['UpperArm_R', -1.57, 0, 0.8],
  ['LowerArm_R', -0.25, 0, 0],
  ['UpperArm_L', 0.4, 0, 0.3],
  ['LowerArm_L', -1.2, 0, 0],
  ['Chest', 0.12, -0.35, 0],
  ['Hand_R', 0, -0.8, 0],
];
// Riding pose as data: [bone, angle while seated] (zero on foot).
const BIKE_POSE = [
  ['UpperLeg_L', -1.0],
  ['UpperLeg_R', -1.0],
  ['LowerLeg_L', 1.1],
  ['LowerLeg_R', 1.1],
  ['UpperArm_L', -1.1],
  ['UpperArm_R', -1.1],
];
const LOOK_DEFAULT = { skin: 0xe8b07a, hair: 0x241a2a, shirt: 0xff5a7a };
const PANTS_COLOUR = 0x2a4a8a;
// Fallback box body: [part, width, height, depth, x, y, z, material].
const BOX_PARTS = [
  ['torso', 0.72, 0.85, 0.42, 0, 1.15, 0, 'shirt'],
  ['head', 0.5, 0.5, 0.5, 0, 1.85, 0, 'skin'],
  ['hairTop', 0.54, 0.18, 0.54, 0, 2.12, 0, 'hair'],
  ['armL', 0.2, 0.75, 0.2, -0.48, 1.15, 0, 'skin'],
  ['armR', 0.2, 0.75, 0.2, 0.48, 1.15, 0, 'skin'],
  ['legL', 0.26, 0.75, 0.26, -0.19, 0.38, 0, 'pants'],
  ['legR', 0.26, 0.75, 0.26, 0.19, 0.38, 0, 'pants'],
];

function clamp01(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x;
}

// Smoothstep easing on a 0..1 input.
function easeSmooth(x) {
  const t = clamp01(x);
  return t * t * (3 - 2 * t);
}

// Three-phase punch envelope: fast extend, brief hold, slow retract.
// 0 when the punch is over, 1 at full extension.
function punchEnvelope(t) {
  if (t <= 0) return 0;
  const retractAt = PUNCH.total - PUNCH.extend;
  if (t > retractAt) {
    const e = (PUNCH.total - t) / PUNCH.extend;
    return 1 - (1 - e) * (1 - e);
  }
  if (t > retractAt - PUNCH.hold) return 1;
  return easeSmooth(t / (retractAt - PUNCH.hold));
}

// Build the boxy stand-in body from the parts table. It stays hidden
// unless the GLB never arrives; the caller keeps the limb meshes to
// pose them by hand in that case.
function buildBoxFigure(materials) {
  const holder = new THREE.Group();
  const limbs = {};
  for (let i = 0; i < BOX_PARTS.length; i += 1) {
    const [part, w, h, d, x, y, z, matKey] = BOX_PARTS[i];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials[matKey]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    holder.add(mesh);
    limbs[part] = mesh;
  }
  holder.visible = false;
  return { holder, limbs };
}

export function createPlayer(scene, startX, startZ) {
  const group = new THREE.Group();
  const materials = {
    skin: new THREE.MeshLambertMaterial({ color: LOOK_DEFAULT.skin }),
    shirt: new THREE.MeshLambertMaterial({ color: LOOK_DEFAULT.shirt }),
    pants: new THREE.MeshLambertMaterial({ color: PANTS_COLOUR }),
    hair: new THREE.MeshLambertMaterial({ color: LOOK_DEFAULT.hair }),
  };
  const figure = buildBoxFigure(materials);
  const boxGroup = figure.holder;
  const limbs = figure.limbs;
  group.add(boxGroup);
  group.position.set(startX, 0, startZ);
  // Spawn facing north (heading PI) from the very first frame, so the
  // model never starts out turned away from its movement direction.
  group.rotation.y = Math.PI;
  scene.add(group);

  let model = null;
  let modelMixer = null;
  let modelClips = null;
  let modelBones = null;
  let bikePose = false;
  const appearance = { skin: LOOK_DEFAULT.skin, hair: LOOK_DEFAULT.hair, shirt: LOOK_DEFAULT.shirt };

  function bone(name) {
    if (modelBones && modelBones.has(name)) return modelBones.get(name);
    return model ? findBone(model, name) : null;
  }

  function poseBikeBones(on) {
    if (!model) return;
    for (let i = 0; i < BIKE_POSE.length; i += 1) {
      const b = bone(BIKE_POSE[i][0]);
      if (b) b.rotation.x = on ? BIKE_POSE[i][1] : 0;
    }
  }

  // The lead is the male Casual Man GLB; the box figure only ever shows
  // if this load fails.
  loadPerson('casual-man').then((person) => {
    model = person.group;
    modelMixer = person.mixer;
    modelClips = person.clips;
    modelBones = person.bones;
    normaliseHeight(model, MOVE.height);
    setPersonColours(model, appearance);
    model.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });
    boxGroup.visible = false;
    group.add(model);
    if (bikePose) poseBikeBones(true);
  }).catch((err) => {
    boxGroup.visible = true;
    console.warn('Player GLB failed, box fallback:', err);
  });

  // Pick the live body for this frame: the GLB clip once the model has
  // loaded, the hand-posed box limbs otherwise. The punch writes its
  // pose straight onto the bones after the mixer runs, so it always
  // wins for exactly the punch frames — never blended from the clip,
  // whose A-pose would swing both arms out sideways.
  function renderBody(dt, clip, rate, poseBox, punchT) {
    const e = punchEnvelope(punchT);
    if (model && modelMixer) {
      playClip(modelMixer, modelClips, clip, rate);
      modelMixer.update(dt);
      if (e > 0) {
        for (let i = 0; i < PUNCH_POSE.length; i += 1) {
          const row = PUNCH_POSE[i];
          const b = bone(row[0]);
          if (b) b.rotation.set(row[1] * e, row[2] * e, row[3] * e);
        }
      }
    } else if (poseBox) {
      poseBox(e);
    }
  }

  const player = {
    group,
    heading: Math.PI,
    walkPhase: 0,
    jumpY: 0,
    jumpV: 0,
    punchTimer: 0,
    downTimer: 0,
    stamina: 100,
    swimming: false,
    swimTime: 0,
    punch() {
      this.punchTimer = PUNCH.total;
    },
    knockDown(seconds) {
      this.downTimer = seconds;
      group.rotation.x = Math.PI / 2;
    },
    get position() {
      return group.position;
    },
    // Right-hand bone for weapon attach; the group itself while the
    // model is still loading.
    getHandBone() {
      return bone('Hand_R') || group;
    },
    setAppearance(look) {
      const keys = ['skin', 'hair', 'shirt'];
      for (let i = 0; i < keys.length; i += 1) {
        const key = keys[i];
        if (look[key] === undefined) continue;
        appearance[key] = look[key];
        materials[key].color.set(look[key]);
      }
      if (model) setPersonColours(model, look);
    },
    // Seated on a bike: legs forward to the pegs, arms forward to the
    // bars, a slight forward lean. update() is not called while
    // driving, so the pose holds until dismount clears it.
    setBikePose(onBike) {
      bikePose = onBike;
      const legs = onBike ? -1.0 : 0;
      const arms = onBike ? -1.1 : 0;
      limbs.legL.rotation.x = legs;
      limbs.legR.rotation.x = legs;
      limbs.armL.rotation.x = arms;
      limbs.armR.rotation.x = arms;
      poseBikeBones(onBike);
      group.rotation.x = onBike ? 0.2 : 0;
      group.rotation.z = 0;
    },
    update(dt, input, city) {
      stepPlayer(this, dt, input, city);
    },
  };

  // One frame of the player: timers, knockdown, water state, jump,
  // turning, then the swim / idle / walk branch for this frame.
  function stepPlayer(p, dt, input, city) {
    if (p.punchTimer > 0) p.punchTimer = Math.max(0, p.punchTimer - dt);
    if (p.downTimer > 0) {
      p.downTimer -= dt;
      if (p.downTimer <= 0) {
        group.rotation.x = 0;
      } else {
        group.position.y = 0.4;
        return;
      }
    }
    const depth = city.waterDepthAt(group.position.x, group.position.z);
    // Swim state with hysteresis: enter past 1m, leave below 0.7m, so
    // the pose never flickers at the boundary. Stamina drains while
    // swimming and refills on land or in the shallows.
    if (!p.swimming && depth > WATER.swimIn) {
      p.swimming = true;
    } else if (p.swimming && depth < WATER.swimOut) {
      p.swimming = false;
      group.rotation.x = 0;
    }
    if (p.swimming) {
      p.stamina = Math.max(0, p.stamina - WATER.drain * dt);
      p.swimTime += dt;
    } else {
      p.stamina = Math.min(100, p.stamina + WATER.refill * dt);
    }
    if (input.pressed('Space') && p.jumpY <= 0 && !p.swimming && depth <= WATER.jumpMax) {
      p.jumpV = MOVE.jump;
    }
    if (p.jumpY > 0 || p.jumpV > 0) {
      p.jumpV -= MOVE.gravity * dt;
      p.jumpY += p.jumpV * dt;
      if (p.jumpY <= 0) {
        p.jumpY = 0;
        p.jumpV = 0;
      }
    }
    const axes = input.moveAxes();
    // Tank controls: A/D turn in place (standing still or moving), so
    // the player can aim without a mouse; W walks the facing direction
    // and S backpedals at 60% without turning. The camera always sits
    // behind the heading, so movement is never camera-relative.
    if (axes.strafe !== 0) p.heading -= axes.strafe * MOVE.turn * dt;
    group.rotation.y = p.heading;
    city.resolveCircle(group.position, MOVE.radius);
    if (p.swimming) {
      stepSwim(p, dt, city, axes.forward);
      return;
    }
    if (axes.forward === 0) {
      renderBody(dt, 'idle', 1, (e) => {
        limbs.legL.rotation.x = 0;
        limbs.legR.rotation.x = 0;
        limbs.armL.rotation.x = 0.5 * e;
        limbs.armR.rotation.x = -1.8 * e;
      }, p.punchTimer);
      group.position.y = p.jumpY;
      return;
    }
    stepWalk(p, dt, input, city, axes.forward, depth);
  }

  // Prone in the water, bobbing; the walk clip at low speed reads as a
  // paddle, the box limbs stroke and kick. At zero stamina the only
  // way open is back to shore.
  function stepSwim(p, dt, city, forward) {
    group.rotation.x = Math.PI / 2;
    group.position.y = -0.15 + Math.sin(p.swimTime * 2) * 0.05;
    if (forward === 0) {
      renderBody(dt, 'walk', 0.4, () => {
        const t = Math.sin(p.swimTime * 2) * 0.3;
        limbs.armL.rotation.x = t;
        limbs.armR.rotation.x = -t;
        limbs.legL.rotation.x = 0;
        limbs.legR.rotation.x = 0;
      }, p.punchTimer);
      return;
    }
    let blocked = false;
    if (p.stamina <= 0) {
      const out = city.shoreOutward(group.position.x, group.position.z);
      const mx = Math.sin(p.heading) * forward;
      const mz = Math.cos(p.heading) * forward;
      if (out && mx * out.x + mz * out.z > 0) blocked = true;
    }
    p.walkPhase += dt * MOVE.swim * MOVE.stepRate;
    const stroke = Math.sin(p.walkPhase) * 0.9;
    const kick = Math.sin(p.walkPhase) * 0.4;
    renderBody(dt, 'walk', 0.9, () => {
      limbs.armL.rotation.x = stroke;
      limbs.armR.rotation.x = -stroke;
      limbs.legL.rotation.x = kick;
      limbs.legR.rotation.x = -kick;
    }, p.punchTimer);
    if (blocked) return;
    group.position.x += Math.sin(p.heading) * forward * MOVE.swim * dt;
    group.position.z += Math.cos(p.heading) * forward * MOVE.swim * dt;
  }

  // On-foot movement: run with Shift, backpedal slower, wading drag
  // ramping into swim speed at 1m depth. Clip speed follows move
  // speed, so feet roughly match the ground.
  function stepWalk(p, dt, input, city, forward, depth) {
    const running = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
    let speed = running ? MOVE.run : MOVE.walk;
    if (forward < 0) speed *= MOVE.backpedal;
    if (depth > 0) speed *= Math.max(WATER.wadeFloor, 1 - depth * WATER.wadeSlope);
    group.position.x += Math.sin(p.heading) * forward * speed * dt;
    group.position.z += Math.cos(p.heading) * forward * speed * dt;
    p.walkPhase += dt * speed * MOVE.stepRate;
    const swing = Math.sin(p.walkPhase) * MOVE.legSwing;
    const clip = running && forward > 0 ? 'run' : 'walk';
    const base = running ? MOVE.run : MOVE.walk;
    const rate = Math.max(0.6, Math.min(1.5, speed / base));
    renderBody(dt, clip, rate, (e) => {
      limbs.legL.rotation.x = swing;
      limbs.legR.rotation.x = -swing;
      limbs.armL.rotation.x = -swing * 0.8;
      limbs.armR.rotation.x = swing * 0.8;
      if (e > 0) {
        limbs.armR.rotation.x += (-1.8 - limbs.armR.rotation.x) * e;
        limbs.armL.rotation.x += (0.5 - limbs.armL.rotation.x) * e;
      }
    }, p.punchTimer);
    group.position.y = p.jumpY + Math.abs(Math.sin(p.walkPhase)) * MOVE.bob;
  }

  return player;
}
