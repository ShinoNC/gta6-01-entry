// Shared game context: the single mutable state object every module reads
// and writes. Splitting the old monolithic entry file into focused modules
// needs one place for the state they all share — this is it. `G` holds the
// run state (money, health, driven car, open screens), the built systems
// (city, player, police, missions, ...) once boot creates them, and the
// renderer/scene/camera/input/rng the entry file used to own. Tuning
// constants live in tuning.js; nothing here imports a game module that
// imports this one, so the graph stays acyclic.
import * as THREE from 'three';
import { Input } from './input.js';
import { makeRng } from './random.js';
import { loadSettings } from './save.js';
import { freshStats } from './business.js';
import { START_MONEY, CLOCK_START_MINUTES } from './tuning.js';

const $ = (id) => document.getElementById(id);
const on = (id, fn) => $(id).addEventListener('click', fn);
// Boot helpers: yield one frame between heavy build phases, and label the
// start button with the current phase so the title never looks frozen.
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
const setBootPhase = (label) => { $('start-button').textContent = label; };

const params = new URLSearchParams(window.location.search);
const seed = Number.parseInt(params.get('seed') || '1', 10) || 1;
const canvas = $('game-canvas');
// Antialiasing is off everywhere: MSAA costs 20-40% fill rate on the
// integrated GPUs this game targets, and the stylised art reads fine
// without it. (It used to be on for desktop; the lag reports showed
// the cost is not worth it.)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.shadowMap.enabled = true;
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);
// One real headlight for the player's car only (no shadow: perf). It
// follows whichever car is driven and switches off on foot / by day.
const headlight = new THREE.SpotLight(0xfff2cc, 1200, 35, 0.55, 0.4);
headlight.visible = false;
scene.add(headlight);
scene.add(headlight.target);
const input = new Input();
const rng = makeRng(seed);

const G = {
  // Renderer and world roots, built above.
  renderer, scene, camera, headlight, input, rng,
  // Run state.
  state: 'title',
  settings: loadSettings(),
  drivenCar: null,
  money: START_MONEY, rep: 0, prevStars: 0,
  skidSeconds: 0, driftChain: 0, nearMissAt: -99,
  elapsed: 0, health: 100, armour: 0,
  gameMinutes: CLOCK_START_MINUTES,
  arrestTimer: 0, lastHurtAt: -99,
  reachedFive: false, drownWarnAt: -99,
  titleOrbitAngle: 0,
  activeSlot: 1, overwriteArmed: false, promptAt: -99,
  booted: false,
  // Built systems — undefined until boot creates them.
  city: undefined, player: undefined, cars: undefined,
  chaseCamera: undefined, hud: undefined, traffic: undefined,
  pedestrians: undefined, beachgoers: undefined, basketball: undefined,
  gangs: undefined, wanted: undefined, police: undefined,
  missions: undefined, combat: undefined, dialogue: undefined,
  tapes: undefined, sideJobs: undefined, weather: undefined,
  robbery: undefined, audio: undefined, effects: undefined,
  businesses: undefined, textures: undefined,
  sprayBeacon: undefined, shopBeacon: undefined,
  shopWindowMat: undefined, shopSignMat: undefined,
  // On-foot walkers ejected from a stolen car (a fleeing driver/rider) or
  // a stolen police car (an officer chasing the player): { group, walker,
  // mode, timer, walkPhase, dx, dz }. They despawn when the timer runs out.
  walkers: [],
  // Screen flags.
  missionOpen: false, empireOpen: false, mapOpen: false,
  garageOpen: false, settingsOpen: false, styleOpen: false,
  statsOpen: false, saveOpen: false, loadOpen: false,
  phoneVisible: false, gunshotAt: null,
  menuOpen: false, menuTab: 'map', waypoint: null,
  // Progression.
  garage: { engine: false, armour: false, nitro: false },
  stats: freshStats(),
  unlockedAchievements: [],
  freeObj: 'Mara has a job for you — head to the gold marker',
  look: { hair: 0, shirt: 0, skin: 0 },
};

export { $, on, nextFrame, setBootPhase, G };
