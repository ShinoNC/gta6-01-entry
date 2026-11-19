import * as THREE from 'three';
import { wrapAngle } from './random.js';
const DIST_FOOT = 7.5, HEIGHT_FOOT = 3.4, DIST_DRIVE = 7.5, HEIGHT_DRIVE = 3.2;
const STIFFNESS = 4.5, RECOIL_KICK = 0.55;
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.currentPosition = new THREE.Vector3(0, 6, 14);
  }
  update(dt, targetPosition, targetHeading, driving, recoil = 0, lift = 0) {
    // No mouse-look: the camera always chases directly behind the heading,
    // on foot and in the car alike.
    this.yaw += wrapAngle(targetHeading + Math.PI - this.yaw) * Math.min(1, dt * STIFFNESS);
    const distance = driving ? DIST_DRIVE : DIST_FOOT;
    const height = driving ? HEIGHT_DRIVE : HEIGHT_FOOT;
    const wanted = new THREE.Vector3(targetPosition.x + Math.sin(this.yaw) * distance, targetPosition.y + height, targetPosition.z + Math.cos(this.yaw) * distance);
    // Pull the camera in when a building blocks the view (GTA-style): the
    // segment from the player to the wanted camera spot is tested against
    // the building boxes with the same 2D slab test police use for line of
    // sight. 2D is enough — every building is 8m+ tall and the segment
    // stays under 3.4m. Cars need no test: the tallest is ~1.8m, the
    // segment never drops below the player's head (1.6m), and the car
    // push-out keeps vehicles 2.6m from the on-foot player.
    let pull = 1;
    if (this.city) {
      const fx = targetPosition.x, fz = targetPosition.z;
      const dx = wanted.x - fx, dz = wanted.z - fz;
      for (const box of this.city.buildingBoxes) {
        let t0 = 0, t1 = 1;
        for (const [p, d, lo, hi] of [[fx, dx, box.minX, box.maxX], [fz, dz, box.minZ, box.maxZ]]) {
          if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) { t0 = 1; t1 = 0; break; } }
          else {
            let a = (lo - p) / d, b = (hi - p) / d;
            if (a > b) { const t = a; a = b; b = t; }
            t0 = Math.max(t0, a); t1 = Math.min(t1, b);
            if (t0 > t1) break;
          }
        }
        if (t0 <= t1 && t0 < pull) pull = t0;
      }
      // Unblocked (pull 1): full distance. Blocked: stop just short of the
      // wall (x0.9). The height scales with the pull so the look-down angle
      // stays a chase angle instead of going top-down as the camera closes
      // in — a minimum distance here would push the camera THROUGH the wall.
      const k = pull >= 1 ? 1 : Math.max(0.08, pull * 0.9);
      wanted.x = fx + dx * k;
      wanted.z = fz + dz * k;
      wanted.y = targetPosition.y + 1.6 + (height - 1.6) * k;
    }
    this.currentPosition.lerp(wanted, Math.min(1, dt * STIFFNESS));
    this.currentPosition.y = Math.max(1.6, this.currentPosition.y);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(targetPosition.x, targetPosition.y + 1.6 + recoil * RECOIL_KICK + lift, targetPosition.z);
  }
}