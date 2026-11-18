// Arcade cars: no physics engine, just speed, heading and a steering angle.
// One car starts beside the player; the rest are parked around the city for
// later phases to make stealable. Wheels spin and the front pair steers.
import * as THREE from 'three';

const CAR_ACCELERATION = 16;
const CAR_BRAKE = 34;
const CAR_DRAG = 0.55;
const CAR_MAX_SPEED = 38;
const CAR_MAX_REVERSE_SPEED = 11;
const CAR_STEER_RATE = 1.9;
const CAR_RADIUS = 1.6;

const CAR_NAMES = ['SOLSTICE GT', 'PALM RUNNER', 'CORAL CRUISER', 'SUNSET COUPE', 'MARINA ROADSTER', 'DEL SOL PICKUP'];

export function createCar(scene, textures, name, bodyTexture, paintColour, x, z, heading) {
  const group = new THREE.Group();
  const bodyMaterial = new THREE.MeshLambertMaterial({ map: bodyTexture });
  const paintMaterial = new THREE.MeshLambertMaterial({ color: paintColour });
  const glassMaterial = new THREE.MeshLambertMaterial({ color: 0x9fd4e8 });
  const tyreMaterial = new THREE.MeshLambertMaterial({ color: 0x1c1a24 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.62, 4.2), bodyMaterial);
  body.position.y = 0.55;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 2.1), glassMaterial);
  cabin.position.set(0, 1.1, -0.2);
  const roofPanel = new THREE.Mesh(new THREE.BoxGeometry(1.75, 0.08, 2.15), paintMaterial);
  roofPanel.position.set(0, 1.4, -0.2);
  group.add(body, cabin, roofPanel);

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
    heading,
    speed: 0,
    steerAngle: 0,
    driven: false,
    get position() {
      return group.position;
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
      // Steering only bites while rolling, and less at top speed.
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
      // A wall stops the car dead instead of letting it slide through.
      if (group.position.x !== beforeX || group.position.z !== beforeZ) this.speed *= 0.25;
      group.rotation.y = this.heading;
      for (const { pivot, wheel, steers } of wheels) {
        wheel.rotation.x += (this.speed / 0.36) * dt;
        pivot.rotation.y = steers ? this.steerAngle : 0;
      }
    },
  };
}

// The starter car beside the spawn, plus parked cars on side streets.
export function createCars(scene, textures, rng) {
  const cars = [];
  const starter = createCar(scene, textures, 'SOLSTICE GT', textures.carRed, 0xd6303e, 2, 8, Math.PI);
  cars.push(starter);
  const parkedSpots = [
    [-52, -40, 0],
    [52, -104, Math.PI],
    [-104, 26, Math.PI / 2],
    [104, 0, -Math.PI / 2],
    [0, -156, 0],
    [-156, -78, Math.PI],
  ];
  for (let i = 0; i < parkedSpots.length; i += 1) {
    const [x, z, heading] = parkedSpots[i];
    const red = i % 2 === 0;
    cars.push(
      createCar(
        scene,
        textures,
        CAR_NAMES[(i + 1) % CAR_NAMES.length],
        red ? textures.carRed : textures.carBlue,
        red ? 0xd6303e : 0x346edc,
        x,
        z,
        heading,
      ),
    );
  }
  void rng;
  return cars;
}
