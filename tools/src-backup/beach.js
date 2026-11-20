import * as THREE from 'three';
import { buildWalkerMesh } from './pedestrians.js';
import { densityForMinute } from './city.js';
import { pick, range } from './random.js';
// Beachgoers on the sand ring: some lie on towels, some stand facing the
// sea, some stroll along the shore. They follow the night-density rule
// like street peds (target = 16 x density) and never pop: they walk in
// from the city edge to their spot and walk back out when they leave.
const BEACHGOER_COUNT = 16;
const CITY_EDGE = 318, SHORELINE = 356;
const BEACH_COLOURS = [0xff5a7a, 0x2ad0c4, 0xffc828, 0x7affc4, 0xff7a3d, 0x9a5fd0];
const SKIN_COLOURS = [0xe8b07a, 0xd9a077, 0xc98a5a, 0xf2c89a];
const HAIR_COLOURS = [0x241a2a, 0x201510, 0xe8a33d, 0x5a3a28];
function randomSpot(rng) {
  const side = Math.floor(rng() * 4);
  const along = range(rng, -300, 300);
  const depth = range(rng, 4, 30);
  if (side === 0) return { x: along, z: -CITY_EDGE - depth, side, edge: { x: along, z: -CITY_EDGE } };
  if (side === 1) return { x: along, z: CITY_EDGE + depth, side, edge: { x: along, z: CITY_EDGE } };
  if (side === 2) return { x: -CITY_EDGE - depth, z: along, side, edge: { x: -CITY_EDGE, z: along } };
  return { x: CITY_EDGE + depth, z: along, side, edge: { x: CITY_EDGE, z: along } };
}
export class Beachgoers {
  constructor(scene, rng) {
    this.scene = scene;
    this.rng = rng;
    this.target = BEACHGOER_COUNT;
    this.people = [];
    for (let i = 0; i < BEACHGOER_COUNT; i += 1) {
      const mesh = buildWalkerMesh(pick(rng, BEACH_COLOURS), pick(rng, BEACH_COLOURS), pick(rng, SKIN_COLOURS), pick(rng, HAIR_COLOURS), 'none', range(rng, 0.9, 1.05));
      const towel = new THREE.Mesh(
        new THREE.BoxGeometry(1.8, 0.04, 0.8),
        new THREE.MeshLambertMaterial({ color: pick(rng, BEACH_COLOURS) }),
      );
      towel.visible = false;
      scene.add(towel);
      scene.add(mesh.group);
      this.people.push({ mesh, towel, state: 'dormant', spot: null, edge: null, pose: 'standing', strollDir: 1, walkPhase: rng() * 6 });
      mesh.group.visible = false;
    }
    // Start populated at the daytime target; setDensity rebalances after.
    for (let i = 0; i < BEACHGOER_COUNT; i += 1) this.arrive(this.people[i], true);
  }
  get activeCount() {
    return this.people.filter((p) => p.state !== 'dormant').length;
  }
  setDensity(minutes) {
    this.target = Math.max(0, Math.round(BEACHGOER_COUNT * densityForMinute(minutes)));
  }
  arrive(person, instant = false) {
    const spot = randomSpot(this.rng);
    person.spot = spot;
    person.edge = spot.edge;
    person.pose = this.rng() < 0.45 ? 'lying' : this.rng() < 0.5 ? 'standing' : 'strolling';
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
    } else {
      person.towel.visible = false;
      // Face the sea.
      const seaward = person.spot.side === 0 ? Math.PI : person.spot.side === 1 ? 0 : person.spot.side === 2 ? -Math.PI / 2 : Math.PI / 2;
      g.rotation.y = person.pose === 'strolling' ? seaward + Math.PI / 2 : seaward;
    }
  }
  leave(person) {
    person.state = 'leave';
    person.towel.visible = false;
    person.mesh.group.rotation.x = 0;
  }
  update(dt) {
    for (const person of this.people) {
      if (person.state === 'dormant') continue;
      const g = person.mesh.group;
      const pos = g.position;
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
      }
      // LYING and STANDING are idle: the pose is the content.
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
