// Four crews, each tied to a patch of the city. Members loiter in small
// groups around their home ground, drift around on foot, heckle the
// player who comes too close, and swing back when attacked — nearby
// crewmates pile in. At night fewer of them are out, same as the
// pedestrians and the beach crowd.
import { buildWalkerMesh, SKIN_COLOURS, HAIR_COLOURS } from './pedestrians.js';
import { densityForMinute, roadLines } from './city.js';
import { range, pick } from './random.js';

// Crew roster as rows: name, turf rect, shirt colour, taunt line.
const CREW_ROWS = [
  ['PORT KINGS', -266, -208, 0, -52, 0x9a5fd0, 'You lost, tourist?'],
  ['HARBOR SAINTS', 0, -208, 266, -52, 0x3da86b, 'Wrong side of the harbor.'],
  ['LANTERN BOYS', -266, -52, 0, 26, 0xff7a3d, 'This is our street.'],
  ['SOL MIRAMAR', 0, -52, 266, 26, 0xd6303e, 'Walk away, Rook.'],
];

export const GANGS = CREW_ROWS.map((row) => ({
  name: row[0],
  x0: row[1],
  z0: row[2],
  x1: row[3],
  z1: row[4],
  colour: row[5],
  taunt: row[6],
}));

// Crew sizes and behaviour tuning: members per crew, hangout spots per
// crew, taunt range and cooldown, punch reach/damage/cooldown, chase
// range, the radius inside which crewmates join a fight, walk and chase
// speeds, knockdown time, kerb offset, and the dormant retry gap.
const TUNE = {
  perCrew: 6,
  hangouts: 2,
  tauntRange: 8,
  tauntGap: 30,
  punchReach: 1.6,
  punchDamage: 5,
  punchGap: 1.2,
  chaseRange: 30,
  joinRange: 15,
  walkSpeed: 1.5,
  chaseSpeed: 3.4,
  knockedFor: 3,
  kerb: 7.6,
  retryGap: 2,
};

const CITY_LIMIT = 266;
const ROAD_NEAR = 7;
const ARRIVE = 0.3;
const WANDER_CHANCE = 0.1;
const SWING_RATE = 6;

export class Gangs {
  constructor(scene, rng, cb) {
    this.cb = cb;
    this.rng = rng;
    this.lines = roadLines();
    this.members = [];
    this.tauntTimer = [];
    for (let g = 0; g < GANGS.length; g++) this.tauntTimer.push(0);
    this.target = GANGS.length * TUNE.perCrew;
    this.activeCount = this.target;
    for (let g = 0; g < GANGS.length; g++) this.recruitCrew(scene, g);
  }

  recruitCrew(scene, g) {
    const crew = GANGS[g];
    const hangouts = [];
    for (let h = 0; h < TUNE.hangouts; h++) hangouts.push(this.turfPoint(crew));
    for (let i = 0; i < TUNE.perCrew; i++) {
      const home = hangouts[i % TUNE.hangouts];
      const mesh = buildWalkerMesh(
        crew.colour,
        0x23232e,
        pick(this.rng, SKIN_COLOURS),
        pick(this.rng, HAIR_COLOURS),
        'bandana',
        range(this.rng, 0.92, 1.05),
      );
      scene.add(mesh.group);
      const member = {
        gang: g,
        mesh,
        home,
        tx: home.x,
        tz: home.z,
        walking: false,
        hostile: false,
        punchTimer: 0,
        knockedTimer: 0,
        dormant: false,
        retryTimer: 0,
        walkPhase: range(this.rng, 0, Math.PI * 2),
      };
      mesh.group.position.set(home.x, 0, home.z);
      this.members.push(member);
    }
  }

  // Hangouts sit on the sand, where there are no roads: the northern
  // crews on the north shore, the western crew on the west shore, the
  // eastern crew on the east shore. The turf rects still define each
  // crew's territory for the map and for standings.
  turfPoint(crew) {
    const r = this.rng;
    const north = crew.z1 <= -52;
    const west = crew.x1 <= 0;
    if (north) {
      return { x: crew.x0 + 20 + r() * (crew.x1 - crew.x0 - 40), z: -278 - r() * 12 };
    }
    // Shore offset is drawn before the along-shore position, matching
    // the original draw order so the seeded layout is unchanged.
    const off = west ? -278 - r() * 12 : 278 + r() * 12;
    return { x: off, z: crew.z0 + 10 + r() * (crew.z1 - crew.z0 - 20) };
  }

  // A wander target near a road gets pushed onto the nearest sidewalk
  // (7.6m off the road centre), so nobody idles standing in traffic.
  sidewalkClamp(p) {
    const lines = this.lines;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l.axis === 'z') {
        if (Math.abs(p.x - l.at) < ROAD_NEAR && p.z >= -CITY_LIMIT && p.z <= CITY_LIMIT) {
          p.x = l.at + (p.x < l.at ? -TUNE.kerb : TUNE.kerb);
        }
      } else if (Math.abs(p.z - l.at) < ROAD_NEAR && p.x >= -CITY_LIMIT && p.x <= CITY_LIMIT) {
        p.z = l.at + (p.z < l.at ? -TUNE.kerb : TUNE.kerb);
      }
    }
    return p;
  }

  setDensity(minutes) {
    this.target = Math.max(0, Math.round(GANGS.length * TUNE.perCrew * densityForMinute(minutes)));
    let active = 0;
    for (let i = 0; i < this.members.length; i++) {
      const m = this.members[i];
      if (active < this.target) {
        if (m.dormant) this.respawn(m);
        active++;
      } else if (!m.dormant) {
        m.dormant = true;
        m.hostile = false;
        m.mesh.group.visible = false;
      }
    }
    this.activeCount = active;
  }

  respawn(m) {
    m.dormant = false;
    m.hostile = false;
    m.knockedTimer = 0;
    m.walking = false;
    m.mesh.group.visible = true;
    m.mesh.group.rotation.x = 0;
    m.mesh.group.position.y = 0;
    m.home = this.turfPoint(GANGS[m.gang]);
    m.tx = m.home.x;
    m.tz = m.home.z;
    m.mesh.group.position.set(m.home.x, 0, m.home.z);
  }

  onAttacked(m, lethal) {
    if (lethal) {
      m.knockedTimer = TUNE.knockedFor;
      m.mesh.group.rotation.x = Math.PI / 2;
      m.mesh.group.position.y = 0.4;
    } else {
      m.hostile = true;
    }
    this.rallyCrew(m);
  }

  // Crewmates nearby hear the fight and turn hostile too.
  rallyCrew(m) {
    const q = m.mesh.group.position;
    for (let i = 0; i < this.members.length; i++) {
      const o = this.members[i];
      if (o === m || o.gang !== m.gang || o.dormant || o.knockedTimer > 0) continue;
      const p = o.mesh.group.position;
      if (Math.hypot(p.x - q.x, p.z - q.z) < TUNE.joinRange) o.hostile = true;
    }
  }

  update(dt, playerPos) {
    for (let g = 0; g < GANGS.length; g++) this.tauntTimer[g] -= dt;
    for (let i = 0; i < this.members.length; i++) {
      this.stepMember(this.members[i], dt, playerPos);
    }
  }

  stepMember(m, dt, playerPos) {
    if (m.dormant) {
      this.stepDormant(m, dt);
      return;
    }
    if (m.knockedTimer > 0) {
      this.stepKnocked(m, dt);
      return;
    }
    const pos = m.mesh.group.position;
    const dx = playerPos.x - pos.x;
    const dz = playerPos.z - pos.z;
    const dist = Math.hypot(dx, dz);
    if (m.hostile) {
      this.stepHostile(m, dt, playerPos, dist, dx, dz);
      return;
    }
    this.stepIdle(m, dt, dist);
  }

  stepDormant(m, dt) {
    m.retryTimer -= dt;
    if (m.retryTimer > 0) return;
    m.retryTimer = TUNE.retryGap;
    if (this.activeCount >= this.target) return;
    this.respawn(m);
    this.activeCount++;
  }

  stepKnocked(m, dt) {
    m.knockedTimer -= dt;
    if (m.knockedTimer > 0) return;
    const pos = m.mesh.group.position;
    pos.y = 0;
    m.mesh.group.rotation.x = 0;
    m.hostile = true;
  }

  stepHostile(m, dt, playerPos, dist, dx, dz) {
    m.punchTimer -= dt;
    if (dist > TUNE.chaseRange) {
      m.hostile = false;
      m.walking = false;
      return;
    }
    if (dist >= TUNE.punchReach) {
      this.walkToward(m, playerPos.x, playerPos.z, TUNE.chaseSpeed, dt);
      return;
    }
    m.mesh.group.rotation.y = Math.atan2(dx, dz);
    if (m.punchTimer <= 0) {
      m.punchTimer = TUNE.punchGap;
      m.mesh.armRight.rotation.x = -1.8;
      this.cb.onPunch(TUNE.punchDamage);
      return;
    }
    m.mesh.armRight.rotation.x *= 0.8;
  }

  stepIdle(m, dt, dist) {
    if (dist < TUNE.tauntRange && this.tauntTimer[m.gang] <= 0) {
      this.tauntTimer[m.gang] = TUNE.tauntGap;
      this.cb.onTaunt(GANGS[m.gang].taunt);
    }
    if (!m.walking) {
      this.maybeWander(m, dt);
      return;
    }
    if (this.walkToward(m, m.tx, m.tz, TUNE.walkSpeed, dt)) m.walking = false;
  }

  maybeWander(m, dt) {
    if (this.rng() >= dt * WANDER_CHANCE) return;
    const angle = this.rng() * Math.PI * 2;
    const radius = 3 + this.rng() * 3;
    const spot = this.sidewalkClamp({
      x: m.home.x + Math.cos(angle) * radius,
      z: m.home.z + Math.sin(angle) * radius,
    });
    m.tx = spot.x;
    m.tz = spot.z;
    m.walking = true;
  }

  walkToward(m, tx, tz, speed, dt) {
    const pos = m.mesh.group.position;
    const dx = tx - pos.x;
    const dz = tz - pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < ARRIVE) return true;
    const step = Math.min(dist, speed * dt);
    pos.x += (dx / dist) * step;
    pos.z += (dz / dist) * step;
    m.mesh.group.rotation.y = Math.atan2(dx, dz);
    m.walkPhase += dt * SWING_RATE;
    const swing = Math.sin(m.walkPhase) * 0.5;
    m.mesh.legLeft.rotation.x = swing;
    m.mesh.legRight.rotation.x = -swing;
    m.mesh.armLeft.rotation.x = -swing;
    m.mesh.armRight.rotation.x = swing;
    return false;
  }
}
