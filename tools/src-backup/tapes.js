import * as THREE from 'three';
import { roadLines } from './city.js';
export const TAPE_COUNT = 40;
const TAPE_PICKUP_METRES = 3.5;
export class Tapes {
  constructor(scene, rng) {
    this.tapes = [];
    const lines = roadLines();
    const geometry = new THREE.OctahedronGeometry(0.42);
    const material = new THREE.MeshBasicMaterial({ color: 0xff6bd6 });
    for (let i = 0; i < TAPE_COUNT; i += 1) {
      const line = lines[Math.floor(rng() * lines.length)];
      const along = line.from + rng() * (line.to - line.from);
      const side = (rng() < 0.5 ? -1 : 1) * 6.5;
      const x = line.axis === 'z' ? line.at + side : along;
      const z = line.axis === 'z' ? along : line.at + side;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, 1.2, z);
      scene.add(mesh);
      this.tapes.push({ mesh, x, z, taken: false });
    }
    this.collected = 0;
  }
  setCollected(count) {
    for (let i = 0; i < this.tapes.length; i += 1) {
      if (i >= count) break;
      this.tapes[i].taken = true;
      this.tapes[i].mesh.visible = false;
    }
    this.collected = Math.min(count, this.tapes.length);
  }
  update(dt, focusPos, onPickup) {
    if (this.collected >= TAPE_COUNT) return;
    for (const tape of this.tapes) {
      if (tape.taken) continue;
      tape.mesh.rotation.y += dt * 2;
      tape.mesh.position.y = 1.2 + Math.sin(performance.now() / 300 + tape.x) * 0.15;
      if (Math.hypot(focusPos.x - tape.x, focusPos.z - tape.z) < TAPE_PICKUP_METRES) {
        tape.taken = true;
        tape.mesh.visible = false;
        this.collected += 1;
        onPickup(this.collected);
      }
    }
  }
}