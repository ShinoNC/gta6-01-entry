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
    update(dt, input, city) {
      if (this.punchTimer > 0) this.punchTimer = Math.max(0, this.punchTimer - dt);
      if (this.downTimer > 0) {
        this.downTimer -= dt;
        if (this.downTimer <= 0) group.rotation.x = 0;
        else { group.position.y = 0.4; return; }
      }
      if (input.pressed('Space') && this.jumpY <= 0) this.jumpV = JUMP_SPEED;
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