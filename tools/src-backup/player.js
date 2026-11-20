import * as THREE from 'three';
const WALK_SPEED = 6;
const RUN_SPEED = 9.5;
const TURN_RATE = 2.5;
const PLAYER_RADIUS = 0.7;
const LEG_SWING = 0.55;
const JUMP_SPEED = 7.5;
const GRAVITY = 22;
export function createPlayer(scene, startX, startZ) {
  const group = new THREE.Group();
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
  group.add(torso, head, hairTop, armLeft, armRight, legLeft, legRight);
  group.traverse((child) => {
    if (child.isMesh) child.castShadow = true;
  });
  group.position.set(startX, 0, startZ);
  scene.add(group);
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
    setAppearance(look) {
      if (look.skin !== undefined) skin.color.set(look.skin);
      if (look.hair !== undefined) hair.color.set(look.hair);
      if (look.shirt !== undefined) shirt.color.set(look.shirt);
    },
    // Seated on a bike: legs forward to the pegs, arms forward to the
    // bars, a slight forward lean. player.update is not called while
    // driving, so the pose holds until setBikePose(false) on dismount.
    setBikePose(onBike) {
      const legs = onBike ? -1.0 : 0;
      const arms = onBike ? -1.1 : 0;
      legLeft.rotation.x = legs;
      legRight.rotation.x = legs;
      armLeft.rotation.x = arms;
      armRight.rotation.x = arms;
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
        group.rotation.y = this.heading;
      }
      const moving = forward !== 0;
      city.resolveCircle(group.position, PLAYER_RADIUS);
      if (this.swimming) {
        // Prone in the water, bobbing; arms stroke, legs kick.
        group.rotation.x = Math.PI / 2;
        group.position.y = -0.15 + Math.sin(this.swimTime * 2) * 0.05;
        if (!moving) {
          const t = Math.sin(this.swimTime * 2) * 0.3;
          armLeft.rotation.x = t;
          armRight.rotation.x = -t;
          legLeft.rotation.x = 0;
          legRight.rotation.x = 0;
          return;
        }
        let blocked = false;
        if (this.stamina <= 0) {
          const out = city.shoreOutward(group.position.x, group.position.z);
          const mx = Math.sin(this.heading) * forward, mz = Math.cos(this.heading) * forward;
          if (out && mx * out.x + mz * out.z > 0) blocked = true;
        }
        this.walkPhase += dt * 3 * 1.4;
        const swing = Math.sin(this.walkPhase) * 0.9;
        armLeft.rotation.x = swing;
        armRight.rotation.x = -swing;
        legLeft.rotation.x = Math.sin(this.walkPhase) * 0.4;
        legRight.rotation.x = -Math.sin(this.walkPhase) * 0.4;
        if (blocked) return;
        group.position.x += Math.sin(this.heading) * forward * 3 * dt;
        group.position.z += Math.cos(this.heading) * forward * 3 * dt;
        return;
      }
      if (!moving) {
        legLeft.rotation.x = 0;
        legRight.rotation.x = 0;
        armLeft.rotation.x = 0;
        armRight.rotation.x = this.punchTimer > 0 ? -1.8 : 0;
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
      legLeft.rotation.x = swing;
      legRight.rotation.x = -swing;
      armLeft.rotation.x = -swing * 0.8;
      armRight.rotation.x = swing * 0.8;
      if (this.punchTimer > 0) armRight.rotation.x = -1.8;
      group.position.y = this.jumpY + Math.abs(Math.sin(this.walkPhase)) * 0.06;
    },
  };
  return player;
}