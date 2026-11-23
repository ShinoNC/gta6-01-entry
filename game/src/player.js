import * as THREE from 'three';
import { loadPerson, setPersonColours, findBone, normaliseHeight, playClip } from './models_loader.js';
const WALK_SPEED = 6;
const RUN_SPEED = 9.5;
const TURN_RATE = 1.8;
const PLAYER_RADIUS = 0.7;
const LEG_SWING = 0.55;
const JUMP_SPEED = 7.5;
const GRAVITY = 22;
const PLAYER_HEIGHT = 1.8;
// The player is the Casual Man GLB (male — confirmed; the female reference
// image was style-only). The box figure is built first so createPlayer stays
// synchronous, and stays as the fallback if the GLB fails to load.
export function createPlayer(scene, startX, startZ) {
  const group = new THREE.Group();
  const boxGroup = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xe8b07a });
  const shirt = new THREE.MeshLambertMaterial({ color: 0xff5a7a });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2a4a8a });
  const hair = new THREE.MeshLambertMaterial({ color: 0x241a2a });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.85, 0.42), shirt);
  torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), skin);
  head.position.y = 1.85;
  const hairTop = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.18, 0.54), hair);
  hairTop.position.y = 2.12;
  const armLeft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.75, 0.2), skin);
  armLeft.position.set(-0.48, 1.15, 0);
  const armRight = armLeft.clone();
  armRight.position.x = 0.48;
  const legLeft = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.75, 0.26), pants);
  legLeft.position.set(-0.19, 0.38, 0);
  const legRight = legLeft.clone();
  legRight.position.x = 0.19;
  boxGroup.add(torso, head, hairTop, armLeft, armRight, legLeft, legRight);
  boxGroup.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  // Hidden until the GLB arrives (same as walkers: no pixel box on load).
  boxGroup.visible = false;
  group.add(boxGroup);
  group.position.set(startX, 0, startZ);
  // Face the spawn heading from the first frame: heading starts at PI
  // (north) but a fresh group starts at rotation 0, so without this
  // the model faces the opposite of the movement direction until the
  // first A/D press.
  group.rotation.y = Math.PI;
  scene.add(group);
  // GLB state: null until the model arrives (or forever, on load failure).
  let model = null;
  let modelMixer = null;
  let modelClips = null;
  let modelBones = null;
  let bikePose = false;
  const appearance = { skin: 0xe8b07a, hair: 0x241a2a, shirt: 0xff5a7a };
  function bone(name) {
    if (modelBones && modelBones.has(name)) return modelBones.get(name);
    return model ? findBone(model, name) : null;
  }
  function applyBikeBones(on) {
    if (!model) return;
    const legX = on ? -1.0 : 0;
    const armX = on ? -1.1 : 0;
    const set = (name, x) => {
      const b = bone(name);
      if (b) b.rotation.x = x;
    };
    set('UpperLeg_L', legX);
    set('UpperLeg_R', legX);
    set('LowerLeg_L', on ? 1.1 : 0);
    set('LowerLeg_R', on ? 1.1 : 0);
    set('UpperArm_L', armX);
    set('UpperArm_R', armX);
  }
  loadPerson('casual-man').then((person) => {
    model = person.group;
    modelMixer = person.mixer;
    modelClips = person.clips;
    modelBones = person.bones;
    normaliseHeight(model, PLAYER_HEIGHT);
    setPersonColours(model, appearance);
    model.traverse((child) => {
      if (child.isMesh) child.castShadow = true;
    });
    boxGroup.visible = false;
    group.add(model);
    if (bikePose) applyBikeBones(true);
  }).catch((err) => {
    // GLB failed: only now does the box figure show, as a true fallback.
    boxGroup.visible = true;
    console.warn('Player GLB failed, box fallback:', err);
  });
  // Drive the visible body: the GLB mixer when the model is live, the box
  // limbs otherwise. The punch override runs after the mixer update, so it
  // wins over the clip for exactly the punch frames.
  // The punch runs in three phases over the 0.45s timer: fast extend
  // (0.12s), hold (0.08s), retract (0.25s). Each bone lerps from the
  // clip's current pose toward the punch pose by the phase factor, so
  // the arm blends out of whatever the clip is doing with no snap.
  // The wrist twists the open hand edge-on (palm inward) so the punch
  // reads as a fist at game speed; the hand mesh has no finger bones,
  // so a curled fist is not possible.
  const PUNCH_TIME = 0.45;
  const PUNCH_EXTEND = 0.12;
  const PUNCH_HOLD = 0.08;
  function punchFactor(t) {
    if (t <= 0) return 0;
    if (t > PUNCH_TIME - PUNCH_EXTEND) {
      const e = (PUNCH_TIME - t) / PUNCH_EXTEND;
      return 1 - (1 - e) * (1 - e);
    }
    if (t > PUNCH_TIME - PUNCH_EXTEND - PUNCH_HOLD) return 1;
    const e = t / (PUNCH_TIME - PUNCH_EXTEND - PUNCH_HOLD);
    return e * e * (3 - 2 * e);
  }
  function driveVisuals(dt, clip, timeScale, boxPose) {
    const e = punchFactor(player.punchTimer);
    if (model && modelMixer) {
      playClip(modelMixer, modelClips, clip, timeScale);
      modelMixer.update(dt);
      if (e > 0) {
        // SET the pose, never lerp from the clip: the idle/walk clip
        // carries a sideways z on both arms (A-pose), and lerping from
        // it swings both arms out to the sides through the whole punch.
        // Scaling the target by e gives the same smooth in/out.
        const upper = bone('UpperArm_R');
        if (upper) upper.rotation.set(-1.57 * e, 0, 0.8 * e);
        const lower = bone('LowerArm_R');
        if (lower) lower.rotation.set(-0.25 * e, 0, 0);
        const upperL = bone('UpperArm_L');
        if (upperL) upperL.rotation.set(0.4 * e, 0, 0.3 * e);
        const lowerL = bone('LowerArm_L');
        if (lowerL) lowerL.rotation.set(-1.2 * e, 0, 0);
        const chest = bone('Chest');
        if (chest) chest.rotation.set(0.12 * e, -0.35 * e, 0);
        const hand = bone('Hand_R');
        if (hand) hand.rotation.set(0, -0.8 * e, 0);
      }
    } else if (boxPose) {
      boxPose(e);
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
      this.punchTimer = 0.45;
    },
    knockDown(seconds) {
      this.downTimer = seconds;
      group.rotation.x = Math.PI / 2;
    },
    get position() {
      return group.position;
    },
    // Right-hand bone for weapon attach (the weapons stream hangs guns
    // here); the group itself when the model is not loaded yet.
    getHandBone() {
      return bone('Hand_R') || group;
    },
    setAppearance(look) {
      if (look.skin !== undefined) {
        appearance.skin = look.skin;
        skin.color.set(look.skin);
      }
      if (look.hair !== undefined) {
        appearance.hair = look.hair;
        hair.color.set(look.hair);
      }
      if (look.shirt !== undefined) {
        appearance.shirt = look.shirt;
        shirt.color.set(look.shirt);
      }
      if (model) setPersonColours(model, look);
    },
    // Seated on a bike: legs forward to the pegs, arms forward to the
    // bars, a slight forward lean. player.update is not called while
    // driving, so the pose holds until setBikePose(false) on dismount.
    setBikePose(onBike) {
      bikePose = onBike;
      const legs = onBike ? -1.0 : 0;
      const arms = onBike ? -1.1 : 0;
      legLeft.rotation.x = legs;
      legRight.rotation.x = legs;
      armLeft.rotation.x = arms;
      armRight.rotation.x = arms;
      applyBikeBones(onBike);
      group.rotation.x = onBike ? 0.2 : 0;
      group.rotation.z = 0;
    },
    update(dt, input, city) {
      if (this.punchTimer > 0) this.punchTimer = Math.max(0, this.punchTimer - dt);
      if (this.downTimer > 0) {
        this.downTimer -= dt;
        if (this.downTimer <= 0) group.rotation.x = 0;
        else { group.position.y = 0.4; return; }
      }
      const depth = city.waterDepthAt(group.position.x, group.position.z);
      // Swim state with hysteresis: enter past 1m, leave below 0.7m, so
      // the pose never flickers at the boundary. Stamina is the boundary
      // out there — it drains while swimming and refills on land or in
      // the shallows; at 0 the only way open is back to shore.
      if (!this.swimming && depth > 1) this.swimming = true;
      else if (this.swimming && depth < 0.7) { this.swimming = false; group.rotation.x = 0; }
      if (this.swimming) {
        this.stamina = Math.max(0, this.stamina - 8 * dt);
        this.swimTime += dt;
      } else {
        this.stamina = Math.min(100, this.stamina + 15 * dt);
      }
      if (input.pressed('Space') && this.jumpY <= 0 && !this.swimming && depth <= 0.5) this.jumpV = JUMP_SPEED;
      if (this.jumpY > 0 || this.jumpV > 0) {
        this.jumpV -= GRAVITY * dt;
        this.jumpY += this.jumpV * dt;
        if (this.jumpY <= 0) {
          this.jumpY = 0;
          this.jumpV = 0;
        }
      }
      const { forward, strafe } = input.moveAxes();
      // Tank controls: A/D turn in place (standing still or moving), so the
      // player can aim without a mouse; W walks the facing direction, S
      // backpedals at 60% without turning. The camera always sits behind
      // the heading, so there is no camera-relative movement at all.
      if (strafe !== 0) {
        this.heading -= strafe * TURN_RATE * dt;
      }
      // Face the movement direction every frame: the heading is a
      // continuous angle, so the model turns smoothly through 360° —
      // left, right, diagonals — and keeps the last heading standing
      // still (no snap, no binary flip).
      group.rotation.y = this.heading;
      const moving = forward !== 0;
      city.resolveCircle(group.position, PLAYER_RADIUS);
      if (this.swimming) {
        // Prone in the water, bobbing; the walk clip at low speed reads as
        // a paddle, the box limbs stroke and kick as before.
        group.rotation.x = Math.PI / 2;
        group.position.y = -0.15 + Math.sin(this.swimTime * 2) * 0.05;
        if (!moving) {
          driveVisuals(dt, 'walk', 0.4, () => {
            const t = Math.sin(this.swimTime * 2) * 0.3;
            armLeft.rotation.x = t;
            armRight.rotation.x = -t;
            legLeft.rotation.x = 0;
            legRight.rotation.x = 0;
          });
          return;
        }
        let blocked = false;
        if (this.stamina <= 0) {
          const out = city.shoreOutward(group.position.x, group.position.z);
          const mx = Math.sin(this.heading) * forward, mz = Math.cos(this.heading) * forward;
          if (out && mx * out.x + mz * out.z > 0) blocked = true;
        }
        this.walkPhase += dt * 3 * 1.4;
        const swimSwing = Math.sin(this.walkPhase) * 0.9;
        driveVisuals(dt, 'walk', 0.9, () => {
          armLeft.rotation.x = swimSwing;
          armRight.rotation.x = -swimSwing;
          legLeft.rotation.x = Math.sin(this.walkPhase) * 0.4;
          legRight.rotation.x = -Math.sin(this.walkPhase) * 0.4;
        });
        if (blocked) return;
        group.position.x += Math.sin(this.heading) * forward * 3 * dt;
        group.position.z += Math.cos(this.heading) * forward * 3 * dt;
        return;
      }
      if (!moving) {
        driveVisuals(dt, 'idle', 1, (e) => {
          legLeft.rotation.x = 0;
          legRight.rotation.x = 0;
          armLeft.rotation.x = 0.5 * e;
          armRight.rotation.x = -1.8 * e;
        });
        group.position.y = this.jumpY;
        return;
      }
      const running = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      let speed = running ? RUN_SPEED : WALK_SPEED;
      if (forward < 0) speed *= 0.6;
      // Wading drag: the deeper the water, the slower the walk — a smooth
      // ramp into the 3 m/s swim speed at 1m depth.
      if (depth > 0) speed *= Math.max(0.35, 1 - depth * 0.45);
      const dx = Math.sin(this.heading) * forward * speed * dt;
      const dz = Math.cos(this.heading) * forward * speed * dt;
      group.position.x += dx;
      group.position.z += dz;
      this.walkPhase += dt * speed * 1.4;
      const swing = Math.sin(this.walkPhase) * LEG_SWING;
      // Clip speed follows move speed, so feet roughly match the ground.
      const clip = running && forward > 0 ? 'run' : 'walk';
      const scale = Math.max(0.6, Math.min(1.5, speed / (running ? RUN_SPEED : WALK_SPEED)));
      driveVisuals(dt, clip, scale, (e) => {
        legLeft.rotation.x = swing;
        legRight.rotation.x = -swing;
        armLeft.rotation.x = -swing * 0.8;
        armRight.rotation.x = swing * 0.8;
        if (e > 0) armRight.rotation.x += (-1.8 - armRight.rotation.x) * e;
        if (e > 0) armLeft.rotation.x += (0.5 - armLeft.rotation.x) * e;
      });
      group.position.y = this.jumpY + Math.abs(Math.sin(this.walkPhase)) * 0.06;
    },
  };
  return player;
}
