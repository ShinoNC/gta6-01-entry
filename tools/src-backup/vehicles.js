import * as THREE from 'three';
const CAR_ACCEL = 16, CAR_BRAKE = 34, CAR_DRAG = 0.55, CAR_MAX_SPEED = 38, CAR_MAX_REVERSE = 11;
const CAR_STEER_RATE = 1.9, CAR_RADIUS = 1.6, SKID_MIN_SPEED = 20, SKID_MIN_STEER = 0.25;
export function createCar(scene, textures, name, bodyTexture, paintColour, x, z, heading, style = 'sedan') {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ map: bodyTexture });
  const paint = new THREE.MeshLambertMaterial({ color: paintColour });
  const glass = new THREE.MeshLambertMaterial({ color: 0x9fd4e8 });
  const tyre = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
  const light = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.2), bodyMat);
  body.position.y = 0.55;
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
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.1), glass);
    cabin.position.set(0, 1.1, -0.2);
    const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 2.15), paint);
    roofPanel.position.set(0, 1.4, -0.2);
    group.add(cabin, roofPanel);
  }
  for (const side of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), light);
    lamp.position.set(side, 0.62, 2.12);
    group.add(lamp);
  }
  const wheelGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  const wheelSpots = [[-0.95, 1.35, true], [0.95, 1.35, true], [-0.95, -1.35, false], [0.95, -1.35, false]];
  for (const [wx, wz, steers] of wheelSpots) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.36, wz);
    const wheel = new THREE.Mesh(wheelGeometry, tyre);
    pivot.add(wheel);
    group.add(pivot);
    wheels.push({ pivot, wheel, steers });
  }
  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);
  const tune = style === 'van' ? 0.78 : style === 'pickup' ? 0.9 : name === 'SOLSTICE GT' ? 1.12 : 1;
  return {
    group,
    name,
    style,
    heading,
    speed: 0,
    steerAngle: 0,
    driven: false,
    impact: 0,
    hp: 100,
    maxHp: 100,
    nitro: false,
    boosting: false,
    burning: false,
    burnTimer: 0,
    maxSpeed: CAR_MAX_SPEED * tune,
    accel: CAR_ACCEL * tune,
    wheels,
    get position() {
      return group.position;
    },
    get skidding() {
      return Math.abs(this.speed) > (this.handbraking ? 12 : SKID_MIN_SPEED) && Math.abs(this.steerAngle) > SKID_MIN_STEER * (this.gripMul || 1);
    },
    update(dt, input, city, gripMul = 1) {
      this.gripMul = gripMul;
      const { forward, strafe } = input.moveAxes();
      const handbrake = input.isDown('Space');
      this.handbraking = handbrake;
      this.boosting = Boolean(this.nitro) && input.isDown('ShiftLeft');
      const cap = this.boosting ? this.maxSpeed * 1.4 : this.maxSpeed;
      if (forward > 0) this.speed += this.accel * (this.boosting ? 1.6 : 1) * dt;
      else if (forward < 0) {
        this.speed = this.speed > 0.5 ? this.speed - CAR_BRAKE * dt : this.speed - this.accel * 0.6 * dt;
      } else {
        this.speed -= this.speed * CAR_DRAG * dt;
        if (Math.abs(this.speed) < 0.05) this.speed = 0;
      }
      if (handbrake) this.speed -= this.speed * dt;
      this.speed = Math.max(-CAR_MAX_REVERSE, Math.min(cap, this.speed));
      const grip = Math.min(1, Math.abs(this.speed) / 6) * (1 - Math.abs(this.speed) / this.maxSpeed / 2) * gripMul;
      const steerTarget = -strafe * 0.55 * grip * (handbrake ? 1.7 : 1);
      this.steerAngle += (steerTarget - this.steerAngle) * Math.min(1, dt * 8);
      this.heading += (this.speed / 2.6) * Math.tan(this.steerAngle) * dt * (this.speed < 0 ? -1 : 1);
      const nextX = group.position.x + Math.sin(this.heading) * this.speed * dt;
      const nextZ = group.position.z + Math.cos(this.heading) * this.speed * dt;
      group.position.x = nextX;
      group.position.z = nextZ;
      const beforeX = group.position.x;
      const beforeZ = group.position.z;
      city.resolveCircle(group.position, CAR_RADIUS);
      if (group.position.x !== beforeX || group.position.z !== beforeZ) {
        this.impact = Math.min(1, Math.abs(this.speed) / this.maxSpeed + 0.3);
        if (this.hp > 0 && this.name !== 'SUNSET COUPE' && Math.abs(this.speed) > 12) this.hp = Math.max(0, this.hp - Math.abs(this.speed) * 0.6);
        if (this.hp <= 0 && !this.burning) { this.burning = true; this.burnTimer = 3; }
        this.speed *= 0.25;
      }
      this.impact = Math.max(0, this.impact - dt * 2);
      group.rotation.y = this.heading;
      for (const { pivot, wheel, steers } of wheels) {
        wheel.rotation.x += (this.speed / 0.36) * dt;
        pivot.rotation.y = steers ? this.steerAngle : 0;
      }
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
  ];
  for (const [x, z, heading, style, name, paint, textureKey] of parkedSpots) {
    cars.push(createCar(scene, textures, name, textures[textureKey], paint, x, z, heading, style));
  }
  return cars;
}