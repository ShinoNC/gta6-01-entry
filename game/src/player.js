// The on-foot player: a low-poly character built from boxes, moved with WASD
// relative to the camera, with a simple run bob and a walk-cycle leg swing.
// Collision is a circle pushed out of building boxes by the city.
import * as THREE from 'three';

const WALK_SPEED = 6;
const RUN_SPEED = 9.5;
const PLAYER_RADIUS = 0.7;
const LEG_SWING = 0.55;

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
    moving: false,
    walkPhase: 0,
    get position() {
      return group.position;
    },
    // Move from input axes relative to the camera yaw; returns true while moving.
    update(dt, input, cameraYaw, city) {
      const { forward, strafe } = input.moveAxes();
      const moving = forward !== 0 || strafe !== 0;
      this.moving = moving;
      if (!moving) {
        legLeft.rotation.x = 0;
        legRight.rotation.x = 0;
        armLeft.rotation.x = 0;
        armRight.rotation.x = 0;
        return;
      }
      const running = input.isDown('ShiftLeft') || input.isDown('ShiftRight');
      const speed = running ? RUN_SPEED : WALK_SPEED;
      // Camera-relative direction: forward is away from the camera.
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      const dx = (-sin * forward + cos * strafe) * speed * dt;
      const dz = (-cos * forward - sin * strafe) * speed * dt;
      group.position.x += dx;
      group.position.z += dz;
      city.resolveCircle(group.position, PLAYER_RADIUS);
      this.heading = Math.atan2(dx, dz);
      group.rotation.y = this.heading;
      this.walkPhase += dt * speed * 1.4;
      const swing = Math.sin(this.walkPhase) * LEG_SWING;
      legLeft.rotation.x = swing;
      legRight.rotation.x = -swing;
      armLeft.rotation.x = -swing * 0.8;
      armRight.rotation.x = swing * 0.8;
      group.position.y = Math.abs(Math.sin(this.walkPhase)) * 0.06;
    },
  };
  return player;
}
