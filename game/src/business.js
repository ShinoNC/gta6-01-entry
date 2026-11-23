import { buildBeacon, fadeBeacon, colorBeacon } from './missions.js';
const BUSINESS_DEFS = [
  { id: 'taxi', name: 'KEYS CAB CO.', kind: 'TAXI COMPANY', x: 52, z: 52, district: 'PELICAN BAY', price: 2000, repRequired: 1, incomePerDay: 1200 },
  { id: 'club', name: 'NEON PALMS', kind: 'NIGHTCLUB', x: -52, z: -52, district: 'OLD PORT', price: 6000, repRequired: 3, incomePerDay: 3000 },
  { id: 'dealer', name: 'SOLSTICE MOTORS', kind: 'CAR DEALERSHIP', x: 104, z: -104, district: 'HARBOR LIGHTS', price: 15000, repRequired: 5, incomePerDay: 7500 },
];
const SECONDS_PER_GAME_DAY = 2880;
const MAX_UPGRADE_LEVEL = 2;
const PENDING_CAP_DAYS = 3;
const COLLECT_RANGE = 9;
export class Businesses {
  constructor(scene) {
    this.state = BUSINESS_DEFS.map(() => ({ owned: false, level: 0, pending: 0 }));
    this.beacons = BUSINESS_DEFS.map((def) => {
      const beacon = buildBeacon(scene, 0xc86bff);
      beacon.group.position.set(def.x, 0, def.z);
      beacon.group.visible = true;
      return beacon;
    });
    this.clock = 0;
  }
  get defs() {
    return BUSINESS_DEFS;
  }
  incomePerDay(index) {
    return BUSINESS_DEFS[index].incomePerDay * (1 + 0.5 * this.state[index].level);
  }
  upgradeCost(index) {
    return BUSINESS_DEFS[index].price / 2;
  }
  ownedCount() {
    return this.state.filter((s) => s.owned).length;
  }
  totalIncomePerDay() {
    return BUSINESS_DEFS.reduce((sum, _def, i) => sum + (this.state[i].owned ? this.incomePerDay(i) : 0), 0);
  }
  totalPending() {
    return this.state.reduce((sum, s) => sum + s.pending, 0);
  }
  update(dt, playerPos) {
    this.clock += dt;
    for (let i = 0; i < BUSINESS_DEFS.length; i += 1) {
      const dist = playerPos ? Math.hypot(playerPos.x - BUSINESS_DEFS[i].x, playerPos.z - BUSINESS_DEFS[i].z) : 99;
      fadeBeacon(this.beacons[i], dist, this.clock);
      if (!this.state[i].owned) continue;
      const cap = this.incomePerDay(i) * PENDING_CAP_DAYS;
      this.state[i].pending = Math.min(cap, this.state[i].pending + (this.incomePerDay(i) / SECONDS_PER_GAME_DAY) * dt);
    }
  }
  canBuy(index, money, repLevel) {
    const def = BUSINESS_DEFS[index];
    if (this.state[index].owned) return 'owned';
    if (repLevel < def.repRequired) return 'rep';
    if (money < def.price) return 'money';
    return 'ok';
  }
  buy(index) {
    this.state[index].owned = true;
    colorBeacon(this.beacons[index], 0x7affc4);
  }
  canUpgrade(index, money) {
    if (!this.state[index].owned) return 'not-owned';
    if (this.state[index].level >= MAX_UPGRADE_LEVEL) return 'maxed';
    if (money < this.upgradeCost(index)) return 'money';
    return 'ok';
  }
  upgrade(index) {
    this.state[index].level += 1;
  }
  collect(index) {
    const amount = Math.floor(this.state[index].pending);
    this.state[index].pending = 0;
    return amount;
  }
  nearestCollectable(pos) {
    for (let i = 0; i < BUSINESS_DEFS.length; i += 1) {
      if (!this.state[i].owned || this.state[i].pending < 1) continue;
      if (Math.hypot(pos.x - BUSINESS_DEFS[i].x, pos.z - BUSINESS_DEFS[i].z) < COLLECT_RANGE) return i;
    }
    return -1;
  }
  blips() {
    return BUSINESS_DEFS.map((def, i) => ({ x: def.x, z: def.z, owned: this.state[i].owned, name: def.name }));
  }
  serialize() {
    return this.state.map((s) => ({ owned: s.owned, level: s.level, pending: Math.floor(s.pending) }));
  }
  restore(data) {
    if (!Array.isArray(data)) return;
    for (let i = 0; i < this.state.length && i < data.length; i += 1) {
      if (!data[i] || typeof data[i] !== 'object') continue;
      this.state[i].owned = Boolean(data[i].owned);
      this.state[i].level = Math.max(0, Math.min(MAX_UPGRADE_LEVEL, data[i].level | 0));
      this.state[i].pending = Math.max(0, data[i].pending || 0);
      if (this.state[i].owned) colorBeacon(this.beacons[i], 0x7affc4);
    }
  }
  reset() {
    this.state = BUSINESS_DEFS.map(() => ({ owned: false, level: 0, pending: 0 }));
    for (const beacon of this.beacons) colorBeacon(beacon, 0xc86bff);
  }
}
export const ACHIEVEMENTS = [
  { id: 'firstWheels', name: 'FIRST WHEELS', desc: 'Steal your first car', reward: 100, test: (s) => s.carsStolen >= 1 },
  { id: 'carThief', name: 'CAR THIEF', desc: 'Steal 10 cars', reward: 500, test: (s) => s.carsStolen >= 10 },
  { id: 'menace', name: 'MENACE', desc: 'Knock down 10 pedestrians', reward: 500, test: (s) => s.pedsDown >= 10 },
  { id: 'ghost', name: 'GHOST', desc: 'Escape from 5 wanted stars', reward: 1000, test: (s) => s.escapes5 >= 1 },
  { id: 'skyHunter', name: 'SKY HUNTER', desc: 'Shoot down 3 helicopters', reward: 1500, test: (s) => s.helisDown >= 3 },
  { id: 'tycoon', name: 'TYCOON', desc: 'Own all 3 businesses', reward: 2500, test: (s) => s.businessesOwned >= 3 },
  { id: 'bigShot', name: 'BIG SHOT', desc: 'Earn $50,000 in your career', reward: 2500, test: (s) => s.moneyEarned >= 50000 },
  { id: 'roadKing', name: 'ROAD KING', desc: 'Drive 100 km', reward: 1000, test: (s) => s.kmDriven >= 100 },
];
export function checkAchievements(stats, unlocked) {
  const fresh = [];
  for (const achievement of ACHIEVEMENTS) {
    if (!unlocked.includes(achievement.id) && achievement.test(stats)) fresh.push(achievement);
  }
  return fresh;
}
export function freshStats() {
  return { carsStolen: 0, pedsDown: 0, moneyEarned: 0, kmDriven: 0, escapes5: 0, helisDown: 0, robberiesStopped: 0, jobsDone: 0, businessesOwned: 0, crimeCounts: {} };
}
