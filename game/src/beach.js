import * as THREE from 'three';
import { buildWalkerMesh, createLifeguard } from './pedestrians.js';
import { densityForMinute } from './city.js';
import { pick, range } from './random.js';
import { loadProp } from './models_loader.js';

// Sunbathers fill the sand ring around the city: some nap on towels,
// some face the water, some wander the waterline. Their numbers track
// the same day-night density curve as street walkers (up to 16 at
// midday), and they never teleport — each one strolls in from the
// nearest city rim to its spot, and strolls back out when it leaves.
const SUNBATHER_TOTAL = 16;
const TOWN_RIM = 266, WATER_LINE = 304;
const TOWEL_PALETTE = [0xff5a7a, 0x2ad0c4, 0xffc828, 0x7affc4, 0xff7a3d, 0x9a5fd0, 0x2a7ad0];
const SKIN_TONES = [0xe8b07a, 0xd9a077, 0xc98a5a, 0xf2c89a];
const HAIR_TONES = [0x241a2a, 0x201510, 0xe8a33d, 0x5a3a28];

// One entry per side of the square map: which axis the shoreline runs
// along, and which way is out to sea.
const SHORE_SIDES = [
  { axis: 'z', outward: -1 },
  { axis: 'z', outward: 1 },
  { axis: 'x', outward: -1 },
  { axis: 'x', outward: 1 },
];

// Yaw that faces the open water, indexed by side.
const SEA_FACING = [Math.PI, 0, -Math.PI / 2, Math.PI / 2];

// Pose picked by a single roll: lying under 0.35, standing under 0.55,
// strolling under 0.8, otherwise swimming by day or standing by night.
const POSE_BANDS = [
  { below: 0.35, pose: 'lying' },
  { below: 0.55, pose: 'standing' },
  { below: 0.8, pose: 'strolling' },
];

function pickSpot(rng, inWater) {
  const side = Math.floor(rng() * 4);
  const along = range(rng, -250, 250);
  // Swimmers wade 2-6m past the waterline (knee-deep); everyone else
  // claims a patch of sand 4-30m out from the city rim.
  const depth = inWater ? range(rng, 2, 6) : range(rng, 4, 30);
  const base = inWater ? WATER_LINE : TOWN_RIM;
  const cfg = SHORE_SIDES[side];
  const out = cfg.outward * (base + depth);
  const rim = cfg.outward * TOWN_RIM;
  const onX = cfg.axis === 'x';
  return {
    x: onX ? out : along,
    z: onX ? along : out,
    side,
    y: inWater ? -0.25 : 0,
    edge: { x: onX ? rim : along, z: onX ? along : rim },
  };
}

export class Beachgoers {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.target = SUNBATHER_TOTAL;
    this.minutes = 18 * 60 + 50;
    this.people = [];
    this._plantUmbrellas();
    for (let i = 0; i < SUNBATHER_TOTAL; i += 1) this.people.push(this._spawnSunbather());
    // The beach opens already busy at the daytime headcount; setDensity
    // rebalances from here on.
    for (const person of this.people) this.arrive(person, true);
    this._anchorBoats();
    this._postLifeguards();
  }

  _plantUmbrellas() {
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xf2f0e8 });
    const canopyGeo = new THREE.ConeGeometry(1.7, 0.9, 8);
    // Keep the umbrellas off the basketball court at the south rim.
    const court = { x: -100, z: 286, clear: 20 };
    for (let done = 0; done < 10;) {
      const s = pickSpot(this.rng);
      if (Math.hypot(s.x - court.x, s.z - court.z) < court.clear) continue;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(s.x, 1.2, s.z);
      const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshLambertMaterial({ color: pick(this.rng, TOWEL_PALETTE) }));
      canopy.position.set(s.x, 2.6, s.z);
      this.scene.add(pole, canopy);
      done += 1;
    }
  }

  _spawnSunbather() {
    const rng = this.rng;
    const mesh = buildWalkerMesh(
      pick(rng, TOWEL_PALETTE),
      pick(rng, TOWEL_PALETTE),
      pick(rng, SKIN_TONES),
      pick(rng, HAIR_TONES),
      'none',
      range(rng, 0.9, 1.05),
    );
    const towel = new THREE.Mesh(
      new THREE.BoxGeometry(1.8, 0.04, 0.8),
      new THREE.MeshLambertMaterial({ color: pick(rng, TOWEL_PALETTE) }),
    );
    towel.visible = false;
    this.scene.add(towel);
    this.scene.add(mesh.group);
    const person = {
      mesh, towel,
      pose: 'standing', state: 'dormant',
      spot: null, edge: null,
      strollDir: 1, walkPhase: rng() * 6,
      beach: true, knockedTimer: 0,
    };
    mesh.group.visible = false;
    return person;
  }

  _anchorBoats() {
    // Two speedboats moored by the yacht, rocking on the swell. They
    // arrive asynchronously; if the load fails the water stays empty.
    this.boats = [];
    const moorings = [
      { x: 208, z: 398, yaw: 0.5 },
      { x: 256, z: 366, yaw: -0.4 },
    ];
    for (const m of moorings) {
      loadProp('speedboat').then((boat) => {
        boat.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        boat.name = 'glb-speedboat';
        boat.position.set(m.x, -0.15, m.z);
        boat.rotation.y = m.yaw;
        this.scene.add(boat);
        this.boats.push({ group: boat, phase: this.rng() * 6 });
      }).catch(() => {});
    }
  }

  _postLifeguards() {
    // Two guards on the south sand — one by the courts, one mid-beach —
    // both watching the water from a fixed spot.
    this.lifeguards = [];
    const posts = [
      { x: -92, z: 343 },
      { x: 0, z: 340 },
    ];
    for (const post of posts) {
      const guard = createLifeguard(this.scene, post.x, post.z);
      guard.group.rotation.y = 0;
      this.lifeguards.push(guard);
    }
  }

  get activeCount() {
    let awake = 0;
    for (const p of this.people) if (p.state !== 'dormant') awake += 1;
    return awake;
  }

  setDensity(minutes) {
    this.minutes = minutes;
    const scaled = Math.round(SUNBATHER_TOTAL * densityForMinute(minutes));
    this.target = scaled < 0 ? 0 : scaled;
  }

  isNight() {
    const day = this.minutes - Math.floor(this.minutes / 1440) * 1440;
    return day >= 1170 || day < 300;
  }

  arrive(person, instant = false) {
    const roll = this.rng();
    person.knockedTimer = 0;
    let pose = this.isNight() ? 'standing' : 'swimming';
    for (const band of POSE_BANDS) {
      if (roll < band.below) { pose = band.pose; break; }
    }
    person.pose = pose;
    const spot = pickSpot(this.rng, pose === 'swimming');
    person.spot = spot;
    person.edge = spot.edge;
    person.strollDir = this.rng() < 0.5 ? -1 : 1;
    person.mesh.group.visible = true;
    if (instant) {
      person.mesh.group.position.set(spot.x, 0, spot.z);
      this.settle(person);
    } else {
      person.state = 'arrive';
      person.mesh.group.position.set(spot.edge.x, 0, spot.edge.z);
      person.mesh.group.rotation.x = 0;
      person.towel.visible = false;
    }
  }

  _freezeLimbs(mesh) {
    mesh.legLeft.rotation.x = 0;
    mesh.legRight.rotation.x = 0;
    mesh.armLeft.rotation.x = 0;
    mesh.armRight.rotation.x = 0;
  }

  settle(person) {
    person.state = person.pose;
    const g = person.mesh.group;
    g.rotation.x = 0;
    const sideways = [0, Math.PI / 2][person.spot.side % 2];
    if (person.pose === 'lying') {
      person.towel.position.set(person.spot.x, 0.02, person.spot.z);
      person.towel.rotation.y = sideways;
      person.towel.visible = true;
      g.position.set(person.spot.x, 0.15, person.spot.z);
      g.rotation.x = Math.PI / 2;
      g.rotation.y = sideways;
      this._freezeLimbs(person.mesh);
    } else if (person.pose === 'swimming') {
      // Flat on the water, facing out to sea.
      person.towel.visible = false;
      g.position.y = -0.25;
      g.rotation.x = 1.2;
      g.rotation.y = SEA_FACING[person.spot.side];
      this._freezeLimbs(person.mesh);
    } else {
      person.towel.visible = false;
      // Upright, looking seaward; strollers face along the shore.
      const seaward = SEA_FACING[person.spot.side];
      g.rotation.y = person.pose === 'strolling' ? seaward + Math.PI / 2 : seaward;
    }
  }

  leave(person) {
    person.state = 'leave';
    person.knockedTimer = 0;
    person.towel.visible = false;
    person.mesh.group.rotation.x = 0;
  }

  // Flattened by a car or a blow: down for `seconds`, then up and off
  // the beach, the same as a fleeing street walker.
  knockDown(person, fromX, fromZ, seconds = 3) {
    person.knockedTimer = seconds;
    person.state = 'knocked';
    person.mesh.group.rotation.x = Math.PI / 2;
    person.mesh.group.position.y = 0.4;
  }

  knockDownLifeguard(lg, fromX, fromZ, seconds = 3) {
    lg.knockedTimer = seconds;
    lg.group.rotation.x = Math.PI / 2;
    lg.group.position.y = 0.4;
  }

  _swingLimbs(mesh, phase) {
    const swing = Math.sin(phase) * 0.5;
    mesh.legLeft.rotation.x = swing;
    mesh.legRight.rotation.x = -swing;
    mesh.armLeft.rotation.x = -swing;
    mesh.armRight.rotation.x = swing;
  }

  _walkToTarget(person, dt) {
    const g = person.mesh.group;
    const pos = g.position;
    const arriving = person.state === 'arrive';
    const target = arriving ? person.spot : person.edge;
    const dx = target.x - pos.x;
    const dz = target.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.5) {
      if (arriving) this.settle(person);
      else {
        person.state = 'dormant';
        g.visible = false;
      }
      return;
    }
    const step = Math.min(4 * dt, dist);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    // Ease down into the shallows heading out to swim; climb back up
    // to the sand on the way home.
    const floorY = arriving ? (person.spot.y || 0) : 0;
    pos.y += (floorY - pos.y) * Math.min(1, dt * 3);
    g.rotation.y = Math.atan2(dx, dz);
    person.walkPhase += dt * 9;
    this._swingLimbs(person.mesh, person.walkPhase);
  }

  _bounceAlong(person, dt, speed) {
    const g = person.mesh.group;
    const horizontal = person.spot.side < 2;
    const along = horizontal ? g.position.x : g.position.z;
    if (along > 305 || along < -305) person.strollDir *= -1;
    const step = speed * dt * person.strollDir;
    if (horizontal) g.position.x += step;
    else g.position.z += step;
    return horizontal;
  }

  _stroll(person, dt) {
    const horizontal = this._bounceAlong(person, dt, 2.5);
    const g = person.mesh.group;
    const forward = person.strollDir > 0;
    g.rotation.y = horizontal ? (forward ? Math.PI / 2 : -Math.PI / 2) : forward ? 0 : Math.PI;
    person.walkPhase += dt * 9;
    this._swingLimbs(person.mesh, person.walkPhase);
  }

  _swim(person, dt) {
    this._bounceAlong(person, dt, 0.8);
    person.walkPhase += dt * 3;
    const g = person.mesh.group;
    g.position.y = -0.25 + Math.sin(person.walkPhase) * 0.08;
    const paddle = Math.sin(person.walkPhase) * 0.9;
    person.mesh.armLeft.rotation.x = paddle;
    person.mesh.armRight.rotation.x = -paddle;
  }

  _stepPerson(person, dt) {
    if (person.state === 'dormant') return;
    if (person.state === 'knocked') {
      person.knockedTimer -= dt;
      if (person.knockedTimer <= 0) {
        person.knockedTimer = 0;
        this.leave(person);
      }
      return;
    }
    // No night swimming: anyone in the water heads for the sand.
    if (person.state === 'swimming' && this.isNight()) this.leave(person);
    if (person.state === 'arrive' || person.state === 'leave') this._walkToTarget(person, dt);
    else if (person.state === 'strolling') this._stroll(person, dt);
    else if (person.state === 'swimming') this._swim(person, dt);
    // LYING and STANDING hold still: the pose carries the scene.
  }

  _bobBoats(dt) {
    // Moored boats rock gently on the swell, like the swimmers.
    for (const b of this.boats) {
      b.phase += dt * 0.9;
      b.group.position.y = -0.15 + Math.sin(b.phase) * 0.12;
      b.group.rotation.z = Math.sin(b.phase * 0.7) * 0.03;
      b.group.rotation.x = Math.cos(b.phase * 0.5) * 0.02;
    }
  }

  _stepLifeguards(dt) {
    // A flattened guard climbs back to its feet in place. The Idle clip
    // plays while standing; it stays frozen while the guard is down, so
    // the body remains flat on the sand.
    for (const lg of this.lifeguards) {
      if (lg.knockedTimer) {
        lg.knockedTimer -= dt;
        if (lg.knockedTimer <= 0) {
          lg.knockedTimer = 0;
          lg.group.rotation.x = 0;
          lg.group.position.y = 0;
        }
      } else if (lg.mixer) {
        lg.mixer.update(dt);
      }
    }
  }

  _rebalance() {
    const awake = this.activeCount;
    if (awake < this.target) {
      for (const p of this.people) {
        if (p.state === 'dormant') { this.arrive(p); break; }
      }
    } else if (awake > this.target) {
      const present = [];
      for (const p of this.people) {
        if (p.state !== 'dormant' && p.state !== 'leave') present.push(p);
      }
      const chosen = present[Math.floor(this.rng() * present.length)];
      if (chosen) this.leave(chosen);
    }
  }

  update(dt) {
    this._bobBoats(dt);
    for (const person of this.people) this._stepPerson(person, dt);
    this._stepLifeguards(dt);
    this._rebalance();
  }
}
