// Gangs: four crews tied to their turf. Members hang out in small groups,
// idle and wander near home, taunt the player up close, and fight back
// (melee) when attacked. Night density applies like peds and beachgoers.
import { buildWalkerMesh, SKIN_COLOURS, HAIR_COLOURS } from './pedestrians.js';
import { densityForMinute, roadLines } from './city.js';
import { range, pick } from './random.js';
export const GANGS = [
  { name: 'PORT KINGS', x0: -266, z0: -208, x1: 0, z1: -52, colour: 0x9a5fd0, taunt: 'You lost, tourist?' },
  { name: 'HARBOR SAINTS', x0: 0, z0: -208, x1: 266, z1: -52, colour: 0x3da86b, taunt: 'Wrong side of the harbor.' },
  { name: 'LANTERN BOYS', x0: -266, z0: -52, x1: 0, z1: 26, colour: 0xff7a3d, taunt: 'This is our street.' },
  { name: 'SOL MIRAMAR', x0: 0, z0: -52, x1: 266, z1: 26, colour: 0xd6303e, taunt: 'Walk away, Rook.' },
];
const PER_GANG = 6, GROUPS = 2;
const TAUNT_RANGE = 8, TAUNT_CD = 30, PUNCH_RANGE = 1.6, PUNCH_DMG = 5, PUNCH_CD = 1.2;
const CHASE_RANGE = 30, JOIN_RANGE = 15, WALK_SPEED = 1.5, CHASE_SPEED = 3.4, KNOCKED_SECONDS = 3;
const SIDEWALK = 7.6, RETRY_SECONDS = 2;
export class Gangs {
  constructor(scene, rng, cb) {
    this.cb = cb; this.rng = rng; this.lines = roadLines();
    this.members = []; this.tauntTimer = [0, 0, 0, 0];
    this.target = GANGS.length * PER_GANG; this.activeCount = this.target;
    for (let g = 0; g < GANGS.length; g++) {
      const gang = GANGS[g];
      const homes = [this.turfPoint(gang), this.turfPoint(gang)];
      for (let i = 0; i < PER_GANG; i++) {
        const home = homes[i % GROUPS];
        const mesh = buildWalkerMesh(gang.colour, 0x23232e, pick(rng, SKIN_COLOURS), pick(rng, HAIR_COLOURS), 'bandana', range(rng, 0.92, 1.05));
        scene.add(mesh.group);
        const m = { gang: g, mesh, home, tx: home.x, tz: home.z, walking: false, hostile: false, punchTimer: 0, knockedTimer: 0, dormant: false, retryTimer: 0, walkPhase: range(rng, 0, Math.PI * 2) };
        mesh.group.position.set(home.x, 0, home.z);
        this.members.push(m);
      }
    }
  }
  // Gang hangouts live on the BEACH (no roads there): north crews on the
  // north shore, the west crew on the west shore, the east crew on the
  // east shore. Turf rects stay as the gang's territory (map + standing).
  turfPoint(gang) {
    const r = this.rng;
    if (gang.z1 <= -52) return { x: gang.x0 + 20 + r() * (gang.x1 - gang.x0 - 40), z: -278 - r() * 12 };
    if (gang.x1 <= 0) return { x: -278 - r() * 12, z: gang.z0 + 10 + r() * (gang.z1 - gang.z0 - 20) };
    return { x: 278 + r() * 12, z: gang.z0 + 10 + r() * (gang.z1 - gang.z0 - 20) };
  }
  // Wander targets stay on the sidewalk: a target on a road is pushed to
  // the nearest sidewalk (7.6m off the road centre), so members never
  // idle standing in traffic.
  sidewalkClamp(p) {
    for (const l of this.lines) {
      if (l.axis === 'z' && Math.abs(p.x - l.at) < 7 && p.z >= -266 && p.z <= 266) p.x = l.at + (p.x < l.at ? -SIDEWALK : SIDEWALK);
      if (l.axis === 'x' && Math.abs(p.z - l.at) < 7 && p.x >= -266 && p.x <= 266) p.z = l.at + (p.z < l.at ? -SIDEWALK : SIDEWALK);
    }
    return p;
  }
  setDensity(minutes) {
    this.target = Math.max(0, Math.round(GANGS.length * PER_GANG * densityForMinute(minutes)));
    let active = 0;
    for (const m of this.members) {
      if (active < this.target) { if (m.dormant) this.respawn(m); active++; }
      else if (!m.dormant) { m.dormant = true; m.hostile = false; m.mesh.group.visible = false; }
    }
    this.activeCount = active;
  }
  respawn(m) {
    m.dormant = false; m.hostile = false; m.knockedTimer = 0; m.walking = false;
    m.mesh.group.visible = true; m.mesh.group.rotation.x = 0; m.mesh.group.position.y = 0;
    m.home = this.turfPoint(GANGS[m.gang]); m.tx = m.home.x; m.tz = m.home.z;
    m.mesh.group.position.set(m.home.x, 0, m.home.z);
  }
  onAttacked(m, lethal) {
    if (lethal) {
      m.knockedTimer = KNOCKED_SECONDS;
      m.mesh.group.rotation.x = Math.PI / 2;
      m.mesh.group.position.y = 0.4;
    } else m.hostile = true;
    // Nearby members of the same gang join the fight.
    for (const o of this.members) {
      if (o === m || o.gang !== m.gang || o.dormant || o.knockedTimer > 0) continue;
      const p = o.mesh.group.position, q = m.mesh.group.position;
      if (Math.hypot(p.x - q.x, p.z - q.z) < JOIN_RANGE) o.hostile = true;
    }
  }
  update(dt, playerPos) {
    for (let g = 0; g < GANGS.length; g++) this.tauntTimer[g] -= dt;
    for (const m of this.members) {
      if (m.dormant) {
        m.retryTimer -= dt;
        if (m.retryTimer <= 0) { m.retryTimer = RETRY_SECONDS; if (this.activeCount < this.target) { this.respawn(m); this.activeCount++; } }
        continue;
      }
      const pos = m.mesh.group.position;
      if (m.knockedTimer > 0) {
        m.knockedTimer -= dt;
        if (m.knockedTimer <= 0) { pos.y = 0; m.mesh.group.rotation.x = 0; m.hostile = true; }
        continue;
      }
      const dx = playerPos.x - pos.x, dz = playerPos.z - pos.z;
      const dist = Math.hypot(dx, dz);
      if (m.hostile) {
        m.punchTimer -= dt;
        if (dist > CHASE_RANGE) { m.hostile = false; m.walking = false; }
        else if (dist < PUNCH_RANGE) {
          m.mesh.group.rotation.y = Math.atan2(dx, dz);
          if (m.punchTimer <= 0) { m.punchTimer = PUNCH_CD; m.mesh.armRight.rotation.x = -1.8; this.cb.onPunch(PUNCH_DMG); }
          else m.mesh.armRight.rotation.x *= 0.8;
        } else this.walkToward(m, playerPos.x, playerPos.z, CHASE_SPEED, dt);
        continue;
      }
      if (dist < TAUNT_RANGE && this.tauntTimer[m.gang] <= 0) { this.tauntTimer[m.gang] = TAUNT_CD; this.cb.onTaunt(GANGS[m.gang].taunt); }
      if (!m.walking) {
        if (this.rng() < dt * 0.1) {
          const a = this.rng() * Math.PI * 2, r = 3 + this.rng() * 3;
          const t = this.sidewalkClamp({ x: m.home.x + Math.cos(a) * r, z: m.home.z + Math.sin(a) * r });
          m.tx = t.x; m.tz = t.z; m.walking = true;
        }
      } else if (this.walkToward(m, m.tx, m.tz, WALK_SPEED, dt)) m.walking = false;
    }
  }
  walkToward(m, tx, tz, speed, dt) {
    const pos = m.mesh.group.position;
    const dx = tx - pos.x, dz = tz - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) return true;
    const step = Math.min(dist, speed * dt);
    pos.x += (dx / dist) * step; pos.z += (dz / dist) * step;
    m.mesh.group.rotation.y = Math.atan2(dx, dz);
    m.walkPhase += dt * 6;
    const swing = Math.sin(m.walkPhase) * 0.5;
    m.mesh.legLeft.rotation.x = swing; m.mesh.legRight.rotation.x = -swing;
    m.mesh.armLeft.rotation.x = -swing; m.mesh.armRight.rotation.x = swing;
    return false;
  }
}
