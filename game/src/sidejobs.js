// Odd jobs around the city: a taxi fare waiting at the kerb, or a parcel
// someone needs carried across town. A job sits undiscovered until the
// player wanders close to its pickup point, then the beacon marks it and
// the HUD names the destination. Fares only board when the player drives
// up; parcels can be collected on foot.
import * as THREE from 'three';
import { roadLines, districtNameAt } from './city.js';
import { buildWalkerMesh } from './pedestrians.js';
import { buildBeacon, fadeBeacon } from './missions.js';

// Tuning for the job loop: discovery radius, how far a fresh pickup must
// sit from the player, pickup reach per job kind, drop-off reach, the
// shortest trip worth offering, and the gap between "need a car" hints.
const TUNE = {
  discover: 40,
  clearOfPlayer: 60,
  fareReach: 8,
  parcelReach: 4,
  dropReach: 10,
  minTrip: 80,
  hintGap: 5,
};

// Pay table per job kind: a flat base plus a per-metre rate, capped, and
// the reputation the completed job is worth.
const PAY = {
  taxi: { base: 50, rate: 0.5, cap: 150, rep: 10 },
  delivery: { base: 75, rate: 0.6, cap: 200, rep: 15 },
};

const KERB = 7.6;
const MAX_TRIES = 20;

// A random point beside a random road: pick a road line, walk along it,
// then step off to one kerb or the other. Consumes three rng draws.
function kerbsideSpot(rng) {
  const roads = roadLines();
  const road = roads[(rng() * roads.length) | 0];
  const along = road.from + rng() * (road.to - road.from);
  const off = (rng() < 0.5 ? -1 : 1) * KERB;
  if (road.axis === 'z') return { x: road.at + off, z: along };
  return { x: along, z: road.at + off };
}

function gap(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
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
    this.passenger = this.makePassenger(scene);
    this.taxiMarker = this.makeMarker(scene);
    this.package = this.makeParcel(scene);
    this.offerJob(true);
  }

  makePassenger(scene) {
    const walker = buildWalkerMesh(0xffd978, 0x2a4a8a, 0xe8b07a, 0x4a2a1a, null, 1);
    walker.armLeft.rotation.z = 2.4;
    walker.group.visible = false;
    scene.add(walker.group);
    return walker;
  }

  makeMarker(scene) {
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.4),
      new THREE.MeshBasicMaterial({ color: 0xffc828 }),
    );
    gem.visible = false;
    scene.add(gem);
    return gem;
  }

  makeParcel(scene) {
    const parcel = new THREE.Group();
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.6, 0.8),
      new THREE.MeshLambertMaterial({ color: 0xb08a4a }),
    );
    crate.position.y = 0.3;
    const strap = new THREE.Mesh(
      new THREE.BoxGeometry(0.84, 0.12, 0.84),
      new THREE.MeshLambertMaterial({ color: 0xffd978 }),
    );
    strap.position.y = 0.62;
    parcel.add(crate, strap);
    parcel.visible = false;
    scene.add(parcel);
    return parcel;
  }

  // Deal a fresh job: pick a kind (or honour a forced one), then roll a
  // pickup clear of the player and a drop-off a decent trip away.
  offerJob(hidden) {
    const kind = this.forcedType || (this.rng() < 0.5 ? 'taxi' : 'delivery');
    this.forcedType = null;
    let pickup = kerbsideSpot(this.rng);
    for (let tries = 0; gap(pickup, this.avoid) < TUNE.clearOfPlayer && tries < MAX_TRIES; tries++) {
      pickup = kerbsideSpot(this.rng);
    }
    let dropoff = kerbsideSpot(this.rng);
    for (let tries = 0; gap(dropoff, pickup) < TUNE.minTrip && tries < MAX_TRIES; tries++) {
      dropoff = kerbsideSpot(this.rng);
    }
    const pay = PAY[kind];
    const trip = gap(dropoff, pickup);
    this.job = {
      type: kind,
      stage: 'pickup',
      pickup,
      dropoff,
      rewardMoney: Math.min(pay.cap, Math.round(pay.base + trip * pay.rate)),
      rewardRep: pay.rep,
      discovered: !hidden,
    };
    if (hidden) this.placePickupProps();
    else {
      this.showPickup();
      this.callbacks.onOffered(this.job);
    }
  }

  // Put the pickup props (waiting fare or parcel) at the pickup point,
  // without lighting the beacon — the undiscovered state.
  placePickupProps() {
    const at = this.job.pickup;
    if (this.job.type === 'taxi') {
      this.passenger.group.position.set(at.x, 0, at.z);
      this.passenger.group.visible = true;
      return;
    }
    this.package.position.set(at.x, 0, at.z);
    this.package.visible = true;
  }

  discover() {
    this.job.discovered = true;
    this.showPickup();
    this.callbacks.onOffered(this.job);
  }

  showPickup() {
    const at = this.job.pickup;
    this.beacon.group.position.set(at.x, 0, at.z);
    this.beacon.group.visible = true;
    this.placePickupProps();
    if (this.job.type !== 'taxi') return;
    this.taxiMarker.position.set(at.x, 3, at.z);
    this.taxiMarker.visible = true;
  }

  showDropoff() {
    const at = this.job.dropoff;
    this.beacon.group.position.set(at.x, 0, at.z);
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
    const done = this.job;
    this.job = null;
    this.hideAll();
    this.callbacks.onComplete(done);
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
    const job = this.job;
    const where = districtNameAt(
      job.stage === 'pickup' ? job.pickup.x : job.dropoff.x,
      job.stage === 'pickup' ? job.pickup.z : job.dropoff.z,
    );
    if (job.type === 'taxi') {
      if (job.stage === 'pickup') return 'TAXI — Pick up the fare at ' + where;
      return 'TAXI — Drop the fare at ' + where + ' ($' + job.rewardMoney + ')';
    }
    if (job.stage === 'pickup') return 'DELIVERY — Collect the package at ' + where;
    return 'DELIVERY — Deliver to ' + where + ' ($' + job.rewardMoney + ')';
  }

  statusLine() {
    if (!this.job || !this.job.discovered) return null;
    return this.job.type === 'taxi' ? 'SIDE JOB — TAXI FARE' : 'SIDE JOB — DELIVERY RUN';
  }

  update(dt, context) {
    this.clock += dt;
    const focus = context.focusPos;
    this.avoid = focus;
    if (!this.job) return;
    if (!this.job.discovered) {
      if (gap(focus, this.job.pickup) < TUNE.discover) this.discover();
      return;
    }
    const beaconPos = this.beacon.group.position;
    fadeBeacon(this.beacon, gap(focus, { x: beaconPos.x, z: beaconPos.z }), this.clock);
    this.spinMarker(dt);
    if (this.job.stage === 'pickup') this.tryPickup(context.driving, focus);
    else if (gap(focus, this.job.dropoff) < TUNE.dropReach) this.completeJob();
  }

  spinMarker(dt) {
    if (!this.taxiMarker.visible) return;
    this.taxiMarker.rotation.y += dt * 2;
    this.taxiMarker.position.y = 3 + Math.sin(this.clock * 2) * 0.15;
  }

  tryPickup(driving, focus) {
    const job = this.job;
    const reach = job.type === 'taxi' ? TUNE.fareReach : TUNE.parcelReach;
    if (gap(focus, job.pickup) >= reach) return;
    if (job.type === 'taxi' && !driving) {
      if (this.clock - this.hintAt > TUNE.hintGap) {
        this.hintAt = this.clock;
        this.callbacks.onNeedCar();
      }
      return;
    }
    job.stage = 'dropoff';
    this.showDropoff();
    this.callbacks.onPickedUp(job);
  }
}
