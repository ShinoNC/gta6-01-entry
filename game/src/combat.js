import * as THREE from 'three';

// Weapon rows: [id, name, range, cooldown, mag, reserve, locked, damage].
const WEAPON_ROWS = [
  ['fists', 'FISTS', 2.6, 0.45, 0, 0, false, 10],
  ['pistol', 'PISTOL', 60, 0.28, 12, 48, true, 12],
  ['smg', 'SMG', 45, 0.09, 30, 90, true, 12],
  ['shotgun', 'SHOTGUN', 30, 0.7, 6, 24, true, 30],
];
const WEAPON_FIELDS = ['id', 'name', 'range', 'cooldownSeconds', 'magSize', 'reserveAmmo', 'locked', 'damage'];
// Ammo crate spots: [x, z, name].
const CRATE_ROWS = [
  [26, 26, 'Pelican Bay'],
  [-78, -52, 'Old Port'],
  [78, -130, 'Harbor Lights'],
];
// Gun routing: slot id -> GLB prop name (the rifle serves SMG + Shotgun).
const GUN_MODELS = new Map([
  ['pistol', 'pistol'],
  ['smg', 'assault-rifle'],
  ['shotgun', 'assault-rifle'],
]);
// Grip offsets per GLB prop, measured from the Vinish models (muzzle +Z,
// grip below the barrel line): [x, y, z].
const GUN_OFFSETS = new Map([
  ['pistol', [0, -0.075, 0.055]],
  ['assault-rifle', [0, -0.19, 0.07]],
]);
const TUNE = {
  reload: 1.2,
  tracerLife: 0.09,
  tracerPool: 6,
  muzzleFlash: 0.06,
  spreadBase: 0.004,
  spreadShot: 0.012,
  spreadMax: 0.09,
  spreadRecover: 0.12,
  recoilShot: 0.35,
  recoilRecover: 3,
  fistRecoil: 0.3,
  cratePickup: 3,
  crateRespawn: 45,
  gunMount: [0.48, 1, 0.12],
  parentRetry: 1,
};
const GUN_DARK = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
const GUN_GRIP = new THREE.MeshLambertMaterial({ color: 0x1d1d20 });
// Box fallback gun parts per model: [w, h, d, x, y, z, grip?, tiltX].
// Built in the same model space as the GLB (origin at the grip, muzzle
// +Z), so the GLB swap needs no transform change.
const BOX_GUN_PARTS = {
  pistol: [
    [0.03, 0.04, 0.2, 0, 0.12, 0, false, 0],
    [0.026, 0.085, 0.05, 0, 0.042, -0.067, true, 0.25],
  ],
  'assault-rifle': [
    [0.05, 0.09, 0.88, 0, 0.2, 0.03, false, 0],
    [0.03, 0.19, 0.08, 0, 0.096, 0.04, true, 0],
    [0.03, 0.13, 0.05, 0, 0.135, -0.07, true, 0.3],
    [0.04, 0.12, 0.16, 0, 0.16, -0.34, true, 0],
  ],
};
// Right-hand bone names, in all the spellings rigs use.
const HAND_BONE_TEST = /^(hand_r|hand-r)$|righthand|right_hand/;
// Ammo crate parts: a green box, a light lid, a spinning marker.
const CRATE_PARTS = [
  { kind: 'box', w: 0.9, h: 0.6, d: 0.9, color: 0x2a8a4a, y: 0.3, marker: false },
  { kind: 'box', w: 0.95, h: 0.14, d: 0.95, color: 0x7affc4, y: 0.65, marker: false },
  { kind: 'octa', r: 0.35, color: 0x7affc4, y: 1.6, marker: true },
];
// What a hit does, by target kind. Pedestrians take the plain callback;
// vehicles, getaway cars and helicopters use the optional ones.
const HIT_HANDLERS = {
  pedestrian: (cb, hit, dmg) => cb.onHitPedestrian(hit.ref, true),
  car: (cb, hit, dmg) => cb.onHitCar?.(hit.ref, dmg),
  police: (cb, hit, dmg) => cb.onHitCar?.(hit.ref, dmg),
  getaway: (cb, hit) => cb.onHitGetaway?.(hit.ref),
  helicopter: (cb, hit, dmg) => cb.onHitHelicopter?.(hit.ref, dmg),
};

function buildWeaponSlots() {
  const slots = [];
  for (let r = 0; r < WEAPON_ROWS.length; r += 1) {
    const row = WEAPON_ROWS[r];
    const slot = {};
    for (let i = 0; i < WEAPON_FIELDS.length; i += 1) slot[WEAPON_FIELDS[i]] = row[i];
    slot.mag = slot.magSize;
    slot.reserve = slot.reserveAmmo;
    slots.push(slot);
  }
  return slots;
}

function buildBoxGun(modelName) {
  const holder = new THREE.Group();
  const parts = BOX_GUN_PARTS[modelName] || BOX_GUN_PARTS['assault-rifle'];
  for (let i = 0; i < parts.length; i += 1) {
    const [w, h, d, x, y, z, grip, tilt] = parts[i];
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), grip ? GUN_GRIP : GUN_DARK);
    mesh.position.set(x, y, z);
    if (tilt) mesh.rotation.x = tilt;
    mesh.castShadow = true;
    holder.add(mesh);
  }
  return holder;
}

function findHandBone(root) {
  let found = null;
  root.traverse((child) => {
    if (found || !child.isBone) return;
    if (HAND_BONE_TEST.test(child.name.toLowerCase())) found = child;
  });
  return found;
}

// Nearest target inside a 2D corridor along the shot direction.
function rayHit(origin, direction, range, targets, los) {
  let best = null;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const along = dx * direction.x + dz * direction.z;
    if (along < 0 || along > range) continue;
    const miss = Math.abs(dx * direction.z - dz * direction.x);
    if (miss > target.radius) continue;
    if (los && !los(origin, target)) continue;
    if (!best || along < best.along) best = { ...target, along };
  }
  return best;
}

function makeAmmoCrate(scene, row) {
  const holder = new THREE.Group();
  let marker = null;
  for (let i = 0; i < CRATE_PARTS.length; i += 1) {
    const part = CRATE_PARTS[i];
    let mesh;
    if (part.kind === 'octa') {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(part.r), new THREE.MeshBasicMaterial({ color: part.color }));
      marker = mesh;
    } else {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(part.w, part.h, part.d), new THREE.MeshLambertMaterial({ color: part.color }));
    }
    mesh.position.y = part.y;
    holder.add(mesh);
  }
  holder.position.set(row[0], 0, row[1]);
  scene.add(holder);
  return { group: holder, marker, x: row[0], z: row[1], name: row[2], available: true, respawnTimer: 0 };
}

function buildTracerPool(scene, count) {
  const pool = [];
  for (let i = 0; i < count; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xfff2a8, transparent: true, opacity: 0, blending: THREE.AdditiveBlending }));
    line.visible = false;
    scene.add(line);
    pool.push({ line, life: 0 });
  }
  return pool;
}

function buildMuzzleFlash(scene) {
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  flash.visible = false;
  scene.add(flash);
  return flash;
}

function buildGunRigs() {
  const rigs = {};
  for (const [id, modelName] of GUN_MODELS) {
    const offset = GUN_OFFSETS.get(modelName);
    const mount = new THREE.Group();
    const model = new THREE.Group();
    model.position.set(offset[0], offset[1], offset[2]);
    const box = buildBoxGun(modelName);
    model.add(box);
    mount.add(model);
    mount.visible = false;
    rigs[id] = { mount, model, box, glb: null, modelName, loaded: false };
  }
  return rigs;
}

export class Combat {
  constructor(scene, callbacks, effects) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.effects = effects;
    this.weapons = buildWeaponSlots();
    this.selected = 0;
    this.cooldownTimer = 0;
    this.reloading = false;
    this.reloadTimer = 0;
    this.muzzleTimer = 0;
    this.spread = TUNE.spreadBase;
    this.recoil = 0;
    this.tracerIndex = 0;
    this.tracers = buildTracerPool(scene, TUNE.tracerPool);
    this.muzzle = buildMuzzleFlash(scene);
    this.gunGroups = buildGunRigs();
    this.playerRef = null;
    this.playerGroup = null;
    this.gunParent = null;
    this.gunParentIsBone = false;
    this.gunParentRetryTimer = 0;
    this.loadGunModels();
    this.ammoCrates = [];
    for (let i = 0; i < CRATE_ROWS.length; i += 1) {
      this.ammoCrates.push(makeAmmoCrate(scene, CRATE_ROWS[i]));
    }
  }

  currentWeapon() {
    return this.weapons[this.selected];
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
    let tries = 0;
    while (tries < this.weapons.length) {
      tries += 1;
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
    for (let i = 0; i < this.weapons.length; i += 1) {
      if (this.weapons[i].id === id) this.weapons[i].locked = false;
    }
  }

  ownedWeaponIds() {
    const ids = [];
    for (let i = 0; i < this.weapons.length; i += 1) {
      if (!this.weapons[i].locked) ids.push(this.weapons[i].id);
    }
    return ids;
  }

  setOwnedWeapons(ids) {
    for (let i = 0; i < this.weapons.length; i += 1) {
      this.weapons[i].locked = !ids.includes(this.weapons[i].id);
    }
  }

  restock() {
    for (let i = 0; i < this.weapons.length; i += 1) {
      const weapon = this.weapons[i];
      weapon.mag = weapon.magSize;
      weapon.reserve = weapon.reserveAmmo;
    }
    this.reloading = false;
  }

  ammoForHud() {
    const rows = [];
    for (let i = 0; i < this.weapons.length; i += 1) {
      const weapon = this.weapons[i];
      rows.push({
        name: weapon.name,
        mag: weapon.mag,
        reserve: weapon.reserve,
        active: i === this.selected,
        locked: weapon.locked,
        reloading: this.reloading && i === this.selected,
      });
    }
    return rows;
  }

  ammoCratesForHud() {
    const rows = [];
    for (let i = 0; i < this.ammoCrates.length; i += 1) {
      const crate = this.ammoCrates[i];
      rows.push({ x: crate.x, z: crate.z, available: crate.available });
    }
    return rows;
  }

  // Hand the combat system the player object (main calls this after
  // both exist). The gun hangs off the right-hand bone when the
  // player model is loaded, and off the player group at hand height
  // until then.
  setPlayer(player) {
    this.playerRef = player || null;
    this.gunParentRetryTimer = 0;
    this.refreshGunParent();
  }

  handBoneFrom(player) {
    if (typeof player.getHandBone !== 'function') return null;
    let found = null;
    try {
      found = player.getHandBone();
    } catch (err) {
      found = null;
    }
    // getHandBone returns the group itself until the model loads —
    // only a real bone counts as the bone mount.
    return found && found.isBone ? found : null;
  }

  mountOn(root) {
    const found = findHandBone(root);
    if (found) return { parent: found, isBone: true };
    return { parent: root, isBone: false };
  }

  resolveGunParent() {
    const player = this.playerRef;
    if (player) {
      const bone = this.handBoneFrom(player);
      if (bone) return { parent: bone, isBone: true };
      if (player.group && player.group.isObject3D) return this.mountOn(player.group);
    }
    if (this.playerGroup) return this.mountOn(this.playerGroup);
    return null;
  }

  refreshGunParent() {
    const resolved = this.resolveGunParent();
    if (!resolved || resolved.parent === this.gunParent) return;
    this.gunParent = resolved.parent;
    this.gunParentIsBone = resolved.isBone;
    const keys = Object.keys(this.gunGroups);
    for (let i = 0; i < keys.length; i += 1) {
      const rig = this.gunGroups[keys[i]];
      resolved.parent.add(rig.mount);
      if (resolved.isBone) {
        rig.mount.position.set(0, 0, 0);
      } else {
        rig.mount.position.set(TUNE.gunMount[0], TUNE.gunMount[1], TUNE.gunMount[2]);
      }
      rig.mount.rotation.set(0, 0, 0);
    }
  }

  refreshWeaponVisibility() {
    const active = this.currentWeapon().id;
    const keys = Object.keys(this.gunGroups);
    for (let i = 0; i < keys.length; i += 1) {
      this.gunGroups[keys[i]].mount.visible = keys[i] === active;
    }
  }

  // GLB guns load in the background; the box gun shows until each one
  // arrives and stays on any failure (missing loader, missing file).
  loadGunModels() {
    import('./models_loader.js').then((loader) => {
      const keys = Object.keys(this.gunGroups);
      for (let i = 0; i < keys.length; i += 1) {
        const rig = this.gunGroups[keys[i]];
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
    this.gunParentRetryTimer = TUNE.parentRetry;
    // No player object handed over: find the player group in the scene
    // by position identity (update receives the group's own vector).
    if (!this.playerGroup && !this.playerRef && playerPos) {
      let found = null;
      this.scene.traverse((child) => {
        if (!found && child.position === playerPos) found = child;
      });
      if (found) this.playerGroup = found;
    }
    this.refreshGunParent();
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
    tracer.life = TUNE.tracerLife;
  }

  tryShoot(origin, aimYaw, targets) {
    if (this.cooldownTimer > 0 || this.reloading) return 'busy';
    const weapon = this.currentWeapon();
    const err = (Math.random() - 0.5) * 2 * this.spread;
    const dir = { x: -Math.sin(aimYaw + err), z: -Math.cos(aimYaw + err) };
    this.cooldownTimer = weapon.cooldownSeconds;
    if (weapon.id === 'fists') return this.swingFists(origin, dir, weapon, targets);
    return this.fireRound(origin, dir, weapon, targets);
  }

  swingFists(origin, dir, weapon, targets) {
    const peds = [];
    for (let i = 0; i < targets.length; i += 1) {
      if (targets[i].kind === 'pedestrian') peds.push(targets[i]);
    }
    const hit = rayHit(origin, dir, weapon.range, peds, this.callbacks.los);
    if (!hit) return 'whiff';
    this.callbacks.onHitPedestrian(hit.ref, false);
    this.callbacks.onDamage?.({ x: hit.x, y: 1.2, z: hit.z }, weapon.damage);
    this.recoil = Math.min(1, this.recoil + TUNE.fistRecoil);
    return 'punch';
  }

  fireRound(origin, dir, weapon, targets) {
    if (weapon.mag <= 0) {
      if (weapon.reserve > 0) {
        this.reloading = true;
        this.reloadTimer = TUNE.reload;
        return 'reloading';
      }
      return 'empty';
    }
    weapon.mag -= 1;
    this.spread = Math.min(TUNE.spreadMax, this.spread + TUNE.spreadShot);
    this.recoil = Math.min(1, this.recoil + TUNE.recoilShot);
    const mx = origin.x + dir.x * 0.9;
    const mz = origin.z + dir.z * 0.9;
    this.muzzle.position.set(mx, 1.4, mz);
    this.muzzle.rotation.z = Math.random() * Math.PI;
    const flash = 0.8 + Math.random() * 0.5;
    this.muzzle.scale.set(flash, flash, 1);
    this.muzzle.visible = true;
    this.muzzleTimer = TUNE.muzzleFlash;
    const hit = rayHit(origin, dir, weapon.range, targets, this.callbacks.los);
    const dist = hit ? hit.along : weapon.range;
    const end = { x: origin.x + dir.x * dist, y: 1.2, z: origin.z + dir.z * dist };
    this.fireTracer({ x: mx, y: 1.4, z: mz }, end);
    if (hit) {
      this.effects.burstSparks(end.x, end.y, end.z);
      this.callbacks.onDamage?.(end, weapon.damage);
      const handle = HIT_HANDLERS[hit.kind];
      if (handle) handle(this.callbacks, hit, weapon.damage);
    }
    this.callbacks.onShot();
    if (weapon.mag === 0 && weapon.reserve > 0) {
      this.reloading = true;
      this.reloadTimer = TUNE.reload;
    }
    return 'shot';
  }

  finishReload() {
    const weapon = this.currentWeapon();
    const taken = Math.min(weapon.magSize, weapon.reserve);
    weapon.mag = taken;
    weapon.reserve -= taken;
    this.reloading = false;
  }

  tickTracers(dt) {
    for (let i = 0; i < this.tracers.length; i += 1) {
      const tracer = this.tracers[i];
      if (tracer.life <= 0) continue;
      tracer.life -= dt;
      tracer.line.material.opacity = Math.max(0, tracer.life / TUNE.tracerLife) * 0.9;
      if (tracer.life <= 0) tracer.line.visible = false;
    }
  }

  tickCrates(dt, playerPos) {
    for (let i = 0; i < this.ammoCrates.length; i += 1) {
      const crate = this.ammoCrates[i];
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
      if (playerPos && Math.hypot(playerPos.x - crate.x, playerPos.z - crate.z) < TUNE.cratePickup) {
        this.restock();
        crate.available = false;
        crate.respawnTimer = TUNE.crateRespawn;
        crate.group.visible = false;
        this.callbacks.onAmmoPickup(crate.name);
      }
    }
  }

  update(dt, playerPos) {
    this.updateGunMount(dt, playerPos);
    this.cooldownTimer = Math.max(0, this.cooldownTimer - dt);
    this.spread = Math.max(TUNE.spreadBase, this.spread - TUNE.spreadRecover * dt);
    this.recoil = Math.max(0, this.recoil - TUNE.recoilRecover * dt);
    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) this.finishReload();
    }
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) this.muzzle.visible = false;
    }
    this.tickTracers(dt);
    this.tickCrates(dt, playerPos);
  }
}
