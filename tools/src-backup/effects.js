import * as THREE from 'three';
const SPARK_COUNT = 96;
const SMOKE_COUNT = 64;
const SPARK_LIFE_SECONDS = 0.4;
const SMOKE_LIFE_SECONDS = 1.1;
const PARKED_Y = -50;
function makePool(scene, count, material) {
  const positions = new Float32Array(count * 3).fill(PARKED_Y);
  const velocities = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return { positions, velocities, life, points };
}
export class Effects {
  constructor(scene) {
    this.sparks = makePool(
      scene,
      SPARK_COUNT,
      new THREE.PointsMaterial({ color: 0xffd978, size: 0.18, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.smoke = makePool(
      scene,
      SMOKE_COUNT,
      new THREE.PointsMaterial({ color: 0x9a93a8, size: 1.3, transparent: true, opacity: 0.4, depthWrite: false }),
    );
  }
  get activeCount() {
    let count = 0;
    for (const pool of [this.sparks, this.smoke]) {
      for (let i = 0; i < pool.life.length; i += 1) if (pool.life[i] > 0) count += 1;
    }
    return count;
  }
  burstSparks(x, y, z, burstCount = 8) {
    let placed = 0;
    for (let i = 0; i < SPARK_COUNT && placed < burstCount; i += 1) {
      if (this.sparks.life[i] > 0) continue;
      this.sparks.positions[i * 3] = x;
      this.sparks.positions[i * 3 + 1] = y;
      this.sparks.positions[i * 3 + 2] = z;
      this.sparks.velocities[i * 3] = (Math.random() - 0.5) * 6;
      this.sparks.velocities[i * 3 + 1] = Math.random() * 5;
      this.sparks.velocities[i * 3 + 2] = (Math.random() - 0.5) * 6;
      this.sparks.life[i] = SPARK_LIFE_SECONDS;
      placed += 1;
    }
    this.sparks.points.geometry.attributes.position.needsUpdate = true;
  }
  puffSmoke(x, y, z, puffCount = 2) {
    let placed = 0;
    for (let i = 0; i < SMOKE_COUNT && placed < puffCount; i += 1) {
      if (this.smoke.life[i] > 0) continue;
      this.smoke.positions[i * 3] = x + (Math.random() - 0.5) * 0.6;
      this.smoke.positions[i * 3 + 1] = y;
      this.smoke.positions[i * 3 + 2] = z + (Math.random() - 0.5) * 0.6;
      this.smoke.velocities[i * 3] = (Math.random() - 0.5) * 0.8;
      this.smoke.velocities[i * 3 + 1] = 1 + Math.random() * 1.2;
      this.smoke.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.8;
      this.smoke.life[i] = SMOKE_LIFE_SECONDS * (0.7 + Math.random() * 0.6);
      placed += 1;
    }
    this.smoke.points.geometry.attributes.position.needsUpdate = true;
  }
  update(dt) {
    for (const pool of [this.sparks, this.smoke]) {
      let moved = false;
      const gravity = pool === this.sparks ? 9 : -0.4;
      const drag = pool === this.sparks ? 0 : 0.6;
      for (let i = 0; i < pool.life.length; i += 1) {
        if (pool.life[i] <= 0) continue;
        pool.life[i] -= dt;
        pool.velocities[i * 3 + 1] -= gravity * dt;
        pool.velocities[i * 3] *= 1 - drag * dt;
        pool.velocities[i * 3 + 2] *= 1 - drag * dt;
        pool.positions[i * 3] += pool.velocities[i * 3] * dt;
        pool.positions[i * 3 + 1] += pool.velocities[i * 3 + 1] * dt;
        pool.positions[i * 3 + 2] += pool.velocities[i * 3 + 2] * dt;
        if (pool.life[i] <= 0) pool.positions[i * 3 + 1] = PARKED_Y;
        moved = true;
      }
      if (moved) pool.points.geometry.attributes.position.needsUpdate = true;
    }
  }
}