// On-foot combat: fists, pistol, SMG. Hitscan shots with a tracer line, a
// muzzle flash and impact sparks. Shooting — or hitting a pedestrian —
// raises the wanted level through the callbacks into main. The SMG starts
// locked (mission 3 unlocks it); ammo restocks after every mission.
import * as THREE from 'three';

export const WEAPON_SLOTS = [
  { id: 'fists', name: 'FISTS', range: 2.6, cooldownSeconds: 0.45, magSize: 0, reserveAmmo: 0, locked: false },
  { id: 'pistol', name: 'PISTOL', range: 60, cooldownSeconds: 0.28, magSize: 12, reserveAmmo: 48, locked: false },
  { id: 'smg', name: 'SMG', range: 45, cooldownSeconds: 0.09, magSize: 30, reserveAmmo: 90, locked: true },
];
const RELOAD_SECONDS = 1.2;
const TRACER_LIFE_SECONDS = 0.09;
const MUZZLE_FLASH_SECONDS = 0.06;
const SPARK_COUNT = 24;
const SPARKS_PER_HIT = 8;

function rayHit(origin, direction, range, targets) {
  let best = null;
  for (const target of targets) {
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const along = dx * direction.x + dz * direction.z;
    if (along < 0 || along > range) continue;
    const perpendicular = Math.abs(dx * direction.z - dz * direction.x);
    if (perpendicular > target.radius) continue;
    if (!best || along < best.along) best = { ...target, along };
  }
  return best;
}

export class Combat {
  constructor(scene, callbacks) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.weapons = WEAPON_SLOTS.map((slot) => ({ ...slot, mag: slot.magSize, reserve: slot.reserveAmmo }));
    this.selected = 1;
    this.cooldownTimer = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.muzzleTimer = 0;
    this.tracerIndex = 0;
    this.tracers = [];
    for (let i = 0; i < 6; i += 1) {
      const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }),
      );
      line.visible = false;
      scene.add(line);
      this.tracers.push({ line, life: 0 });
    }
    this.muzzle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.7),
      new THREE.MeshBasicMaterial({
        color: 0xffe9a8,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.muzzle.visible = false;
    scene.add(this.muzzle);
    this.sparkPositions = new Float32Array(SPARK_COUNT * 3).fill(-50);
    this.sparkVelocities = new Float32Array(SPARK_COUNT * 3);
    this.sparkLife = new Float32Array(SPARK_COUNT);
    const sparkGeometry = new THREE.BufferGeometry();
    sparkGeometry.setAttribute('position', new THREE.BufferAttribute(this.sparkPositions, 3));
    this.sparks = new THREE.Points(
      sparkGeometry,
      new THREE.PointsMaterial({ color: 0xffd978, size: 0.18, transparent: true, depthWrite: false }),
    );
    scene.add(this.sparks);
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

  burstSparks(x, y, z) {
    let placed = 0;
    for (let i = 0; i < SPARK_COUNT && placed < SPARKS_PER_HIT; i += 1) {
      if (this.sparkLife[i] > 0) continue;
      this.sparkPositions[i * 3] = x;
      this.sparkPositions[i * 3 + 1] = y;
      this.sparkPositions[i * 3 + 2] = z;
      this.sparkVelocities[i * 3] = (Math.random() - 0.5) * 6;
      this.sparkVelocities[i * 3 + 1] = Math.random() * 5;
      this.sparkVelocities[i * 3 + 2] = (Math.random() - 0.5) * 6;
      this.sparkLife[i] = 0.4;
      placed += 1;
    }
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

  // One trigger pull: 'shot', 'punch', 'empty', 'locked' or 'busy'.
  // Targets carry {x, z, radius, kind, ref}; aimYaw is the camera yaw.
  tryShoot(origin, aimYaw, targets) {
    if (this.cooldownTimer > 0 || this.reloading) return 'busy';
    const weapon = this.currentWeapon();
    const direction = { x: -Math.sin(aimYaw), z: -Math.cos(aimYaw) };
    this.cooldownTimer = weapon.cooldownSeconds;
    if (weapon.id === 'fists') {
      const hit = rayHit(origin, direction, weapon.range, targets.filter((target) => target.kind === 'pedestrian'));
      if (hit) this.callbacks.onHitPedestrian(hit.ref);
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
    const muzzle = { x: origin.x + direction.x * 0.9, y: 1.4, z: origin.z + direction.z * 0.9 };
    this.muzzle.position.set(muzzle.x, muzzle.y, muzzle.z);
    this.muzzle.rotation.z = Math.random() * Math.PI;
    this.muzzle.visible = true;
    this.muzzleTimer = MUZZLE_FLASH_SECONDS;
    const hit = rayHit(origin, direction, weapon.range, targets);
    const end = hit
      ? { x: origin.x + direction.x * hit.along, y: 1.2, z: origin.z + direction.z * hit.along }
      : { x: origin.x + direction.x * weapon.range, y: 1.2, z: origin.z + direction.z * weapon.range };
    this.fireTracer(muzzle, end);
    if (hit) {
      this.burstSparks(end.x, end.y, end.z);
      if (hit.kind === 'pedestrian') this.callbacks.onHitPedestrian(hit.ref);
      if (hit.kind === 'car' || hit.kind === 'police') this.callbacks.onHitCar(hit.ref);
    }
    this.callbacks.onShot();
    if (weapon.mag === 0 && weapon.reserve > 0) {
      this.reloading = true;
      this.reloadTimer = RELOAD_SECONDS;
    }
    return 'shot';
  }

  update(dt) {
    this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
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
    let sparksMoved = false;
    for (let i = 0; i < SPARK_COUNT; i += 1) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt;
      this.sparkVelocities[i * 3 + 1] -= 9 * dt;
      this.sparkPositions[i * 3] += this.sparkVelocities[i * 3] * dt;
      this.sparkPositions[i * 3 + 1] += this.sparkVelocities[i * 3 + 1] * dt;
      this.sparkPositions[i * 3 + 2] += this.sparkVelocities[i * 3 + 2] * dt;
      if (this.sparkLife[i] <= 0) this.sparkPositions[i * 3 + 1] = -50;
      sparksMoved = true;
    }
    if (sparksMoved) this.sparks.geometry.attributes.position.needsUpdate = true;
  }
}
