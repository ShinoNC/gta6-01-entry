import * as THREE from 'three';
import { wrapAngle } from './random.js';
const DIST_FOOT = 7.5, HEIGHT_FOOT = 3.4, DIST_DRIVE = 7.5, HEIGHT_DRIVE = 3.2;
const STIFFNESS = 4.5, RECOIL_KICK = 0.55;
export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = 0;
    this.yawOffset = 0;
    this.currentPosition = new THREE.Vector3(0, 6, 14);
  }
  update(dt, targetPosition, targetHeading, driving, input, recoil = 0, lift = 0) {
    this.yawOffset += input.dragDeltaX * 0.005;
    this.yawOffset = Math.max(-1.2, Math.min(1.2, this.yawOffset));
    if (!input.dragging && !input.locked) this.yawOffset *= Math.max(0, 1 - dt * 1.5);
    this.yaw += wrapAngle(targetHeading + Math.PI + this.yawOffset - this.yaw) * Math.min(1, dt * STIFFNESS);
    const distance = driving ? DIST_DRIVE : DIST_FOOT;
    const height = driving ? HEIGHT_DRIVE : HEIGHT_FOOT;
    const wanted = new THREE.Vector3(targetPosition.x + Math.sin(this.yaw) * distance, targetPosition.y + height, targetPosition.z + Math.cos(this.yaw) * distance);
    this.currentPosition.lerp(wanted, Math.min(1, dt * STIFFNESS));
    this.currentPosition.y = Math.max(1.6, this.currentPosition.y);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(targetPosition.x, targetPosition.y + 1.6 + recoil * RECOIL_KICK + lift, targetPosition.z);
  }
}