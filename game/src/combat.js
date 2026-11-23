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
// Weapon models: one GLB prop per slot (the rifle serves SMG + Shotgun).
// The GLBs load async via the shared loader; a box gun shows until the
// GLB arrives, and stays if the load fails.
const GUN_MODEL_NAMES = { pistol: 'pistol', smg: 'assault-rifle', shotgun: 'assault-rifle' };
// Model-space offset that centres the grip on the mount point, measured
// from the Vinish GLBs (muzzle +Z, grip below the barrel line): the wrist
// sits at the top of the grip, the barrel just above the hand.
const GUN_MODEL_OFFSETS = {
  pistol: { x: 0, y: -0.075, z: 0.055 },
  'assault-rifle': { x: 0, y: -0.19, z: 0.07 },
};
// Group fallback mount (no hand bone yet): the game's action arm sits at
// x +0.48, hand height, slightly forward so the muzzle clears the body.
const GUN_GROUP_MOUNT = { x: 0.48, y: 1, z: 0.12 };
const GUN_PARENT_RETRY_SECONDS = 1;
const BOX_GUN_DARK = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
const BOX_GUN_GRIP = new THREE.MeshLambertMaterial({ color: 0x1d1d20 });
// Box fallback gun, built in the same model space as the GLB (origin at
// the grip, muzzle +Z), so the GLB swap needs no transform change.
function buildBoxGun(modelName) {
  const group = new THREE.Group();
  const addBox = (w, h, d, x, y, z, mat, rx = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || BOX_GUN_DARK);
    mesh.position.set(x, y, z);
    if (rx) mesh.rotation.x = rx;
    mesh.castShadow = true;
    group.add(mesh);
  };
  if (modelName === 'pistol') {
    addBox(0.03, 0.04, 0.2, 0, 0.12, 0);
    addBox(0.026, 0.085, 0.05, 0, 0.042, -0.067, BOX_GUN_GRIP, 0.25);
  } else {
    addBox(0.05, 0.09, 0.88, 0, 0.2, 0.03);
    addBox(0.03, 0.19, 0.08, 0, 0.096, 0.04, BOX_GUN_GRIP);
    addBox(0.03, 0.13, 0.05, 0, 0.135, -0.07, BOX_GUN_GRIP, 0.3);
    addBox(0.04, 0.12, 0.16, 0, 0.16, -0.34, BOX_GUN_GRIP);
  }
  return group;
}
function findHandBone(group) {
  let found = null;
  group.traverse((child) => {
    if (found || !child.isBone) return;
    const name = child.name.toLowerCase();
    if (name === 'hand_r' || name === 'hand-r' || name.includes('righthand') || name.includes('right_hand')) found = child;
  });
  return found;
}
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
    this.gunGroups = {};
    for (const id of ['pistol', 'smg', 'shotgun']) {
      const modelName = GUN_MODEL_NAMES[id];
      const offset = GUN_MODEL_OFFSETS[modelName];
      const mount = new THREE.Group();
      const model = new THREE.Group();
      model.position.set(offset.x, offset.y, offset.z);
      const box = buildBoxGun(modelName);
      model.add(box);
      mount.add(model);
      mount.visible = false;
      this.gunGroups[id] = { mount, model, box, glb: null, modelName, loaded: false };
    }
    this.playerRef = null;
    this.playerGroup = null;
    this.gunParent = null;
    this.gunParentIsBone = false;
    this.gunParentRetryTimer = 0;
    this.loadGunModels();
    this.ammoCrates = AMMO_CRATE_SPOTS.map((spot) => buildAmmoCrate(scene, spot));
  }
  currentWeapon() {
    return this.weapons[this.selected];
  }
  // Hand the combat system the player object (main calls this after both
  // exist). The gun hangs off the right-hand bone when the player model
  // is loaded, and off the player group at hand height until then.
  setPlayer(player) {
    this.playerRef = player || null;
    this.gunParentRetryTimer = 0;
    this.refreshGunParent();
  }
  resolveGunParent() {
    const player = this.playerRef;
    if (player) {
      if (typeof player.getHandBone === 'function') {
        let bone = null;
        try {
          bone = player.getHandBone();
        } catch (error) {
          bone = null;
        }
        // getHandBone returns the group itself until the model loads —
        // only a real bone counts as the bone mount.
        if (bone && bone.isBone) return { parent: bone, isBone: true };
      }
      if (player.group && player.group.isObject3D) {
        const bone = findHandBone(player.group);
        if (bone) return { parent: bone, isBone: true };
        return { parent: player.group, isBone: false };
      }
    }
    if (this.playerGroup) {
      const bone = findHandBone(this.playerGroup);
      if (bone) return { parent: bone, isBone: true };
      return { parent: this.playerGroup, isBone: false };
    }
    return null;
  }
  refreshGunParent() {
    const resolved = this.resolveGunParent();
    if (!resolved) return;
    if (resolved.parent === this.gunParent) return;
    this.gunParent = resolved.parent;
    this.gunParentIsBone = resolved.isBone;
    for (const rig of Object.values(this.gunGroups)) {
      resolved.parent.add(rig.mount);
      if (resolved.isBone) rig.mount.position.set(0, 0, 0);
      else rig.mount.position.set(GUN_GROUP_MOUNT.x, GUN_GROUP_MOUNT.y, GUN_GROUP_MOUNT.z);
      rig.mount.rotation.set(0, 0, 0);
    }
  }
  refreshWeaponVisibility() {
    const id = this.currentWeapon().id;
    for (const [key, rig] of Object.entries(this.gunGroups)) rig.mount.visible = key === id;
  }
  // GLB guns load in the background; the box gun shows until each one
  // arrives and stays on any failure (missing loader, missing file).
  loadGunModels() {
    import('./models_loader.js').then((loader) => {
      for (const rig of Object.values(this.gunGroups)) {
        loader.loadProp(rig.modelName).then((glb) => {
          if (rig.loaded) return;
          rig.loaded = true;
          rig.glb = glb;
          glb.traverse((child) => {
            if (child.isMesh) child.castShadow = true;
          });
          rig.model.remove(rig.box);
          rig.model.add(glb);
        }).catch(() => {});
      }
    }).catch(() => {});
  }
  updateGunMount(dt, playerPos) {
    this.gunParentRetryTimer -= dt;
    if (this.gunParentRetryTimer > 0) return;
    this.gunParentRetryTimer = GUN_PARENT_RETRY_SECONDS;
    // No player object handed over: find the player group in the scene by
    // position identity (update receives the group's own position vector).
    if (!this.playerGroup && !this.playerRef && playerPos) {
      let found = null;
      this.scene.traverse((child) => {
        if (!found && child.position === playerPos) found = child;
      });
      if (found) this.playerGroup = found;
    }
    this.refreshGunParent();
  }
  selectWeapon(index) {
    if (index < 0 || index >= this.weapons.length) return 'invalid';
    if (this.weapons[index].locked) return 'locked';
    this.selected = index;
    this.reloading = false;
    this.refreshWeaponVisibility();
    return 'ok';
  }
  cycleWeapon(step) {
    for (let tries = 0; tries < this.weapons.length; tries += 1) {
      this.selected = (this.selected + step + this.weapons.length) % this.weapons.length;
      if (!this.weapons[this.selected].locked) {
        this.reloading = false;
        this.refreshWeaponVisibility();
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
    this.updateGunMount(dt, playerPos);
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