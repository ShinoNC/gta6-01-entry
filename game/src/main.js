// SOLARIS KEYS — game entry point. Wires the renderer, city, player, cars,
// camera and HUD together and runs the loop. States: title (orbiting camera
// over the city), play, pause. F enters/exits the nearest car. The ?shot=
// query stages deterministic scenes for screenshots (see shots.json).
import * as THREE from 'three';
import { makeRng } from './random.js';
import { loadTextures } from './textures.js';
import { Input } from './input.js';
import { buildCity } from './city.js';
import { createPlayer } from './player.js';
import { createCars } from './vehicles.js';
import { ChaseCamera } from './camera.js';
import { Hud } from './hud.js';

const SPAWN_X = 0;
const SPAWN_Z = 0;
const START_MONEY = 1250;
const ENTER_CAR_RANGE = 5;
const SHOT_DRIVE_SECONDS = 3.2;

const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot') || '';
const seed = Number.parseInt(params.get('seed') || '1', 10) || 1;

const canvas = document.getElementById('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 900);

const input = new Input();
const rng = makeRng(seed);

let state = 'title';
let city;
let player;
let cars;
let chaseCamera;
let hud;
let drivenCar = null;
let money = START_MONEY;
let wanted = 0;
let health = 100;
let armour = 0;
let titleOrbitAngle = 0;
let shotTimer = 0;
let shotReady = false;

const titleScreen = document.getElementById('title-screen');
const pauseScreen = document.getElementById('pause-screen');

function startGame() {
  state = 'play';
  titleScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  hud.setObjective('Explore Solaris Keys — press F near a car to drive it');
}

function togglePause() {
  if (state === 'play') {
    state = 'pause';
    pauseScreen.classList.remove('hidden');
  } else if (state === 'pause') {
    startGame();
  }
}

document.getElementById('start-button').addEventListener('click', startGame);
document.getElementById('resume-button').addEventListener('click', startGame);
document.getElementById('restart-button').addEventListener('click', () => window.location.reload());

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function nearestCar(position) {
  let best = null;
  let bestDist = ENTER_CAR_RANGE;
  for (const car of cars) {
    const dx = car.position.x - position.x;
    const dz = car.position.z - position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < bestDist) {
      bestDist = dist;
      best = car;
    }
  }
  return best;
}

function enterCar(car) {
  drivenCar = car;
  car.driven = true;
  player.group.visible = false;
  hud.showMessage(`ENTERED ${car.name} — W to drive, S to brake`);
}

function exitCar() {
  const car = drivenCar;
  drivenCar = null;
  car.driven = false;
  car.speed = 0;
  player.group.position.set(car.position.x + 2.5, 0, car.position.z);
  player.group.visible = true;
  hud.showMessage('ON FOOT — WASD to walk, F near a car to drive');
}

// The screenshot scenes: 'core' puts the player in the starter car and drives
// it up the main avenue, so the frame proves the drive loop works.
function stageShot() {
  if (shotName === 'core') {
    startGame();
    enterCar(cars[0]);
    hud.showMessage('SOLARIS KEYS — free roam', 300);
  }
}

function update(dt) {
  if (input.pressed('Enter') && state === 'title') startGame();
  if (input.pressed('Escape') && (state === 'play' || state === 'pause')) togglePause();
  if (state === 'title') {
    titleOrbitAngle += dt * 0.05;
    const radius = 150;
    camera.position.set(Math.sin(titleOrbitAngle) * radius, 55, Math.cos(titleOrbitAngle) * radius);
    camera.lookAt(0, 0, -20);
    city.update(dt);
    return;
  }
  if (state === 'pause') return;

  if (input.pressed('KeyF')) {
    if (drivenCar) exitCar();
    else {
      const car = nearestCar(player.position);
      if (car) enterCar(car);
      else hud.showMessage('No car nearby — walk closer to one and press F');
    }
  }

  // In the core screenshot the car drives itself; a real player drives with W.
  const drivingInput = shotName === 'core' && drivenCar ? { moveAxes: () => ({ forward: 1, strafe: 0 }), isDown: () => false } : input;
  if (drivenCar) {
    drivenCar.update(dt, drivingInput, city);
    chaseCamera.update(dt, drivenCar.position, drivenCar.heading, true, input);
  } else {
    player.update(dt, input, chaseCamera.yaw, city);
    chaseCamera.update(dt, player.position, player.heading, false, input);
  }
  city.update(dt);

  const focus = drivenCar || player;
  hud.update({
    playerPos: focus.position,
    heading: drivenCar ? drivenCar.heading : player.heading,
    speedKmh: drivenCar ? Math.abs(drivenCar.speed) * 3.6 : 0,
    money,
    wanted,
    health,
    armour,
    cars,
    driving: Boolean(drivenCar),
    carName: drivenCar ? drivenCar.name : '',
  });

  if (shotName === 'core' && !shotReady) {
    shotTimer += dt;
    if (shotTimer >= SHOT_DRIVE_SECONDS) {
      shotReady = true;
      window.__shotReady = true;
    }
  }
}

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  update(dt);
  renderer.render(scene, camera);
  input.endFrame();
}

loadTextures()
  .then((textures) => {
    city = buildCity(scene, textures, rng);
    player = createPlayer(scene, SPAWN_X, SPAWN_Z);
    cars = createCars(scene, textures, rng);
    chaseCamera = new ChaseCamera(camera);
    hud = new Hud(city);
    hud.setObjective('Press ENTER or click START to play');
    stageShot();
    window.__game = {
      scene,
      camera,
      get state() {
        return state;
      },
      get player() {
        return player;
      },
      get cars() {
        return cars;
      },
      get drivenCar() {
        return drivenCar;
      },
    };
    if (shotName === 'title') window.__shotReady = true;
    loop();
  })
  .catch((error) => {
    document.getElementById('load-error').textContent = `Failed to load: ${error.message}`;
    document.getElementById('load-error').classList.remove('hidden');
    throw error;
  });
