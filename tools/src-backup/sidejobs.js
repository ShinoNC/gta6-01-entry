import * as THREE from 'three';
import { roadLines, districtNameAt } from './city.js';
import { buildWalkerMesh } from './pedestrians.js';
import { buildBeacon } from './missions.js';
const DISCOVER = 40, AVOID = 60, PICKUP = 8, PKG_PICKUP = 4, DROP = 10, MIN_TRIP = 80, HINT_CD = 5;
function roadside(rng) {
  const lines = roadLines(), line = lines[(rng() * lines.length) | 0];
  const along = line.from + rng() * (line.to - line.from), side = (rng() < 0.5 ? -1 : 1) * 7.6;
  return line.axis === 'z' ? { x: line.at + side, z: along } : { x: along, z: line.at + side };
}
export class SideJobs {
  constructor(scene, rng, callbacks) {
    this.rng = rng;
    this.callbacks = callbacks;
    this.job = null;
    this.clock = 0;
    this.hintAt = -99;
    this.forcedType = null;
    this.avoid = { x: 0, z: 0 };
    this.beacon = buildBeacon(scene, 0x7affc4);
    this.passenger = buildWalkerMesh(0xffd978, 0x2a4a8a, 0xe8b07a, 0x4a2a1a, null, 1);
    this.passenger.armLeft.rotation.z = 2.4;
    this.passenger.group.visible = false;
    scene.add(this.passenger.group);
    this.taxiMarker = new THREE.Mesh(new THREE.OctahedronGeometry(0.4), new THREE.MeshBasicMaterial({ color: 0xffc828 }));
    this.taxiMarker.visible = false;
    scene.add(this.taxiMarker);
    this.package = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.6, 0.8), new THREE.MeshLambertMaterial({ color: 0xb08a4a }));
    box.position.y = 0.3;
    const tape = new THREE.Mesh(new THREE.BoxGeometry(0.84, 0.12, 0.84), new THREE.MeshLambertMaterial({ color: 0xffd978 }));
    tape.position.y = 0.62;
    this.package.add(box, tape);
    this.package.visible = false;
    scene.add(this.package);
    this.offerJob(true);
  }
  offerJob(hidden) {
    const type = this.forcedType || (this.rng() < 0.5 ? 'taxi' : 'delivery');
    this.forcedType = null;
    let pickup = roadside(this.rng), guard = 0;
    while (Math.hypot(pickup.x - this.avoid.x, pickup.z - this.avoid.z) < AVOID && guard < 20) {
      pickup = roadside(this.rng);
      guard += 1;
    }
    let dropoff = roadside(this.rng);
    guard = 0;
    while (Math.hypot(dropoff.x - pickup.x, dropoff.z - pickup.z) < MIN_TRIP && guard < 20) {
      dropoff = roadside(this.rng);
      guard += 1;
    }
    const distance = Math.hypot(dropoff.x - pickup.x, dropoff.z - pickup.z);
    const rewardMoney = type === 'taxi' ? Math.min(150, Math.round(50 + distance * 0.5)) : Math.min(200, Math.round(75 + distance * 0.6));
    this.job = { type, stage: 'pickup', pickup, dropoff, rewardMoney, rewardRep: type === 'taxi' ? 10 : 15, discovered: !hidden };
    if (hidden) this.showPickupHidden();
    else {
      this.showPickup();
      this.callbacks.onOffered(this.job);
    }
  }
  showPickupHidden() {
    const { pickup, type } = this.job;
    if (type === 'taxi') {
      this.passenger.group.position.set(pickup.x, 0, pickup.z);
      this.passenger.group.visible = true;
    } else {
      this.package.position.set(pickup.x, 0, pickup.z);
      this.package.visible = true;
    }
  }
  discover() {
    this.job.discovered = true;
    this.showPickup();
    this.callbacks.onOffered(this.job);
  }
  showPickup() {
    const { pickup, type } = this.job;
    this.beacon.group.position.set(pickup.x, 0, pickup.z);
    this.beacon.group.visible = true;
    if (type === 'taxi') {
      this.passenger.group.position.set(pickup.x, 0, pickup.z);
      this.passenger.group.visible = true;
      this.taxiMarker.position.set(pickup.x, 3, pickup.z);
      this.taxiMarker.visible = true;
    } else {
      this.package.position.set(pickup.x, 0, pickup.z);
      this.package.visible = true;
    }
  }
  showDropoff() {
    const { dropoff } = this.job;
    this.beacon.group.position.set(dropoff.x, 0, dropoff.z);
    this.beacon.group.visible = true;
    this.passenger.group.visible = false;
    this.taxiMarker.visible = false;
    this.package.visible = false;
  }
  hideAll() {
    this.beacon.group.visible = false;
    this.passenger.group.visible = false;
    this.taxiMarker.visible = false;
    this.package.visible = false;
  }
  completeJob() {
    const finished = this.job;
    this.job = null;
    this.hideAll();
    this.callbacks.onComplete(finished);
    this.offerJob(true);
  }
  forceJob(type) {
    this.forcedType = type;
    if (this.job) {
      this.job = null;
      this.hideAll();
    }
    this.offerJob(false);
  }
  get target() {
    if (!this.job || !this.job.discovered) return null;
    return this.job.stage === 'pickup' ? this.job.pickup : this.job.dropoff;
  }
  objectiveLine() {
    if (!this.job || !this.job.discovered) return null;
    const { type, stage, pickup, dropoff, rewardMoney } = this.job;
    if (type === 'taxi') {
      return stage === 'pickup'
        ? `TAXI — Pick up the fare at ${districtNameAt(pickup.x, pickup.z)}`
        : `TAXI — Drop the fare at ${districtNameAt(dropoff.x, dropoff.z)} ($${rewardMoney})`;
    }
    return stage === 'pickup'
      ? `DELIVERY — Collect the package at ${districtNameAt(pickup.x, pickup.z)}`
      : `DELIVERY — Deliver to ${districtNameAt(dropoff.x, dropoff.z)} ($${rewardMoney})`;
  }
  statusLine() {
    if (!this.job || !this.job.discovered) return null;
    return this.job.type === 'taxi' ? 'SIDE JOB — TAXI FARE' : 'SIDE JOB — DELIVERY RUN';
  }
  update(dt, context) {
    this.clock += dt;
    const { focusPos, driving } = context;
    this.avoid = focusPos;
    if (!this.job) return;
    const job = this.job;
    if (!job.discovered) {
      if (Math.hypot(focusPos.x - job.pickup.x, focusPos.z - job.pickup.z) < DISCOVER) this.discover();
      return;
    }
    this.beacon.pillar.material.opacity = 0.55 + 0.2 * Math.sin(this.clock * 3);
    if (this.taxiMarker.visible) {
      this.taxiMarker.rotation.y += dt * 2;
      this.taxiMarker.position.y = 3 + Math.sin(this.clock * 2) * 0.15;
    }
    if (job.stage === 'pickup') {
      const reach = job.type === 'taxi' ? PICKUP : PKG_PICKUP;
      if (Math.hypot(focusPos.x - job.pickup.x, focusPos.z - job.pickup.z) >= reach) return;
      if (job.type === 'taxi' && !driving) {
        if (this.clock - this.hintAt > HINT_CD) {
          this.hintAt = this.clock;
          this.callbacks.onNeedCar();
        }
        return;
      }
      job.stage = 'dropoff';
      this.showDropoff();
      this.callbacks.onPickedUp(job);
      return;
    }
    if (Math.hypot(focusPos.x - job.dropoff.x, focusPos.z - job.dropoff.z) < DROP) this.completeJob();
  }
}
