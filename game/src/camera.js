// Third-person chase camera: sits behind the player (or the car) and swings
// smoothly after them instead of snapping. Dragging the mouse adds a yaw
// offset that eases back to straight behind once the drag ends. Gunfire
// kicks the aim point up briefly (recoil), which sells the shot; the lift
// raises the aim point while the police helicopter is overhead, so the
// airframe stays in frame during a high-heat chase.
import * as THREE from 'three';

const CAMERA_DISTANCE_ON_FOOT = 7.5;
const CAMERA_HEIGHT_ON_FOOT = 3.4;
const CAMERA_DISTANCE_DRIVING = 9;
const CAMERA_HEIGHT_DRIVING = 3.6;
const FOLLOW_STIFFNESS = 4.5;
const RECOIL_KICK_METRES = 0.55;

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    // Start BEHIND the player (player spawns facing north, heading PI, so
    // behind is yaw 0). Starting at PI swung the camera 180 degrees on the
    // first frames of play and flipped the W key's direction at spawn.
    this.yaw = 0;
    this.yawOffset = 0;
    this.currentPosition = new THREE.Vector3(0, 6, 14);
  }

  update(dt, targetPosition, targetHeading, driving, input, recoil = 0, lift = 0) {
    this.yawOffset += input.dragDeltaX * 0.005;
    this.yawOffset = Math.max(-1.2, Math.min(1.2, this.yawOffset));
    if (!input.dragging) this.yawOffset *= Math.max(0, 1 - dt * 1.5);

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
    this.currentPosition.y = Math.max(1.6, this.currentPosition.y);
    this.camera.position.copy(this.currentPosition);
    this.camera.lookAt(targetPosition.x, targetPosition.y + 1.6 + recoil * RECOIL_KICK_METRES + lift, targetPosition.z);
  }
}
