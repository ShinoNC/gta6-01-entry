// Arcade cars: no physics engine, just speed, heading and a steering angle.
// One car starts beside the player; the rest are parked around the city to
// steal. Three body styles — sedan, pickup and van — share the same drive
// model; wheels spin and the front pair steers. `skidding` and `impact` are
// read by the particle system: hard steering at speed throws up smoke, and
// a collision flashes sparks.
import * as THREE from 'three';

const CAR_ACCELERATION = 16;
const CAR_BRAKE = 34;
const CAR_DRAG = 0.55;
const CAR_MAX_SPEED = 38;
const CAR_MAX_REVERSE_SPEED = 11;
const CAR_STEER_RATE = 1.9;
const CAR_RADIUS = 1.6;
const SKID_MIN_SPEED = 20;
const SKID_MIN_STEER = 0.3;

export function createCar(scene, textures, name, bodyTexture, paintColour, x, z, heading, style = 'sedan') {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshLambertMaterial({ map: bodyTexture });
  const paintMaterial = new THREE.MeshLambertMaterial({ color: paintColour });
  const glassMaterial = new THREE.MeshLambertMaterial({ color: 0x9fd4e8 });
  const tyreMaterial = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });
  const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff2a8 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.2), bodyMaterial);
  body.position.y = 0.55;
  group.add(body);
  if (style === 'pickup') {
    // Cab up front, open bed behind with low walls.
    const cab = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 1.4), glassMaterial);
    cab.position.set(0, 1.1, 0.9);
    const cabRoof = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 1.45), paintMaterial);
    cabRoof.position.set(0, 1.4, 0.9);
    const bedWall = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.35, 0.12), paintMaterial);
    bedWall.position.set(0, 0.95, -2.0);
    group.add(cab, cabRoof, bedWall);
  } else if (style === 'van') {
    // One tall box: cabin and cargo in a single shell.
    const shell = new THREE.Mesh(new THREE.BoxGeometry(1.85, 1.0, 3.6), paintMaterial);
    shell.position.set(0, 1.35, -0.2);
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.5, 0.1), glassMaterial);
    windshield.position.set(0, 1.35, 1.62);
    group.add(shell, windshield);
  } else {
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.1), glassMaterial);
    cabin.position.set(0, 1.1, -0.2);
    const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 2.15), paintMaterial);
    roofPanel.position.set(0, 1.4, -0.2);
    group.add(cabin, roofPanel);
  }
  // Headlights: two bright dots at the nose, visible at sunset.
  for (const side of [-0.65, 0.65]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), lightMaterial);
    lamp.position.set(side, 0.62, 2.12);
    group.add(lamp);
  }

  const wheelGeometry = new THREE.CylinderGeometry(0.36, 0.36, 0.3, 10);
  wheelGeometry.rotateZ(Math.PI / 2);
  const wheels = [];
  const wheelSpots = [
    [-0.95, 1.35, true],
    [0.95, 1.35, true],
    [-0.95, -1.35, false],
    [0.95, -1.35, false],
  ];
  for (const [wx, wz, steers] of wheelSpots) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, 0.36, wz);
    const wheel = new THREE.Mesh(wheelGeometry, tyreMaterial);
    pivot.add(wheel);
    group.add(pivot);
    wheels.push({ pivot, wheel, steers });
  }

  group.position.set(x, 0, z);
  group.rotation.y = heading;
  scene.add(group);

  return {
    group,
    name,
    style,
    heading,
    speed: 0,
    steerAngle: 0,
    driven: false,
    // 0..1 collision flash, set on a hard hit and decayed by update().
    impact: 0,
    wheels,
    get position() {
      return group.position;
    },
    // Hard steering at speed: the particle system reads this for skid smoke.
    get skidding() {
      return Math.abs(this.speed) > SKID_MIN_SPEED && Math.abs(this.steerAngle) > SKID_MIN_STEER;
    },
    // Drive from input axes: forward = throttle, strafe = steering.
    update(dt, input, city) {
      const { forward, strafe } = input.moveAxes();
      if (forward > 0) this.speed += CAR_ACCELERATION * dt;
      else if (forward < 0) {
        this.speed = this.speed > 0.5 ? this.speed - CAR_BRAKE * dt : this.speed - CAR_ACCELERATION * 0.6 * dt;
      } else {
        this.speed -= this.speed * CAR_DRAG * dt;
        if (Math.abs(this.speed) < 0.05) this.speed = 0;
      }
      this.speed = Math.max(-CAR_MAX_REVERSE_SPEED, Math.min(CAR_MAX_SPEED, this.speed));
      const grip = Math.min(1, Math.abs(this.speed) / 6) * (1 - Math.abs(this.speed) / CAR_MAX_SPEED / 2);
      const steerTarget = -strafe * 0.55 * grip;
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
        this.impact = Math.min(1, Math.abs(this.speed) / CAR_MAX_SPEED + 0.3);
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

// The starter car beside the spawn, plus parked cars on side streets —
// a mix of sedans, a pickup and a van so the stealable fleet looks varied.
export function createCars(scene, textures, rng) {
  const cars = [];
  // North of the spawn, in front of the player (who spawns facing north),
  // so the first car is visible the moment play starts and W walks straight to it.
  const starter = createCar(scene, textures, 'SOLSTICE GT', textures.carRed, 0xd6303e, 2, -8, Math.PI);
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
  void rng;
  return cars;
}
