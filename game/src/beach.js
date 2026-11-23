import * as THREE from 'three';
import { buildWalkerMesh, createLifeguard } from './pedestrians.js';
import { densityForMinute } from './city.js';
import { pick, range } from './random.js';
import { loadProp } from './models_loader.js';
// Beachgoers on the sand ring: some lie on towels, some stand facing the
// sea, some stroll along the shore. They follow the night-density rule
// like street peds (target = 16 x density) and never pop: they walk in
// from the city edge to their spot and walk back out when they leave.
const BEACHGOER_COUNT = 16;
const CITY_EDGE = 266, SHORELINE = 304;
const BEACH_COLOURS = [0xff5a7a, 0x2ad0c4, 0xffc828, 0x7affc4, 0xff7a3d, 0x9a5fd0, 0x2a7ad0];
const SKIN_COLOURS = [0xe8b07a, 0xd9a077, 0xc98a5a, 0xf2c89a];
const HAIR_COLOURS = [0x241a2a, 0x201510, 0xe8a33d, 0x5a3a28];
function randomSpot(rng, swim = false) {
  const side = Math.floor(rng() * 4);
  const along = range(rng, -250, 250);
  // Swimmers sit 2-6m past the shoreline (0.4-1.2m of water); everyone
  // else is on the sand ring, 4-30m from the city edge.
  const depth = swim ? range(rng, 2, 6) : range(rng, 4, 30);
  const base = swim ? SHORELINE : CITY_EDGE;
  if (side === 0) return { x: along, z: -base - depth, side, y: swim ? -0.25 : 0, edge: { x: along, z: -CITY_EDGE } };
  if (side === 1) return { x: along, z: base + depth, side, y: swim ? -0.25 : 0, edge: { x: along, z: CITY_EDGE } };
  if (side === 2) return { x: -base - depth, z: along, side, y: swim ? -0.25 : 0, edge: { x: -CITY_EDGE, z: along } };
  return { x: base + depth, z: along, side, y: swim ? -0.25 : 0, edge: { x: CITY_EDGE, z: along } };
}
export class Beachgoers {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.target = BEACHGOER_COUNT;
    this.minutes = 18 * 60 + 50;
    this.people = [];
    // Beach umbrellas: pole + colourful cone canopy, scattered near the
    // towels (kept clear of the basketball court at (-100, 338)).
    const poleGeo = new THREE.CylinderGeometry(0.06, 0.06, 2.4, 5);
    const poleMat = new THREE.MeshLambertMaterial({ color: 0xf2f0e8 });
    const canopyGeo = new THREE.ConeGeometry(1.7, 0.9, 8);
    let placed = 0;
    while (placed < 10) {
      const s = randomSpot(rng);
      if (Math.hypot(s.x + 100, s.z - 286) < 20) continue;
      const pole = new THREE.Mesh(poleGeo, poleMat);
      pole.position.set(s.x, 1.2, s.z);
      const canopy = new THREE.Mesh(canopyGeo, new THREE.MeshLambertMaterial({ color: pick(rng, BEACH_COLOURS) }));
      canopy.position.set(s.x, 2.6, s.z);
      scene.add(pole, canopy);
      placed += 1;
    }
    for (let i = 0; i < BEACHGOER_COUNT; i += 1) {
      const mesh = buildWalkerMesh(pick(rng, BEACH_COLOURS), pick(rng, BEACH_COLOURS), pick(rng, SKIN_COLOURS), pick(rng, HAIR_COLOURS), 'none', range(rng, 0.9, 1.05));
      const towel = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.04, 0.8),
        new THREE.MeshLambertMaterial({ color: pick(rng, BEACH_COLOURS) }),
      );
      towel.visible = false;
      scene.add(towel);
      scene.add(mesh.group);
      this.people.push({ mesh, towel, state: 'dormant', spot: null, edge: null, pose: 'standing', strollDir: 1, walkPhase: rng() * 6, beach: true, knockedTimer: 0 });
      mesh.group.visible = false;
    }
    // Start populated at the daytime target; setDensity rebalances after.
    for (let i = 0; i < BEACHGOER_COUNT; i += 1) this.arrive(this.people[i], true);
    // Speedboats anchored near the yacht (230,328): two Vinish GLBs,
    // gently bobbing. They load async; on failure the sea is just empty.
    this.boats = [];
    for (const [bx, bz, rot] of [[208, 398, 0.5], [256, 366, -0.4]]) {
      loadProp('speedboat').then((boat) => {
        boat.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        boat.name = 'glb-speedboat';
        boat.position.set(bx, -0.15, bz);
        boat.rotation.y = rot;
        scene.add(boat);
        this.boats.push({ group: boat, phase: this.rng() * 6 });
      }).catch(() => {});
    }
    // Lifeguards on the south sand: one by the basketball court, one
    // mid-beach — both facing the sea, idling on the spot.
    this.lifeguards = [];
    for (const [lx, lz] of [[-92, 343], [0, 340]]) {
      const lg = createLifeguard(scene, lx, lz);
      lg.group.rotation.y = 0;
      this.lifeguards.push(lg);
    }
  }
  get activeCount() {
    return this.people.filter((p) => p.state !== 'dormant').length;
  }
  setDensity(minutes) {
    this.minutes = minutes;
    this.target = Math.max(0, Math.round(BEACHGOER_COUNT * densityForMinute(minutes)));
  }
  isNight() {
    const m = ((this.minutes % 1440) + 1440) % 1440;
    return m >= 1170 || m < 300;
  }
  arrive(person, instant = false) {
    // Swimmers are daytime only — nobody is in the water at night.
    const roll = this.rng();
    person.knockedTimer = 0;
    person.pose = roll < 0.35 ? 'lying' : roll < 0.55 ? 'standing' : roll < 0.8 ? 'strolling' : this.isNight() ? 'standing' : 'swimming';
    const spot = randomSpot(this.rng, person.pose === 'swimming');
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
  settle(person) {
    person.state = person.pose;
    const g = person.mesh.group;
    g.rotation.x = 0;
    if (person.pose === 'lying') {
      person.towel.position.set(person.spot.x, 0.02, person.spot.z);
      person.towel.rotation.y = person.spot.side % 2 === 0 ? 0 : Math.PI / 2;
      person.towel.visible = true;
      g.position.set(person.spot.x, 0.15, person.spot.z);
      g.rotation.x = Math.PI / 2;
      g.rotation.y = person.spot.side % 2 === 0 ? 0 : Math.PI / 2;
      person.mesh.legLeft.rotation.x = 0;
      person.mesh.legRight.rotation.x = 0;
      person.mesh.armLeft.rotation.x = 0;
      person.mesh.armRight.rotation.x = 0;
    } else if (person.pose === 'swimming') {
      // Prone in the shallows, facing the sea.
      person.towel.visible = false;
      g.position.y = -0.25;
      g.rotation.x = 1.2;
      g.rotation.y = person.spot.side === 0 ? Math.PI : person.spot.side === 1 ? 0 : person.spot.side === 2 ? -Math.PI / 2 : Math.PI / 2;
      person.mesh.legLeft.rotation.x = 0;
      person.mesh.legRight.rotation.x = 0;
      person.mesh.armLeft.rotation.x = 0;
      person.mesh.armRight.rotation.x = 0;
    } else {
      person.towel.visible = false;
      // Face the sea.
      const seaward = person.spot.side === 0 ? Math.PI : person.spot.side === 1 ? 0 : person.spot.side === 2 ? -Math.PI / 2 : Math.PI / 2;
      g.rotation.y = person.pose === 'strolling' ? seaward + Math.PI / 2 : seaward;
    }
  }
  leave(person) {
    person.state = 'leave';
    person.knockedTimer = 0;
    person.towel.visible = false;
    person.mesh.group.rotation.x = 0;
  }
  // Knocked down by a car or a hit: falls, stays down for `seconds`,
  // then gets up and leaves the beach (flee, like a street ped).
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
  update(dt) {
    // Anchored speedboats bob and roll gently, like the swimmers.
    for (const b of this.boats) {
      b.phase += dt * 0.9;
      b.group.position.y = -0.15 + Math.sin(b.phase) * 0.12;
      b.group.rotation.z = Math.sin(b.phase * 0.7) * 0.03;
      b.group.rotation.x = Math.cos(b.phase * 0.5) * 0.02;
    }
    for (const person of this.people) {
      if (person.state === 'dormant') continue;
      const g = person.mesh.group;
      const pos = g.position;
      if (person.state === 'knocked') {
        person.knockedTimer -= dt;
        if (person.knockedTimer <= 0) {
          person.knockedTimer = 0;
          this.leave(person);
        }
        continue;
      }
      // Swimmers get out when night falls — nobody in the water at night.
      if (person.state === 'swimming' && this.isNight()) this.leave(person);
      if (person.state === 'arrive' || person.state === 'leave') {
        const target = person.state === 'arrive' ? person.spot : person.edge;
        const dx = target.x - pos.x;
        const dz = target.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.5) {
          if (person.state === 'arrive') this.settle(person);
          else {
            person.state = 'dormant';
            g.visible = false;
          }
          continue;
        }
        const step = Math.min(4 * dt, dist);
        pos.x += (dx / dist) * step;
        pos.z += (dz / dist) * step;
        // Sink into the shallows on the way to a swim spot, rise back out.
        const ty = person.state === 'arrive' ? (person.spot.y || 0) : 0;
        pos.y += (ty - pos.y) * Math.min(1, dt * 3);
        g.rotation.y = Math.atan2(dx, dz);
        person.walkPhase += dt * 9;
        const swing = Math.sin(person.walkPhase) * 0.5;
        person.mesh.legLeft.rotation.x = swing;
        person.mesh.legRight.rotation.x = -swing;
        person.mesh.armLeft.rotation.x = -swing;
        person.mesh.armRight.rotation.x = swing;
      } else if (person.state === 'strolling') {
        // Walk along the shore; turn at the strip ends.
        const horizontal = person.spot.side < 2;
        const along = horizontal ? pos.x : pos.z;
        if (along > 305 || along < -305) person.strollDir *= -1;
        const step = 2.5 * dt * person.strollDir;
        if (horizontal) pos.x += step;
        else pos.z += step;
        g.rotation.y = horizontal ? (person.strollDir > 0 ? Math.PI / 2 : -Math.PI / 2) : person.strollDir > 0 ? 0 : Math.PI;
        person.walkPhase += dt * 9;
        const swing = Math.sin(person.walkPhase) * 0.5;
        person.mesh.legLeft.rotation.x = swing;
        person.mesh.legRight.rotation.x = -swing;
        person.mesh.armLeft.rotation.x = -swing;
        person.mesh.armRight.rotation.x = swing;
      } else if (person.state === 'swimming') {
        // Drift along the shore, bobbing, arms paddling.
        const horizontal = person.spot.side < 2;
        const along = horizontal ? pos.x : pos.z;
        if (along > 305 || along < -305) person.strollDir *= -1;
        const step = 0.8 * dt * person.strollDir;
        if (horizontal) pos.x += step;
        else pos.z += step;
        person.walkPhase += dt * 3;
        pos.y = -0.25 + Math.sin(person.walkPhase) * 0.08;
        person.mesh.armLeft.rotation.x = Math.sin(person.walkPhase) * 0.9;
        person.mesh.armRight.rotation.x = -Math.sin(person.walkPhase) * 0.9;
      }
      // LYING and STANDING are idle: the pose is the content.
    }
    // Lifeguards stand back up in place after a knockdown. Their Idle
    // clip runs while they stand (frozen while knocked down, so the
    // body stays flat on the sand).
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
    if (this.activeCount < this.target) {
      const dormant = this.people.find((p) => p.state === 'dormant');
      if (dormant) this.arrive(dormant);
    } else if (this.activeCount > this.target) {
      const active = this.people.filter((p) => p.state !== 'dormant' && p.state !== 'leave');
      const pickIdx = Math.floor(this.rng() * active.length);
      if (active[pickIdx]) this.leave(active[pickIdx]);
    }
  }
}
