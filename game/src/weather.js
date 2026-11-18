import * as THREE from 'three';
const DROPS = 400, AREA = 70, HEIGHT = 26, FALL = 55, RAIN_GRIP = 0.55;
const CLEAR_MIN = 60, CLEAR_MAX = 120, RAIN_MIN = 45, RAIN_MAX = 75;
const CLEAR_FOG = [0xff8f6b, 110, 430], RAIN_FOG = [0x5a6a7a, 40, 190];
export class Weather {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.raining = false;
    this.timer = CLEAR_MIN + rng() * (CLEAR_MAX - CLEAR_MIN);
    const positions = new Float32Array(DROPS * 3);
    for (let i = 0; i < DROPS; i += 1) {
      positions[i * 3] = (rng() - 0.5) * AREA;
      positions[i * 3 + 1] = rng() * HEIGHT;
      positions[i * 3 + 2] = (rng() - 0.5) * AREA;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.rain = new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xaac4e8, size: 0.14, transparent: true, opacity: 0.65, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    this.positions = positions;
  }
  get grip() {
    return this.raining ? RAIN_GRIP : 1;
  }
  get label() {
    return this.raining ? '☂ RAIN' : '☀ CLEAR';
  }
  setFog(fog) {
    this.scene.fog.color.setHex(fog[0]);
    this.scene.fog.near = fog[1];
    this.scene.fog.far = fog[2];
  }
  startRain() {
    this.raining = true;
    this.rain.visible = true;
    this.setFog(RAIN_FOG);
  }
  stopRain() {
    this.raining = false;
    this.rain.visible = false;
    this.setFog(CLEAR_FOG);
  }
  forceRain() {
    this.startRain();
    this.timer = RAIN_MIN;
  }
  forceClear() {
    this.stopRain();
    this.timer = CLEAR_MIN;
  }
  update(dt, focusPos) {
    this.timer -= dt;
    if (this.timer <= 0) {
      if (this.raining) {
        this.stopRain();
        this.timer = CLEAR_MIN + this.rng() * (CLEAR_MAX - CLEAR_MIN);
      } else {
        this.startRain();
        this.timer = RAIN_MIN + this.rng() * (RAIN_MAX - RAIN_MIN);
      }
    }
    if (!this.raining) return;
    this.rain.position.set(focusPos.x, 0, focusPos.z);
    const positions = this.positions;
    for (let i = 0; i < DROPS; i += 1) {
      positions[i * 3 + 1] -= FALL * dt;
      if (positions[i * 3 + 1] >= 0) continue;
      positions[i * 3 + 1] = HEIGHT;
      positions[i * 3] = (this.rng() - 0.5) * AREA;
      positions[i * 3 + 2] = (this.rng() - 0.5) * AREA;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;
  }
}