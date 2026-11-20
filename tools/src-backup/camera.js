import * as THREE from 'three';
import { wrapAngle } from './random.js';
const DIST_FOOT = 7.5, HEIGHT_FOOT = 3.4, DIST_DRIVE = 7.5, HEIGHT_DRIVE = 3.2;
const STIFFNESS = 4.5, RECOIL_KICK = 0.55;
const AIM_AHEAD_METRES = 12, AIM_BLEND_RATE = 4;
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.aimBlend = 0;
    this.currentPosition = new THREE.Vector3(0, 6, 14);
  }
  // Pull factor for a camera spot: 1 when the segment from the player to
  // the spot is clear, else the fraction of the segment just short of the
  // first wall (x0.9, min 0.08). Same 2D slab test police use for line of
  // sight. 2D is enough — every building is 8m+ tall and the segment
  // stays under 3.4m. Cars need no test: the tallest is ~1.8m, the
  // segment never drops below the player's head (1.6m), and the car
  // push-out keeps vehicles 2.6m from the on-foot player.
  pullFactor(fx, fz, tx, tz) {
    if (!this.city) return 1;
    const dx = tx - fx, dz = tz - fz;
    let pull = 1;
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
    return pull >= 1 ? 1 : Math.max(0.08, pull * 0.9);
  }
  update(dt, targetPosition, targetHeading, driving, recoil = 0, lift = 0, aiming = false) {
    // No mouse-look: the camera always chases directly behind the heading,
    // on foot and in the car alike.
    this.yaw += wrapAngle(targetHeading + Math.PI - this.yaw) * Math.min(1, dt * STIFFNESS);
    // Aiming (a gun equipped, on foot): the camera looks ahead of the
    // player instead of at them, so the character's head drops below
    // screen centre and the crosshair sits on the aim point, never on
    // the head. Blended, so switching weapons does not snap the view.
    this.aimBlend += ((aiming && !driving ? 1 : 0) - this.aimBlend) * Math.min(1, dt * AIM_BLEND_RATE);
    const distance = driving ? DIST_DRIVE : DIST_FOOT;
    const height = driving ? HEIGHT_DRIVE : HEIGHT_FOOT;
    const wanted = new THREE.Vector3(targetPosition.x + Math.sin(this.yaw) * distance, targetPosition.y + height, targetPosition.z + Math.cos(this.yaw) * distance);
    // Pull the wanted spot in when a building blocks the view (GTA-style).
    // The height scales with the pull so the look-down angle stays a chase
    // angle instead of going top-down as the camera closes in — a minimum
    // distance here would push the camera THROUGH the wall.
    const kw = this.pullFactor(targetPosition.x, targetPosition.z, wanted.x, wanted.z);
    wanted.x = targetPosition.x + (wanted.x - targetPosition.x) * kw;
    wanted.z = targetPosition.z + (wanted.z - targetPosition.z) * kw;
    wanted.y = targetPosition.y + 1.6 + (height - 1.6) * kw;
    this.currentPosition.lerp(wanted, Math.min(1, dt * STIFFNESS));
    // Clamp the LERPED position too: the lerp path itself can cross a wall
    // — a 180-degree turn in a 2m alley swings the camera straight through
    // the flanking buildings, and the screen goes solid wall-colour until
    // the lerp finishes. Clamping after the lerp keeps the rendered camera
    // on the player's side of every wall, every frame.
    const kc = this.pullFactor(targetPosition.x, targetPosition.z, this.currentPosition.x, this.currentPosition.z);
    if (kc < 1) {
      this.currentPosition.x = targetPosition.x + (this.currentPosition.x - targetPosition.x) * kc;
      this.currentPosition.z = targetPosition.z + (this.currentPosition.z - targetPosition.z) * kc;
    }
    this.currentPosition.y = Math.max(1.6, this.currentPosition.y);
    this.camera.position.copy(this.currentPosition);
    const ahead = this.aimBlend * AIM_AHEAD_METRES;
    this.camera.lookAt(
      targetPosition.x + Math.sin(targetHeading) * ahead,
      targetPosition.y + 1.6 - this.aimBlend * 0.1 + recoil * RECOIL_KICK + lift,
      targetPosition.z + Math.cos(targetHeading) * ahead,
    );
  }
}