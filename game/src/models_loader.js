import * as THREE from 'three';
import { GLTFLoader } from '../vendor/GLTFLoader.js';

// Shared GLB loader for people and props. Every load is cached by URL, so
// 90 pedestrians cost 7 downloads; every instance is a full clone with its
// own skeleton and its own materials, so recolouring one person never leaks
// into another (or into the cached source). Paths are relative to the game
// directory and resolved against this module's URL (src/ -> ../assets/).
const PEOPLE = [
  'casual-man', 'casual-woman', 'business-man', 'business-woman', 'doctor',
  'construction-worker', 'runner-woman', 'soldier',
];
const PROPS = [
  'a-frame-cabin', 'ambulance', 'assault-rifle', 'beach-house',
  'boxy-off-roader', 'bungalow', 'coconut-palm', 'container-home',
  'corner-cafe', 'executive-sedan', 'family-house', 'luxury-suv',
  'mid-engine-supercar', 'modern-house', 'office-tower', 'pistol',
  'police-car', 'road-crossroads', 'road-straight', 'speedboat', 'sport-motorcycle',
  'street-light', 'supermarket', 'tiny-house', 'traffic-signal',
];
export const MODEL_PATHS = {};
for (const n of [...PEOPLE, ...PROPS]) MODEL_PATHS[n] = `assets/models/${n}.glb`;
// Combat/locomotion clip library (Vinish Mannequin Man, CC-BY 4.0): 10
// clips extracted from the 36-clip pack. NOTE: these target the mannequin's
// 65-bone Mixamo skeleton (mixamorig:* names) and do NOT play directly on
// the 17-bone Vinish people — they need a Blender retarget first.
MODEL_PATHS.animations = 'assets/models/animations.glb';
export const PEOPLE_MODELS = PEOPLE;
// Civilians for street crowds: soldier is police-only, never a pedestrian.
export const CIVILIAN_MODELS = PEOPLE.slice(0, 7);

const loader = new GLTFLoader();
const cache = new Map();
// Current clip action per mixer. (AnimationMixer has no userData in the
// vendored three r160, so the action is tracked here, not on the mixer.)
const currentActions = new WeakMap();

function resolveUrl(path) {
  if (/^(https?:|blob:|data:)/.test(path) || path.startsWith('/')) return path;
  if (path.startsWith('assets/')) return new URL(`../${path}`, import.meta.url).href;
  return new URL(path, import.meta.url).href;
}

export function loadGLB(path) {
  const url = resolveUrl(path);
  let p = cache.get(url);
  if (!p) {
    p = loader.loadAsync(url).catch((err) => {
      cache.delete(url);
      throw err;
    });
    cache.set(url, p);
  }
  return p;
}

// SkeletonUtils-style clone: Object3D.clone() shares the skeleton across
// instances, so each SkinnedMesh is re-bound to the cloned bones.
function cloneSkinned(source) {
  const clone = source.clone(true);
  const srcNodes = [];
  const cloneNodes = [];
  source.traverse((o) => srcNodes.push(o));
  clone.traverse((o) => cloneNodes.push(o));
  const lookup = new Map();
  const reverse = new Map();
  for (let i = 0; i < srcNodes.length; i += 1) {
    lookup.set(srcNodes[i], cloneNodes[i]);
    reverse.set(cloneNodes[i], srcNodes[i]);
  }
  clone.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const srcMesh = reverse.get(o);
    const bones = srcMesh.skeleton.bones.map((b) => lookup.get(b));
    o.bind(new THREE.Skeleton(bones, srcMesh.skeleton.boneInverses), srcMesh.bindMatrix);
  });
  return clone;
}

function cloneMaterials(group) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    o.material = Array.isArray(o.material)
      ? o.material.map((m) => m.clone())
      : o.material.clone();
  });
}

export async function loadPerson(name) {
  const path = MODEL_PATHS[name];
  if (!path) throw new Error(`Unknown person model: ${name}`);
  const gltf = await loadGLB(path);
  const group = cloneSkinned(gltf.scene);
  cloneMaterials(group);
  const clips = { idle: null, walk: null, run: null };
  for (const clip of gltf.animations || []) {
    const n = clip.name.toLowerCase();
    if (n.includes('idle')) clips.idle = clip;
    else if (n.includes('walk')) clips.walk = clip;
    else if (n.includes('run')) clips.run = clip;
  }
  const mixer = new THREE.AnimationMixer(group);
  // Settle into a natural pose at once: the Vinish bind pose is curled
  // (0.56m tall), so nothing may ever render it — not even for one frame.
  if (clips.idle) {
    const action = mixer.clipAction(clips.idle);
    action.play();
    currentActions.set(mixer, action);
    mixer.update(0.5);
  }
  const bones = new Map();
  group.traverse((o) => {
    if (o.isBone) bones.set(o.name, o);
  });
  group.userData.mixer = mixer;
  group.userData.clips = clips;
  group.updateMatrixWorld(true);
  return { group, mixer, clips, bones };
}

export async function loadProp(name) {
  const path = MODEL_PATHS[name];
  if (!path) throw new Error(`Unknown prop model: ${name}`);
  const gltf = await loadGLB(path);
  const group = cloneSkinned(gltf.scene);
  cloneMaterials(group);
  return group;
}

// Switch a person's clip (idle/walk/run). No-op when already playing, so
// callers can call it every frame; only the timeScale is refreshed then.
export function playClip(mixer, clips, name, timeScale = 1) {
  if (!mixer || !clips) return null;
  const clip = clips[name];
  if (!clip) return null;
  const prev = currentActions.get(mixer);
  if (prev && prev.getClip() === clip) {
    if (prev.timeScale !== timeScale) prev.timeScale = timeScale;
    return prev;
  }
  if (prev) prev.stop();
  const action = mixer.clipAction(clip);
  action.reset();
  action.timeScale = timeScale;
  action.play();
  currentActions.set(mixer, action);
  return action;
}

export function findBone(group, fragment) {
  const frag = fragment.toLowerCase();
  let found = null;
  group.traverse((o) => {
    if (!found && o.isBone && o.name.toLowerCase().includes(frag)) found = o;
  });
  return found;
}

// Scale the group so its height is targetM. The idle clip is started first
// and the matrix updated before measuring: the bind pose measures 0.56m,
// the animated pose 1.71-1.79m.
export function normaliseHeight(group, targetM) {
  const mixer = group.userData.mixer;
  const clips = group.userData.clips;
  if (mixer && clips && clips.idle) {
    const current = currentActions.get(mixer);
    if (!current || current.getClip() !== clips.idle) {
      mixer.stopAllAction();
      const action = mixer.clipAction(clips.idle);
      action.play();
      currentActions.set(mixer, action);
    }
    mixer.update(0.5);
  }
  group.updateMatrixWorld(true);
  const size = new THREE.Vector3();
  new THREE.Box3().setFromObject(group).getSize(size);
  if (size.y <= 0) return 1;
  const s = targetM / size.y;
  group.scale.multiplyScalar(s);
  group.updateMatrixWorld(true);
  return s;
}

const POLICE_NAVY = 0x1d2b53;
const POLICE_DARK = 0x141c2e;

// Recolour materials picked by name: pick(name) returns a hex colour or
// null. Matched materials are cloned first, so the cached source stays
// clean; unmap also drops the texture (the camo print must go, not tint).
function recolourMaterials(group, pick, unmap) {
  group.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    let changed = false;
    const next = mats.map((mat) => {
      if (!mat || !mat.name) return mat;
      const hex = pick(mat.name.toLowerCase());
      if (hex === null || hex === undefined) return mat;
      const copy = mat.clone();
      if (unmap) copy.map = null;
      copy.color.setHex(hex);
      copy.needsUpdate = true;
      changed = true;
      return copy;
    });
    if (changed) o.material = Array.isArray(o.material) ? next : next[0];
  });
}

// Navy police recolour of the soldier model.
export function recolourPolice(group) {
  recolourMaterials(group, (n) => {
    if (n.includes('camo') || n.includes('helmet')) return POLICE_NAVY;
    if (n.includes('olive_drab')) return POLICE_DARK;
    return null;
  }, true);
}

// Best-effort recolour by material-name substring; names not found are
// skipped. Skin matches Skin_*/skin (face materials are left alone, they
// carry the face texture).
const SHIRT_MATCH = ['tee_', 'knit', 'shirt', 'suit', 'scrubs', 'coat', 'hivis', 'top'];
const PANTS_MATCH = ['denim', 'cargo', 'legging', 'tights', 'bottoms'];
export function setPersonColours(group, { skin, hair, shirt, pants } = {}) {
  recolourMaterials(group, (n) => {
    if (skin !== undefined && n.includes('skin')) return skin;
    if (hair !== undefined && n.includes('hair')) return hair;
    if (shirt !== undefined && SHIRT_MATCH.some((f) => n.includes(f))) return shirt;
    if (pants !== undefined && PANTS_MATCH.some((f) => n.includes(f))) return pants;
    return null;
  });
}

export function preloadPeople() {
  return Promise.all(PEOPLE_MODELS.map((name) => loadGLB(MODEL_PATHS[name])))
    .then(() => undefined);
}

// Preload only the models visible from the title camera orbit
// (south beach, centre (0, 200)): palms, houses, the 3 most common
// pedestrians, the most common traffic car, and road tiles — about
// 9 MB instead of the full 29 MB. Loading everything took 12s on
// mobile; the rest (special vehicles, downtown buildings, weapons,
// rare peds, animations) streams in during play, where a hitch is
// far less noticeable than on the static title screen. The office
// tower is preloaded separately at city.js module import.
const TITLE_MODELS = [
  'coconut-palm',
  'modern-house', 'beach-house', 'container-home', 'bungalow',
  'family-house', 'a-frame-cabin', 'tiny-house',
  'casual-man', 'casual-woman', 'runner-woman',
  'executive-sedan',
  'road-straight', 'road-crossroads',
];
export function preloadAllModels() {
  return Promise.all(TITLE_MODELS.map((name) => loadGLB(MODEL_PATHS[name]).catch(() => null)))
    .then(() => undefined);
}

// The 10-clip animation library as a name -> AnimationClip map (cached).
// See the MODEL_PATHS.animations note: Mixamo-skeleton clips, retarget
// before playing on the Vinish people.
let animationsCache = null;
export function loadAnimations() {
  if (!animationsCache) {
    animationsCache = loadGLB(MODEL_PATHS.animations).then((gltf) => {
      const map = new Map();
      for (const clip of gltf.animations || []) map.set(clip.name, clip);
      return map;
    }).catch((err) => {
      animationsCache = null;
      throw err;
    });
  }
  return animationsCache;
}
