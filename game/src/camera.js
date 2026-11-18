// Third-person chase camera: sits behind the player (or the car) and swings
// smoothly after them instead of snapping. Dragging the mouse adds a yaw
// offset that eases back to straight behind once the drag ends.
import * as THREE from 'three';

const CAMERA_DISTANCE_ON_FOOT = 7.5;
const CAMERA_HEIGHT_ON_FOOT = 3.4;
const CAMERA_DISTANCE_DRIVING = 9;
const CAMERA_HEIGHT_DRIVING = 3.6;
const FOLLOW_STIFFNESS = 4.5;

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.yaw = Math.PI;
    this.yawOffset = 0;
    this.currentPosition = new THREE.Vector3(0, 6, 14);
  }

  update(dt, targetPosition, targetHeading, driving, input) {
    this.yawOffset += input.dragDeltaX * 0.005;
    this.yawOffset = Math.max(-1.2, Math.min(1.2, this.yawOffset));
    if (!input.dragging) this.yawOffset *= Math.max(0, 1 - dt * 1.5);

    // The camera wants to sit behind the target's heading, offset by the drag.
    let wantedYaw = targetHeading + Math.PI + this.yawOffset;
    let delta = wantedYaw - this.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.yaw += delta * Math.min(1, dt * FOLLOW_STIFFNESS);

    const distance = driving ? CAMERA_DISTANCE_DRIVING : CAMERA_DISTANCE_ON_FOOT;
    const height = driving ? CAMERA_HEIGHT_DRIVING : CAMERA_HEIGHT_ON_FOOT;
    const wanted = new THREE.Vector3(
      targetPosition.x + Math.sin(this.yaw) * distance,
      targetPosition.y + height,
      targetPosition.z + Math.cos(this.yaw) * distance,
    );
    this.currentPosition.lerp(wanted, Math.min(1, dt * FOLLOW_STIFFNESS));
    // Never dip under the street.
    this.currentPosition.y = Math.max(1.6, this.currentPosition.y);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(targetPosition.x, targetPosition.y + 1.6, targetPosition.z);
  }
}
