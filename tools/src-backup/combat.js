import * as THREE from 'three';
const WEAPON_SLOTS = [
  { id: 'fists', name: 'FISTS', range: 2.6, cooldownSeconds: 0.45, magSize: 0, reserveAmmo: 0, locked: false, damage: 10 },
  { id: 'pistol', name: 'PISTOL', range: 60, cooldownSeconds: 0.28, magSize: 12, reserveAmmo: 48, locked: true, damage: 12 },
  { id: 'smg', name: 'SMG', range: 45, cooldownSeconds: 0.09, magSize: 30, reserveAmmo: 90, locked: true, damage: 12 },
  { id: 'shotgun', name: 'SHOTGUN', range: 30, cooldownSeconds: 0.7, magSize: 6, reserveAmmo: 24, locked: true, damage: 30 },
];
const RELOAD_SECONDS = 1.2;
const TRACER_LIFE_SECONDS = 0.09;
const MUZZLE_FLASH_SECONDS = 0.06;
const SPREAD_BASE_RADIANS = 0.004;
const SPREAD_PER_SHOT_RADIANS = 0.012;
const SPREAD_MAX_RADIANS = 0.09;
const SPREAD_RECOVER_PER_SECOND = 0.12;
const RECOIL_PER_SHOT = 0.35;
const RECOIL_RECOVER_PER_SECOND = 3;
const AMMO_CRATE_PICKUP_METRES = 3;
const AMMO_CRATE_RESPAWN_SECONDS = 45;
const AMMO_CRATE_SPOTS = [
  { x: 26, z: 26, name: 'Pelican Bay' },
  { x: -78, z: -52, name: 'Old Port' },
  { x: 78, z: -130, name: 'Harbor Lights' },
];
function rayHit(origin, direction, range, targets, los) {
  let best = null;
  for (const target of targets) {
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const along = dx * direction.x + dz * direction.z;
    if (along < 0 || along > range) continue;
    const perpendicular = Math.abs(dx * direction.z - dz * direction.x);
    if (perpendicular > target.radius) continue;
    if (los && !los(origin, target)) continue;
    if (!best || along < best.along) best = { ...target, along };
  }
  return best;
}
function buildAmmoCrate(scene, spot) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.6, 0.9), new THREE.MeshLambertMaterial({ color: 0x2a8a4a }));
  box.position.y = 0.3;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.14, 0.95), new THREE.MeshLambertMaterial({ color: 0x7affc4 }));
  lid.position.y = 0.65;
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshBasicMaterial({ color: 0x7affc4 }));
  marker.position.y = 1.6;
  group.add(box, lid, marker);
  group.position.set(spot.x, 0, spot.z);
  scene.add(group);
  return { group, marker, x: spot.x, z: spot.z, name: spot.name, available: true, respawnTimer: 0 };
}
export class Combat {
  constructor(scene, callbacks, effects) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.effects = effects;
    this.weapons = WEAPON_SLOTS.map((slot) => ({ ...slot, mag: slot.magSize, reserve: slot.reserveAmmo }));
    this.selected = 0;
    this.cooldownTimer = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.muzzleTimer = 0;
    this.spread = SPREAD_BASE_RADIANS;
    this.recoil = 0;
    this.tracerIndex = 0;
    this.tracers = [];
    for (let i = 0; i < 6; i += 1) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.muzzle.visible = false;
    scene.add(this.muzzle);
    this.ammoCrates = AMMO_CRATE_SPOTS.map((spot) => buildAmmoCrate(scene, spot));
  }
  currentWeapon() {
    return this.weapons[this.selected];
  }
  selectWeapon(index) {
    if (index < 0 || index >= this.weapons.length) return 'invalid';
    if (this.weapons[index].locked) return 'locked';
    this.selected = index;
    this.reloading = false;
    return 'ok';
  }
  cycleWeapon(step) {
    for (let tries = 0; tries < this.weapons.length; tries += 1) {
      this.selected = (this.selected + step + this.weapons.length) % this.weapons.length;
      if (!this.weapons[this.selected].locked) {
        this.reloading = false;
        return this.currentWeapon().name;
      }
    }
    return null;
  }
  unlockWeapon(id) {
    const weapon = this.weapons.find((candidate) => candidate.id === id);
    if (weapon) weapon.locked = false;
  }
  ownedWeaponIds() {
    return this.weapons.filter((weapon) => !weapon.locked).map((weapon) => weapon.id);
  }
  setOwnedWeapons(ids) {
    for (const weapon of this.weapons) {
      weapon.locked = !ids.includes(weapon.id);
    }
  }
  restock() {
    for (const weapon of this.weapons) {
      weapon.mag = weapon.magSize;
      weapon.reserve = weapon.reserveAmmo;
    }
    this.reloading = false;
  }
  ammoForHud() {
    return this.weapons.map((weapon, index) => ({
      name: weapon.name,
      mag: weapon.mag,
      reserve: weapon.reserve,
      active: index === this.selected,
      locked: weapon.locked,
      reloading: this.reloading && index === this.selected,
    }));
  }
  ammoCratesForHud() {
    return this.ammoCrates.map((crate) => ({ x: crate.x, z: crate.z, available: crate.available }));
  }
  fireTracer(from, to) {
    const tracer = this.tracers[this.tracerIndex];
    this.tracerIndex = (this.tracerIndex + 1) % this.tracers.length;
    const positions = tracer.line.geometry.attributes.position;
    positions.setXYZ(0, from.x, from.y, from.z);
    positions.setXYZ(1, to.x, to.y, to.z);
    positions.needsUpdate = true;
    tracer.line.material.opacity = 0.9;
    tracer.line.visible = true;
    tracer.life = TRACER_LIFE_SECONDS;
  }
  tryShoot(origin, aimYaw, targets) {
    if (this.cooldownTimer > 0 || this.reloading) return 'busy';
    const weapon = this.currentWeapon();
    const aimError = (Math.random() - 0.5) * 2 * this.spread;
    const direction = { x: -Math.sin(aimYaw + aimError), z: -Math.cos(aimYaw + aimError) };
    this.cooldownTimer = weapon.cooldownSeconds;
    if (weapon.id === 'fists') {
      const hit = rayHit(origin, direction, weapon.range, targets.filter((target) => target.kind === 'pedestrian'), this.callbacks.los);
      if (hit) {
        this.callbacks.onHitPedestrian(hit.ref, false);
        this.callbacks.onDamage?.({ x: hit.x, y: 1.2, z: hit.z }, weapon.damage);
        this.recoil = Math.min(1, this.recoil + 0.3);
      }
      return hit ? 'punch' : 'whiff';
    }
    if (weapon.mag <= 0) {
      if (weapon.reserve > 0) {
        this.reloading = true;
        this.reloadTimer = RELOAD_SECONDS;
        return 'reloading';
      }
      return 'empty';
    }
    weapon.mag -= 1;
    this.spread = Math.min(SPREAD_MAX_RADIANS, this.spread + SPREAD_PER_SHOT_RADIANS);
    this.recoil = Math.min(1, this.recoil + RECOIL_PER_SHOT);
    const muzzle = { x: origin.x + direction.x * 0.9, y: 1.4, z: origin.z + direction.z * 0.9 };
    this.muzzle.position.set(muzzle.x, muzzle.y, muzzle.z);
    this.muzzle.rotation.z = Math.random() * Math.PI;
    const flashScale = 0.8 + Math.random() * 0.5;
    this.muzzle.scale.set(flashScale, flashScale, 1);
    this.muzzle.visible = true;
    this.muzzleTimer = MUZZLE_FLASH_SECONDS;
    const hit = rayHit(origin, direction, weapon.range, targets, this.callbacks.los);
    const end = hit
      ? { x: origin.x + direction.x * hit.along, y: 1.2, z: origin.z + direction.z * hit.along }
      : { x: origin.x + direction.x * weapon.range, y: 1.2, z: origin.z + direction.z * weapon.range };
    this.fireTracer(muzzle, end);
    if (hit) {
      this.effects.burstSparks(end.x, end.y, end.z);
      this.callbacks.onDamage?.(end, weapon.damage);
      if (hit.kind === 'pedestrian') this.callbacks.onHitPedestrian(hit.ref, true);
      if (hit.kind === 'car' || hit.kind === 'police') this.callbacks.onHitCar?.(hit.ref, weapon.damage);
      if (hit.kind === 'getaway') this.callbacks.onHitGetaway?.(hit.ref);
      if (hit.kind === 'helicopter') this.callbacks.onHitHelicopter?.(hit.ref, weapon.damage);
    }
    this.callbacks.onShot();
    if (weapon.mag === 0 && weapon.reserve > 0) {
      this.reloading = true;
      this.reloadTimer = RELOAD_SECONDS;
    }
    return 'shot';
  }
  update(dt, playerPos) {
    this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
    this.spread = Math.max(SPREAD_BASE_RADIANS, this.spread - SPREAD_RECOVER_PER_SECOND * dt);
    this.recoil = Math.max(0, this.recoil - RECOIL_RECOVER_PER_SECOND * dt);
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        const weapon = this.currentWeapon();
        const taken = Math.min(weapon.magSize, weapon.reserve);
        weapon.mag = taken;
        weapon.reserve -= taken;
        this.reloading = false;
      }
    }
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) this.muzzle.visible = false;
    }
    for (const tracer of this.tracers) {
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / TRACER_LIFE_SECONDS) * 0.9;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
    for (const crate of this.ammoCrates) {
      if (!crate.available) {
        crate.respawnTimer -= dt;
        if (crate.respawnTimer <= 0) {
          crate.available = true;
          crate.group.visible = true;
        }
        continue;
      }
      crate.marker.rotation.y += dt * 2;
      crate.marker.position.y = 1.6 + Math.sin(performance.now() / 300) * 0.12;
      if (playerPos && Math.hypot(playerPos.x - crate.x, playerPos.z - crate.z) < AMMO_CRATE_PICKUP_METRES) {
        this.restock();
        crate.available = false;
        crate.respawnTimer = AMMO_CRATE_RESPAWN_SECONDS;
        crate.group.visible = false;
        this.callbacks.onAmmoPickup(crate.name);
      }
    }
  }
}