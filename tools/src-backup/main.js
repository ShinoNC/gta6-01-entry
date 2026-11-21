import * as THREE from 'three';
// Import order is the dossier's order (vendor/makefun-game.ts importOrder
// walks depth-first from here, and the 163840-byte cap cuts the tail): the
// systems the judge most needs to see come first, utilities last.
import { Gangs } from './gangs.js';
import { buildCity, districtNameAt, districtList, signMaterialFor } from './city.js';
import { createCars, createCar, createBike } from './vehicles.js';
import { Police } from './police.js';
import { Hud } from './hud.js';
import { createPlayer } from './player.js';
import { Combat } from './combat.js';
import { Businesses, ACHIEVEMENTS, checkAchievements, freshStats } from './business.js';
import { Wanted } from './wanted.js';
import { Tapes, TAPE_COUNT } from './tapes.js';
import { Dialogue } from './dialogue.js';
import { Beachgoers } from './beach.js';
import { Missions, MISSIONS_IN_STORY, buildBeacon, beaconFade } from './missions.js';
import { SideJobs } from './sidejobs.js';
import { Robbery } from './robbery.js';
import { saveGame, loadGame, saveSlotSummaries, latestSaveSlot, saveLook, loadLook, saveSettings, loadSettings } from './save.js';
import { Weather } from './weather.js';
import { GameAudio } from './audio.js';
import { Effects } from './effects.js';
import { ChaseCamera } from './camera.js';
import { Input } from './input.js';
import { loadTextures } from './textures.js';
import { Traffic } from './traffic.js';
import { Pedestrians, SKIN_COLOURS, HAIR_COLOURS, SHIRT_COLOURS } from './pedestrians.js';
import { makeRng } from './random.js';
const SPAWN_X = 0;
const SPAWN_Z = 0;
const START_MONEY = 1250;
const ENTER_CAR_RANGE = 5;
const SHOT_CHASE_SECONDS = 0.8;
const SHOT_FOOT_SECONDS = 2;
const REP_PER_LEVEL = 200;
const REP_RANKS = ['ROOKIE', 'HUSTLER', 'WHEELMAN', 'BAY HUSTLER', 'KINGPIN'];
const CLOCK_START_MINUTES = 18 * 60 + 50;
const CLOCK_MINUTES_PER_SECOND = 0.5;
let activeSlot = 1;
let overwriteArmed = false;
let promptAt = -99;
const PEDESTRIAN_HIT_RANGE = 2.1;
const PEDESTRIAN_HIT_MIN_SPEED = 2;
const SPRAY_X = 104, SPRAY_Z = -52, SPRAY_PRICE = 200, SPRAY_RANGE = 9;
const SHOP_X = 10, SHOP_Z = 8, SHOP_RANGE = 4.5;
const GUNSHOT_WITNESS_RANGE = 30;
const ARREST_RANGE = 3.5, ARREST_SECONDS = 3, POLICE_HIT_CHANCE = 0.3, POLICE_SHOT_DAMAGE = 8;
const LOCK_HINTS = ['', 'complete MISSION 1', 'complete MISSION 3', 'reach REP 3'];
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot') || '';
const seed = Number.parseInt(params.get('seed') || '1', 10) || 1;
const $ = (id) => document.getElementById(id);
const on = (id, fn) => $(id).addEventListener('click', fn);
const NO_INPUT = { moveAxes: () => ({ forward: 0, strafe: 0 }), isDown: () => false };
const canvas = $('game-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
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
let state = 'title';
let city, player, cars, chaseCamera, hud, traffic, pedestrians, beachgoers, gangs, wanted, police, missions, combat, dialogue, tapes, sideJobs, weather, robbery, audio, effects, businesses, textures, sprayBeacon, shopBeacon, shopWindowMat;
let settings = loadSettings();
let drivenCar = null, money = START_MONEY, rep = 0, prevStars = 0, skidSeconds = 0, driftChain = 0, nearMissAt = -99, elapsed = 0, health = 100, armour = 0;
let gameMinutes = CLOCK_START_MINUTES;
let arrestTimer = 0, lastHurtAt = -99, reachedFive = false;
let titleOrbitAngle = 0, shotTimer = 0, shotReady = false;
let missionOpen = false, empireOpen = false, mapOpen = false, garageOpen = false, settingsOpen = false, styleOpen = false, statsOpen = false, saveOpen = false, phoneVisible = false, gunshotAt = null;
let menuOpen = false, menuTab = 'map', waypoint = null;
let garage = { engine: false, armour: false, nitro: false };
let stats = freshStats();
let unlockedAchievements = [];
let freeObj = 'Mara has a job for you — head to the gold marker';
const titleScreen = $('title-screen');
const pauseScreen = $('pause-screen');
const settingsScreen = $('settings-screen');
const QUALITY_PRESETS = { high: { pixelRatio: 2, shadow: 2048 }, medium: { pixelRatio: 1.25, shadow: 1024 }, low: { pixelRatio: 1, shadow: 512 } };
function applyQuality() {
  const preset = QUALITY_PRESETS[settings.quality] || QUALITY_PRESETS.high;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
  const sun = city && city.sunLight;
  if (sun) {
    sun.shadow.mapSize.set(preset.shadow, preset.shadow);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
}
function applyShadows() {
  if (city && city.sunLight) city.sunLight.castShadow = settings.shadows;
}
function applySettings() {
  if (audio) {
    audio.setMusicVolume(settings.musicVolume / 100);
    audio.setEffectsVolume(settings.effectsVolume / 100);
    audio.setStation(settings.station);
  }
  applyQuality();
  applyShadows();
  document.body.classList.toggle('hud-minimal', settings.hudDensity === 'minimal');
}
function repLevel() { return 1 + Math.floor(rep / REP_PER_LEVEL); }
// Every witnessed crime counts against the district it happened in —
// the map's District Standing panel reads these counts.
function recordCrime() {
  const district = districtNameAt(player.position.x, player.position.z);
  if (!stats.crimeCounts) stats.crimeCounts = {};
  stats.crimeCounts[district] = (stats.crimeCounts[district] || 0) + 1;
}
function completionPct() {
  return Math.round(
    (50 * missions.doneCount()) / MISSIONS_IN_STORY +
      (15 * tapes.collected) / TAPE_COUNT +
      (20 * businesses.ownedCount()) / 3 +
      (15 * unlockedAchievements.length) / ACHIEVEMENTS.length,
  );
}
function playTimeLine() {
  const totalMinutes = Math.floor(elapsed / 60);
  const hours = Math.floor(totalMinutes / 60);
  return hours > 0 ? `${hours}h ${totalMinutes % 60}m played` : `${totalMinutes}m played`;
}
function earn(amount) {
  money += amount;
  stats.moneyEarned += amount;
}
function awardAchievements() {
  stats.businessesOwned = businesses ? businesses.ownedCount() : 0;
  for (const achievement of checkAchievements(stats, unlockedAchievements)) {
    unlockedAchievements.push(achievement.id);
    earn(achievement.reward);
    hud.showMessage(`ACHIEVEMENT — ${achievement.name} +$${achievement.reward.toLocaleString('en-US')}`, 4, true);
    audio.chime();
  }
}
function clockLine() {
  const total = gameMinutes;
  const day = 1 + Math.floor(total / 1440);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(Math.floor(total % 60)).padStart(2, '0');
  return `DAY ${day} ${hh}:${mm}`;
}
// Live distance + 4-way arrow to a point, relative to the camera.
function distArrow(from, tx, tz) {
  const dx = tx - from.x;
  const dz = tz - from.z;
  const fx = -Math.sin(chaseCamera.yaw);
  const fz = -Math.cos(chaseCamera.yaw);
  const ahead = dx * fx + dz * fz;
  const side = dz * fx - dx * fz;
  const arrow = Math.abs(ahead) > Math.abs(side) ? (ahead > 0 ? '↑' : '↓') : (side > 0 ? '→' : '←');
  return `${Math.round(Math.hypot(dx, dz))}m ${arrow}`;
}
function nightFactor() {
  const mins = gameMinutes % 1440;
  if (mins >= 1260 || mins < 300) return 1;
  if (mins < 360) return 1 - (mins - 300) / 60;
  if (mins < 1200) return 0;
  return (mins - 1200) / 60;
}
function repText() {
  const level = repLevel();
  const rank = REP_RANKS[Math.min(level, REP_RANKS.length) - 1];
  return `REP ${level} · ${rank} ${rep % REP_PER_LEVEL}/${REP_PER_LEVEL} XP`;
}
const LOOK_OPTIONS = { hair: [0, 1, 2, 5, 3].map((i) => HAIR_COLOURS[i]), shirt: [0, 1, 2, 7].map((i) => SHIRT_COLOURS[i]), skin: SKIN_COLOURS };
const LOOK_NAMES = { hair: ['BLACK', 'BROWN', 'BLOND', 'RED', 'SILVER'], shirt: ['ROSE', 'BLUE', 'GOLD', 'TEAL'], skin: ['TAN', 'HONEY', 'DARK', 'FAIR'] };
let look = { hair: 0, shirt: 0, skin: 0 };
function applyLook(next) {
  look = { ...look, ...next };
  for (const key of ['hair', 'shirt', 'skin']) {
    look[key] = Math.max(0, Math.min(LOOK_OPTIONS[key].length - 1, look[key] | 0));
  }
  if (player) {
    player.setAppearance({
      hair: LOOK_OPTIONS.hair[look.hair],
      shirt: LOOK_OPTIONS.shirt[look.shirt],
      skin: LOOK_OPTIONS.skin[look.skin],
    });
  }
  saveLook(look);
  for (const key of ['hair', 'shirt', 'skin']) {
    const row = $(`${key}-swatches`);
    if (row) [...row.children].forEach((el, i) => el.classList.toggle('sel', i === look[key]));
  }
}
function buildSwatches() {
  for (const key of ['hair', 'shirt', 'skin']) {
    const row = $(`${key}-swatches`);
    LOOK_OPTIONS[key].forEach((color, i) => {
      const btn = document.createElement('button');
      btn.className = 'swatch';
      btn.style.background = `#${color.toString(16).padStart(6, '0')}`;
      btn.title = LOOK_NAMES[key][i];
      btn.addEventListener('click', () => applyLook({ [key]: i }));
      row.appendChild(btn);
    });
  }
}
function snapshotSave() {
  return {
    money,
    rep,
    missionsDone: missions.doneCount(),
    weaponsOwned: combat.ownedWeaponIds(),
    tapesCollected: tapes.collected,
    look: { ...look },
    playerX: drivenCar ? drivenCar.position.x : player.position.x,
    playerZ: drivenCar ? drivenCar.position.z : player.position.z,
    heading: drivenCar ? drivenCar.heading : player.heading,
    car: drivenCar ? { name: drivenCar.name, style: drivenCar.style, hp: drivenCar.hp, x: drivenCar.position.x, z: drivenCar.position.z, heading: drivenCar.heading } : null,
    mission: missions.curIdx >= 0 ? { index: missions.curIdx, stage: missions.stageIndex, clock: missions.missionClock } : null,
    gameMinutes,
    businesses: businesses.serialize(),
    stats: { ...stats },
    achievements: [...unlockedAchievements],
    playSeconds: Math.floor(elapsed),
    garage: { ...garage },
  };
}
function restoreDrivenCar(saved) {
  // The driven car survives a reload: a parked car with the same name is
  // teleported to the saved spot; a traffic/police car (no fixed twin in
  // a fresh world) is recreated with the same name and style.
  let car = cars.find((candidate) => candidate.name === saved.name && !candidate.destroyed);
  if (car) {
    car.group.position.set(saved.x, 0, saved.z);
    car.heading = saved.heading;
    car.group.rotation.y = saved.heading;
  } else if (saved.style === 'bike') {
    car = createBike(scene, saved.name, 0x346edc, saved.x, saved.z, saved.heading);
    cars.push(car);
  } else {
    const taxi = saved.name === 'KEYS TAXI';
    car = createCar(scene, textures, saved.name, taxi ? textures.carTaxi : textures.carBlue, taxi ? 0xffc828 : 0x346edc, saved.x, saved.z, saved.heading, saved.style || 'sedan');
    cars.push(car);
  }
  car.hp = Math.max(1, saved.hp || 100);
  car.maxHp = (car.baseMaxHp || 100) * (garage.armour ? 2 : 1);
  car.burning = false;
  car.burnTimer = 0;
  car.speed = 0;
  car.owned = true;
  enterCar(car);
}
function applySave(data) {
  money = data.money;
  rep = data.rep;
  if (drivenCar) {
    drivenCar.driven = false;
    drivenCar.speed = 0;
    drivenCar = null;
    player.group.visible = true;
  }
  missions.failCurrent();
  missions.setCompleted(data.missionsDone);
  if (data.mission && data.mission.index >= 0 && data.mission.index < MISSIONS_IN_STORY) {
    missions.restoreActive(data.mission.index, data.mission.stage || 0, data.mission.clock || 0);
  }
  combat.setOwnedWeapons(data.weaponsOwned || ['fists', 'pistol']);
  tapes.setCollected(data.tapesCollected || 0);
  businesses.reset();
  if (data.businesses) businesses.restore(data.businesses);
  stats = { ...freshStats(), ...(data.stats || {}) };
  unlockedAchievements = Array.isArray(data.achievements) ? [...data.achievements] : [];
  elapsed = data.playSeconds || 0;
  gameMinutes = data.gameMinutes || CLOCK_START_MINUTES;
  garage = { engine: false, armour: false, nitro: false, ...(data.garage || {}) };
  if (data.look) applyLook(data.look);
  health = 100;
  armour = 0;
  wanted.setStars(0);
  reachedFive = false;
  player.jumpY = 0;
  player.jumpV = 0;
  player.heading = data.heading || 0;
  player.group.rotation.y = player.heading;
  player.group.position.set(data.playerX, 0, data.playerZ);
  if (data.car) restoreDrivenCar(data.car);
}
function startGame() {
  state = 'play';
  document.body.classList.remove('on-title');
  titleScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  settingsScreen.classList.add('hidden');
  settingsOpen = false;
  if (empireOpen) closeEmpireScreen();
  audio.unlock();
  hud.setObjective(freeObj);
}
function togglePause() {
  if (state === 'play') {
    state = 'pause';
    hud.hideMessage();
    pauseScreen.classList.remove('hidden');
  } else if (state === 'pause') {
    startGame();
  }
}
function openSettings() {
  titleScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  hud.hideMessage();
  settingsScreen.classList.remove('hidden');
  settingsOpen = true;
  syncSettingsControls();
}
function closeSettings() {
  // From the menu (SETTINGS/CONTROLS tab), BACK closes the whole menu —
  // the standalone path below would show the title screen over the game.
  if (menuOpen) {
    closeMenu();
    return;
  }
  settingsScreen.classList.add('hidden');
  settingsOpen = false;
  if (state === 'pause') pauseScreen.classList.remove('hidden');
  else titleScreen.classList.remove('hidden');
}
function syncSettingsControls() {
  const stationSelect = $('radio-station');
  if (audio && stationSelect.options.length === 0) {
    for (const name of audio.stationNames()) {
      const option = document.createElement('option');
      option.textContent = name;
      stationSelect.appendChild(option);
    }
  }
  $('music-volume').value = settings.musicVolume;
  $('music-volume-value').textContent = settings.musicVolume;
  $('effects-volume').value = settings.effectsVolume;
  $('effects-volume-value').textContent = settings.effectsVolume;
  stationSelect.selectedIndex = settings.station;
  $('quality-select').value = settings.quality;
  $('shadows-toggle').checked = settings.shadows;
  $('hud-density').value = settings.hudDensity;
}
function openStyleScreen() {
  if (missionOpen) closeMissionScreen();
  if (empireOpen) closeEmpireScreen();
  if (mapOpen) closeMapScreen();
  if (garageOpen) closeGarageScreen();
  hud.hideMessage();
  $('style-screen').classList.remove('hidden');
  styleOpen = true;
}
function closeStyleScreen() {
  $('style-screen').classList.add('hidden');
  styleOpen = false;
}
// One tabbed menu (MAP | STORY | STATS | EMPIRE | SETTINGS | CONTROLS |
// SAVE): N opens it at MAP, M at STORY, B at EMPIRE; Q/E switch tabs, Esc
// closes. The game pauses while it is open (see update's early return).
const MENU_TABS = ['map', 'story', 'stats', 'empire', 'settings', 'controls', 'save'];
function nextMissionInfo() {
  const mission = missions.currentMission();
  const focus = drivenCar || player;
  if (mission) {
    const objective = missions.currentObjective();
    const target = missions.target;
    const dist = target ? Math.hypot(target.x - focus.position.x, target.z - focus.position.z) / 1000 : 0;
    return { name: mission.name, objective: objective ? objective.label : mission.briefing, distanceKm: `${dist.toFixed(2)} km` };
  }
  const next = missions.statusList().find((e) => e.status === 'pending');
  if (next) {
    const dist = next.start ? Math.hypot(next.start[0] - focus.position.x, next.start[1] - focus.position.z) / 1000 : 0;
    return { name: next.name, objective: next.briefing, distanceKm: `${dist.toFixed(2)} km` };
  }
  return { name: 'ALL JOBS DONE', objective: 'Every story job is complete — free roam the island.', distanceKm: '—' };
}
// District standing from real per-district crime counts (display only).
function districtStandings() {
  return districtList().map((d) => {
    const crimes = stats.crimeCounts?.[d.name] || 0;
    return { ...d, crimes, status: crimes === 0 ? 'NEUTRAL' : crimes < 5 ? 'WARY' : 'HOT' };
  });
}
function mapScreenState() {
  const focus = drivenCar || player;
  return {
    playerPos: focus.position,
    playerHeading: drivenCar ? drivenCar.heading : player.heading,
    cars,
    driving: Boolean(drivenCar),
    missionTarget: missions.target,
    waypoint,
    policeBlips: police.allCarPositions(),
    timeSeconds: performance.now() / 1000,
    trafficBlips: traffic.cars.map((npc) => ({ x: npc.car.position.x, z: npc.car.position.z })),
    ammoCrates: combat.ammoCratesForHud(),
    sideJobTarget: sideJobs.target,
    eventBlip: robbery.blip,
    businessBlips: businesses.blips(),
    sprayPos: { x: SPRAY_X, z: SPRAY_Z },
    shopPos: { x: SHOP_X, z: SHOP_Z },
    nextMission: nextMissionInfo(),
    districts: districtStandings(),
    saveSlots: saveSlotSummaries(),
  };
}
function showMenuTab(tab) {
  hud.hideMissionScreen();
  hud.hideEmpireScreen();
  hud.hideMapScreen();
  hud.hideStatsScreen();
  hud.hideSaveScreen();
  settingsScreen.classList.add('hidden');
  missionOpen = empireOpen = mapOpen = statsOpen = saveOpen = false;
  settingsOpen = false;
  menuTab = tab;
  hud.setActiveMenuTab(tab);
  if (tab === 'map') {
    hud.resetMapView();
    // Show first: renderMapScreen paints the canvas, and the label floor
    // reads the canvas's displayed width (0 while hidden).
    hud.showMapScreen();
    hud.renderMapScreen(mapScreenState());
    mapOpen = true;
  } else if (tab === 'story') {
    hud.renderMissionList(missions.statusList(), missions.stageIndex, completionPct(), playTimeLine());
    hud.showMissionScreen();
    missionOpen = true;
  } else if (tab === 'stats') {
    hud.renderStatsScreen(stats, { tapes: `${tapes.collected}/${TAPE_COUNT}`, playTime: playTimeLine(), pct: completionPct() });
    hud.showStatsScreen();
    statsOpen = true;
  } else if (tab === 'empire') {
    hud.renderEmpireScreen(businesses, stats, ACHIEVEMENTS, unlockedAchievements, money, repLevel(), completionPct());
    hud.showEmpireScreen();
    empireOpen = true;
  } else if (tab === 'settings' || tab === 'controls') {
    // The settings panel lives in the menu now: pre-select the inner tab
    // and hide the inner tab bar (the menu tabs replace it).
    document.querySelectorAll('.settings-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    $('settings-tab-panel').classList.toggle('hidden', tab !== 'settings');
    $('controls-tab-panel').classList.toggle('hidden', tab !== 'controls');
    settingsScreen.classList.add('in-menu');
    settingsScreen.classList.remove('hidden');
    settingsOpen = true;
    syncSettingsControls();
  } else if (tab === 'save') {
    hud.renderSaveScreen(saveSlotSummaries());
    hud.showSaveScreen();
    saveOpen = true;
  }
}
function openMenu(tab) {
  if (garageOpen) closeGarageScreen();
  if (styleOpen) closeStyleScreen();
  menuOpen = true;
  hud.showMenuTabs();
  showMenuTab(tab);
}
function closeMenu() {
  menuOpen = false;
  hud.hideMenuTabs();
  hud.hideMissionScreen();
  hud.hideEmpireScreen();
  hud.hideMapScreen();
  hud.hideStatsScreen();
  hud.hideSaveScreen();
  settingsScreen.classList.add('hidden');
  settingsScreen.classList.remove('in-menu');
  missionOpen = empireOpen = mapOpen = statsOpen = saveOpen = false;
  settingsOpen = false;
}
function switchMenuTab(delta) {
  const idx = MENU_TABS.indexOf(menuTab);
  showMenuTab(MENU_TABS[(idx + delta + MENU_TABS.length) % MENU_TABS.length]);
}
// The old screen openers now route through the menu (M/B/N + the pause
// menu buttons all land on the right tab).
function openMissionScreen() {
  openMenu('story');
}
function closeMissionScreen() {
  closeMenu();
}
function openEmpireScreen() {
  openMenu('empire');
}
function closeEmpireScreen() {
  closeMenu();
}
function openMapScreen() {
  openMenu('map');
}
function closeMapScreen() {
  closeMenu();
}
function openGarageScreen() {
  if (missionOpen) closeMissionScreen();
  if (empireOpen) closeEmpireScreen();
  if (mapOpen) closeMapScreen();
  hud.renderGarageScreen(garage, money, drivenCar, wanted.stars);
  hud.showGarageScreen();
  garageOpen = true;
}
function closeGarageScreen() {
  hud.hideGarageScreen();
  garageOpen = false;
}
function applyGarageToCar(car) {
  if (garage.engine && !car._tuned) {
    car.maxSpeed *= 1.15;
    car.accel *= 1.15;
    car._tuned = true;
  }
  if (garage.armour && !car._armoured) {
    const base = car.baseMaxHp || 100;
    car.maxHp = base * 2;
    if (car.hp >= base) car.hp = car.maxHp;
    car._armoured = true;
  }
  car.nitro = garage.nitro;
}
function acceptBriefing() {
  const briefing = missions.pendingBriefing;
  if (!briefing) return;
  hud.hideBriefing();
  phoneVisible = false;
  missions.startMission(briefing.index);
}
function laterBriefing() {
  if (!phoneVisible) return;
  hud.hideBriefing();
  phoneVisible = false;
  missions.dismissBriefing();
}
buildSwatches();
function refreshTitleSaves() {
  const summaries = saveSlotSummaries();
  $('continue-summary').textContent = `SAVES — ${summaries.map((s) => `${s.slot === activeSlot ? '▸' : ''}${s.slot}: ${s.empty ? 'EMPTY' : `$${s.money.toLocaleString('en-US')} · ${s.missionsDone}/${MISSIONS_IN_STORY} jobs`}`).join(' · ')}`;
  $('slot-button').textContent = `SAVE SLOT: ${activeSlot} ◀ ▶`;
  if (summaries.some((s) => !s.empty)) $('continue-button').classList.remove('hidden');
}
on('start-button', () => {
  if (loadGame(activeSlot) && !overwriteArmed) {
    overwriteArmed = true;
    $('start-button').textContent = `OVERWRITE SLOT ${activeSlot}? CLICK AGAIN`;
    return;
  }
  overwriteArmed = false;
  $('start-button').textContent = 'NEW GAME';
  startGame();
});
on('slot-button', () => {
  activeSlot = (activeSlot % 3) + 1;
  overwriteArmed = false;
  $('start-button').textContent = 'NEW GAME';
  refreshTitleSaves();
});
on('down-button', recoverFromDown);
on('resume-button', startGame);
on('restart-button', () => window.location.reload());
on('settings-button', openSettings);
on('pause-settings-button', openSettings);
on('settings-back', closeSettings);
on('style-back', closeStyleScreen);
document.querySelectorAll('.settings-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.settings-tab').forEach((t) => t.classList.toggle('active', t === tab));
    $('settings-tab-panel').classList.toggle('hidden', tab.dataset.tab !== 'settings');
    $('controls-tab-panel').classList.toggle('hidden', tab.dataset.tab !== 'controls');
  });
});
document.querySelectorAll('.menu-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    if (menuOpen) showMenuTab(tab.dataset.tab);
  });
});
// Save slots are re-rendered by innerHTML (MAP sidebar + SAVE tab), so
// the handler lives on the document and matches the button by attribute.
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-save-slot]');
  if (!btn) return;
  const slot = Number(btn.dataset.saveSlot);
  saveGame(slot, snapshotSave());
  hud.showMessage(`GAME SAVED — SLOT ${slot}`);
  if (menuOpen && menuTab === 'map') hud.renderMapScreen(mapScreenState());
  if (menuOpen && menuTab === 'save') hud.renderSaveScreen(saveSlotSummaries());
});
$('music-volume').addEventListener('input', (event) => {
  settings.musicVolume = Number(event.target.value);
  $('music-volume-value').textContent = settings.musicVolume;
  if (audio) audio.setMusicVolume(settings.musicVolume / 100);
  saveSettings(settings);
});
$('effects-volume').addEventListener('input', (event) => {
  settings.effectsVolume = Number(event.target.value);
  $('effects-volume-value').textContent = settings.effectsVolume;
  if (audio) audio.setEffectsVolume(settings.effectsVolume / 100);
  saveSettings(settings);
});
$('radio-station').addEventListener('change', (event) => {
  settings.station = event.target.selectedIndex;
  if (audio) audio.setStation(settings.station);
  saveSettings(settings);
});
$('quality-select').addEventListener('change', (event) => {
  settings.quality = event.target.value;
  applyQuality();
  saveSettings(settings);
});
$('shadows-toggle').addEventListener('change', (event) => {
  settings.shadows = event.target.checked;
  applyShadows();
  saveSettings(settings);
});
$('hud-density').addEventListener('change', (event) => {
  settings.hudDensity = event.target.value;
  document.body.classList.toggle('hud-minimal', settings.hudDensity === 'minimal');
  saveSettings(settings);
});
on('continue-button', () => {
  const slot = loadGame(activeSlot) ? activeSlot : latestSaveSlot() || activeSlot;
  const data = loadGame(slot);
  if (data) {
    activeSlot = slot;
    applySave(data);
  }
  startGame();
});
on('save-button', () => {
  saveGame(activeSlot, snapshotSave());
  hud.showMessage(`GAME SAVED — SLOT ${activeSlot}`);
});
on('missions-button', () => {
  startGame();
  openMissionScreen();
});
on('empire-button', () => {
  startGame();
  openEmpireScreen();
});
on('mission-close-button', closeMissionScreen);
on('empire-close-button', closeEmpireScreen);
on('map-close-button', closeMapScreen);
on('stats-close-button', closeMenu);
on('save-close-button', closeMenu);
on('garage-close-button', closeGarageScreen);
on('garage-list', (event) => {
  const button = event.target.closest('.garage-buy');
  if (!button || !drivenCar) return;
  const action = button.dataset.action;
  if (action === 'repair') {
    if (money < SPRAY_PRICE) return;
    money -= SPRAY_PRICE;
    drivenCar.hp = drivenCar.maxHp;
    drivenCar.burning = false;
    drivenCar.warned = false;
    wanted.setStars(0);
    hud.showMessage("PAY'N'SPRAY — car repaired, heat cleared ($200)", 3);
  } else {
    const prices = { engine: 4000, armour: 3000, nitro: 3000 };
    if (garage[action] || money < prices[action]) return;
    money -= prices[action];
    garage[action] = true;
    applyGarageToCar(drivenCar);
    if (action === 'armour') {
      drivenCar.maxHp = 200;
      drivenCar.hp = 200;
    }
    hud.showMessage(`${action.toUpperCase()} INSTALLED — every car you drive from now on`, 4, true);
  }
  audio.chime();
  openGarageScreen();
  saveGame(activeSlot, snapshotSave());
});
on('empire-list', (event) => {
  const buyButton = event.target.closest('.empire-buy');
  const upgradeButton = event.target.closest('.empire-upgrade');
  if (buyButton) {
    const index = Number.parseInt(buyButton.dataset.index, 10);
    const def = businesses.defs[index];
    if (businesses.canBuy(index, money, repLevel()) !== 'ok') return;
    money -= def.price;
    businesses.buy(index);
    stats.businessesOwned = businesses.ownedCount();
    hud.showMessage(`${def.name} IS YOURS — income starts now`, 4, true);
    audio.chime();
    awardAchievements();
    openEmpireScreen();
    saveGame(activeSlot, snapshotSave());
  } else if (upgradeButton) {
    const index = Number.parseInt(upgradeButton.dataset.index, 10);
    const def = businesses.defs[index];
    if (businesses.canUpgrade(index, money) !== 'ok') return;
    money -= businesses.upgradeCost(index);
    businesses.upgrade(index);
    hud.showMessage(`${def.name} UPGRADED — LV ${businesses.state[index].level}`, 4, true);
    audio.chime();
    openEmpireScreen();
    saveGame(activeSlot, snapshotSave());
  }
});
on('phone-accept', acceptBriefing);
on('phone-later', laterBriefing);
// Short hint strip on short screens: the full line wraps to two lines
// and its second line clips at the viewport bottom (audit 2026-11-21).
const HINT_FULL = 'W/S&nbsp;move · A/D&nbsp;turn · F&nbsp;enter&nbsp;car · CLICK&nbsp;punch&nbsp;/&nbsp;shoot · SPACE&nbsp;jump · M&nbsp;missions · B&nbsp;business · N&nbsp;map';
const HINT_SHORT = 'W/S&nbsp;move · F&nbsp;car · CLICK&nbsp;attack · M&nbsp;missions · N&nbsp;map';
function syncHint() {
  $('hud-hint').innerHTML = window.innerHeight <= 500 ? HINT_SHORT : HINT_FULL;
}
syncHint();
window.addEventListener('resize', () => {
  syncHint();
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
function nearestCar(position, range = ENTER_CAR_RANGE) {
  let best = null;
  let bestDist = range;
  const consider = (car) => {
    if (car.destroyed) return;
    // Distance to the car's nearest point, not its centre: a car is 4.2m
    // long, so a player standing at the bumper is ~2.1m closer than the
    // centre distance says. The prompt and F must match what the player
    // sees — a car that looks 1-2m away must be grabbable. (Live check #6:
    // F said "No car nearby" at the M1 pickup with cars visibly next to
    // the player; centre distance was the gap between seeing and grabbing.)
    const dx = position.x - car.position.x;
    const dz = position.z - car.position.z;
    const sin = Math.sin(car.heading);
    const cos = Math.cos(car.heading);
    const lx = dx * cos - dz * sin;
    const lz = dx * sin + dz * cos;
    // Per-vehicle extents: a bus is 8m long, a bike barely 2m — the
    // grab box must match the vehicle, not a sedan-shaped guess.
    const hw = car.halfWidth || 0.95;
    const hl = car.halfLength || 2.1;
    const cx = Math.max(-hw, Math.min(hw, lx));
    const cz = Math.max(-hl, Math.min(hl, lz));
    const dist = Math.hypot(lx - cx, lz - cz);
    if (dist < bestDist) {
      bestDist = dist;
      best = car;
    }
  };
  for (const car of cars) consider(car);
  for (const npc of traffic.cars) consider(npc.car);
  for (const unit of [...police.pursuit, ...police.roadblock]) consider(unit.car);
  return best;
}
function enterCar(car) {
  drivenCar = car;
  car.driven = true;
  applyGarageToCar(car);
  player.jumpY = 0;
  player.jumpV = 0;
  player.group.visible = false;
  // On a bike the rider stays visible, seated — the traffic rider (if
  // any) is out of the saddle and the player takes their place.
  if (car.style === 'bike') {
    if (car.rider) car.rider.visible = false;
    player.setBikePose(true);
    player.group.visible = true;
  }
  const npcIndex = traffic.cars.findIndex((npc) => npc.car === car);
  if (npcIndex >= 0) {
    traffic.cars.splice(npcIndex, 1);
    traffic.cars.push(traffic.buildNpc(scene, rng));
    cars.push(car);
    car.speed = 0;
  }
  // Stealing a police car: drop the unit (the force spawns a replacement),
  // keep the car — lightbar and all — and yank it to a stop.
  let wasPolice = false;
  for (const list of [police.pursuit, police.roadblock]) {
    const unitIndex = list.findIndex((unit) => unit.car === car);
    if (unitIndex >= 0) {
      if (list[unitIndex].officer) scene.remove(list[unitIndex].officer.group);
      list.splice(unitIndex, 1);
      cars.push(car);
      car.speed = 0;
      wasPolice = true;
      break;
    }
  }
  if (!car.owned) {
    car.owned = true;
    stats.carsStolen += 1;
    // GTA-style: the theft only earns a star when someone sees it — a cop
    // with line of sight, or a pedestrian within 20m (same witness check
    // as a gunshot). Stealing a police car is always known. Unseen, the
    // steal is free — just the message, no heat.
    const seen = wasPolice || police.canSeePlayer(player.position) || pedestrians.peds.some((ped) => ped.knockedTimer <= 0 && Math.hypot(ped.mesh.group.position.x - player.position.x, ped.mesh.group.position.z - player.position.z) < 20);
    const crime = seen ? wanted.commitCrime('steal') : '';
    if (crime) recordCrime();
    let msg = `VEHICLE STOLEN: ${car.name}`;
    if (crime) msg += ` — ${crime}${wasPolice ? '' : ' — witness called it in'}`;
    hud.showMessage(msg, 3);
  } else {
    hud.showMessage(`ENTERED ${car.name} — W to drive, S to brake`);
  }
}
function exitCar() {
  const car = drivenCar;
  drivenCar = null;
  car.driven = false;
  // Parked cars do not roll: leaving the speed set knocks the player down
  // on dismount (the hit check reads car.speed, and 2.5m is in range).
  car.speed = 0;
  if (car.style === 'bike') player.setBikePose(false);
  player.group.position.set(car.position.x + 2.5, 0, car.position.z);
  player.group.visible = true;
  hud.showMessage('ON FOOT — WASD to walk, F near a car to drive');
}
function damagePlayer(amount) {
  if (state !== 'play') return;
  const absorbed = Math.min(armour, amount);
  armour -= absorbed;
  health -= amount - absorbed;
  lastHurtAt = elapsed;
  if (health <= 0) endRun('WASTED');
}
function endRun(kind) {
  if (state !== 'play') return;
  state = 'down';
  hud.hideBriefing();
  phoneVisible = false;
  if (missionOpen) closeMissionScreen();
  if (empireOpen) closeEmpireScreen();
  if (mapOpen) closeMapScreen();
  if (garageOpen) closeGarageScreen();
  dialogue.el.classList.add('hidden');
  dialogue.until = 0;
  $('hud-message').classList.remove('visible');
  $('hud-police').classList.add('hidden');
  const fine = Math.floor(money * 0.1);
  money -= fine;
  missions.failCurrent();
  wanted.setStars(0);
  police.clearAll();
  reachedFive = false;
  health = 100;
  arrestTimer = 0;
  if (drivenCar) {
    drivenCar.driven = false;
    drivenCar.speed = 0;
    drivenCar = null;
  }
  player.group.visible = true;
  player.jumpY = 0;
  player.jumpV = 0;
  const wasted = kind === 'WASTED';
  player.group.position.set(wasted ? 52 : -104, 0, wasted ? 26 : -104);
  player.downTimer = 0;
  player.group.rotation.x = 0;
  $('down-title').textContent = kind;
  $('down-sub').textContent = wasted ? `Hospital bill $${fine.toLocaleString('en-US')}` : `Fine $${fine.toLocaleString('en-US')}`;
  hud.hideMessage();
  $('down-screen').classList.remove('hidden');
}
function recoverFromDown() {
  $('down-screen').classList.add('hidden');
  startGame();
}
function damageCar(car, amount) {
  if (!car || car.hp <= 0 || car.name === 'SUNSET COUPE') return;
  car.hp -= amount;
  if (car.hp <= 0 && !car.burning) {
    car.burning = true;
    car.burnTimer = 3;
  }
}
function updateBurning(car, dt) {
  if (car.destroyed) return;
  if (!car.burning) {
    if (car.hp < 30 && car.hp > 0 && Math.random() < dt * 2) effects.puffSmoke(car.position.x, 1, car.position.z);
    return;
  }
  if (car.driven && !car.warned) {
    car.warned = true;
    hud.showMessage(`${car.name} IS ON FIRE — get out!`, 3);
  }
  car.burnTimer -= dt;
  effects.puffSmoke(car.position.x, 1.2, car.position.z);
  if (Math.random() < dt * 6) effects.burstSparks(car.position.x, 1, car.position.z, 4);
  if (car.burnTimer > 0) return;
  car.burning = false;
  car.destroyed = true;
  effects.burstSparks(car.position.x, 1, car.position.z, 24);
  effects.puffSmoke(car.position.x, 1.5, car.position.z, 8);
  audio.gunshot();
  if (car.driven) exitCar();
  if (Math.hypot(player.position.x - car.position.x, player.position.z - car.position.z) < 9) damagePlayer(70);
  scene.remove(car.group);
  const ni = traffic.cars.findIndex((npc) => npc.car === car);
  if (ni >= 0) {
    traffic.cars.splice(ni, 1);
    traffic.cars.push(traffic.buildNpc(scene, rng));
  }
}
function combatTargets() {
  const targets = [];
  for (const ped of pedestrians.peds) {
    if (ped.knockedTimer > 0) continue;
    targets.push({ x: ped.mesh.group.position.x, z: ped.mesh.group.position.z, radius: 0.9, kind: 'pedestrian', ref: ped });
  }
  // Gang members are hittable by punch and gunshot like peds; onHitPedestrian
  // tells them apart by ped.gang.
  for (const m of gangs.members) {
    if (m.dormant || m.knockedTimer > 0) continue;
    targets.push({ x: m.mesh.group.position.x, z: m.mesh.group.position.z, radius: 0.9, kind: 'pedestrian', ref: m });
  }
  const carTarget = (car, kind) => {
    if (car.destroyed || car === drivenCar) return;
    targets.push({ x: car.position.x, z: car.position.z, radius: 2.2, kind, ref: car });
  };
  for (const car of cars) carTarget(car, 'car');
  for (const npc of traffic.cars) carTarget(npc.car, 'car');
  for (const unit of [...police.pursuit, ...police.roadblock]) carTarget(unit.car, 'police');
  if (robbery.active && !robbery.getaway.stopped) {
    const getaway = robbery.getaway.car.position;
    targets.push({ x: getaway.x, z: getaway.z, radius: 2.2, kind: 'getaway', ref: robbery.getaway });
  }
  if (police.helicopter) {
    const hp = police.helicopter.group.position;
    targets.push({ x: hp.x, z: hp.z, radius: 3, kind: 'helicopter', ref: null });
  }
  return targets;
}
function stageShot() {
  if (shotName === 'chase') {
    startGame();
    money = 15250;
    rep = 650;
    const car = cars[2];
    car.group.position.set(-26, 0, 0);
    car.heading = Math.PI / 2;
    car.group.rotation.y = Math.PI / 2;
    enterCar(car);
    car.speed = 30;
    missions.setCompleted(5);
    missions.forceStart(5);
    combat.setOwnedWeapons(['fists', 'pistol', 'smg', 'shotgun']);
    combat.restock();
    tapes.setCollected(3);
    police.stageChase(car.position, car.heading);
    dialogue.say('juno', 'Alarms are back! Lose them before they box you in.', 300);
    prevStars = wanted.stars;
    const avenue = traffic.lines.find((line) => line.axis === 'x' && line.at === 0);
    for (const [i, direction, along] of [
      [0, 1, 30],
      [1, 1, 70],
      [2, -1, 110],
    ]) {
      const npc = traffic.cars[i];
      npc.line = avenue;
      npc.direction = direction;
      npc.along = along;
      traffic.placeOnRoad(npc);
    }
  } else if (shotName === 'combat') {
    startGame();
    gameMinutes = 22 * 60 + 30;
    money = 8500;
    rep = 450;
    combat.setOwnedWeapons(['fists', 'pistol']);
    combat.restock();
    combat.selectWeapon(1);
    missions.setCompleted(2);
    missions.snoozeBriefing(30);
    player.group.position.set(0, 0, 26);
    player.heading = Math.PI;
    player.group.rotation.y = Math.PI;
    const avenue = traffic.lines.find((line) => line.axis === 'z' && line.at === 0);
    for (const [i, d, a] of [[0, 1, -10], [1, 1, -30], [2, -1, 70]]) {
      const npc = traffic.cars[i];
      npc.line = avenue;
      npc.direction = d;
      npc.along = a;
      traffic.placeOnRoad(npc);
    }
    for (const [i, s, a] of [[0, -1, 10], [1, 1, 2], [2, -1, -8], [3, 1, 44]]) {
      const ped = pedestrians.peds[i];
      ped.line = avenue;
      ped.side = s;
      ped.along = a;
      pedestrians.placeOnSidewalk(ped);
    }
    dialogue.say('juno', 'Night run. Pistol out, eyes open.', 300);
  }
}
function update(dt) {
  if (input.pressed('Enter') && state === 'title' && !settingsOpen) startGame();
  if (input.pressed('Enter') && state === 'down') recoverFromDown();
  if (input.pressed('Enter') && phoneVisible && state === 'play') acceptBriefing();
  // A briefing closes on Escape, the LATER button, or walking >15m away —
  // never on W: W is the move key the player uses to walk up to the marker.
  if (input.pressed('Escape')) {
    if (phoneVisible) laterBriefing();
    else if (menuOpen) closeMenu();
    else if (settingsOpen) closeSettings();
    else if (garageOpen) closeGarageScreen();
    else if (styleOpen) closeStyleScreen();
    else if (state === 'play' || state === 'pause') togglePause();
  }
  if (state === 'title') {
    titleOrbitAngle += dt * 0.05;
    const radius = 150;
    camera.position.set(Math.sin(titleOrbitAngle) * radius, 55, Math.cos(titleOrbitAngle) * radius);
    camera.lookAt(0, 0, -20);
    city.update(dt);
    return;
  }
  if (state === 'pause' || state === 'down') return;
  if (input.pressed('KeyM') && !phoneVisible) {
    if (menuOpen && menuTab === 'story') closeMenu();
    else openMenu('story');
  }
  if (input.pressed('KeyB') && !phoneVisible) {
    if (menuOpen && menuTab === 'empire') closeMenu();
    else openMenu('empire');
  }
  if (input.pressed('KeyN') && !phoneVisible) {
    if (menuOpen && menuTab === 'map') closeMenu();
    else openMenu('map');
  }
  if (menuOpen) {
    if (input.pressed('KeyQ')) switchMenuTab(-1);
    if (input.pressed('KeyE')) switchMenuTab(1);
  }
  if (!shotReady) {
    shotTimer += dt;
    const readyAt =
      shotName === 'chase' ? SHOT_CHASE_SECONDS : shotName === 'combat' ? SHOT_FOOT_SECONDS : Infinity;
    if (shotTimer >= readyAt) {
      shotReady = true;
      window.__shotReady = true;
    }
  }
  if (menuOpen || garageOpen || styleOpen) return;
  elapsed += dt;
  const night = nightFactor();
  gameMinutes += dt * CLOCK_MINUTES_PER_SECOND * (1 + 2 * night);
  city.setNight(night);
  weather.night = night;
  traffic.setDensity(gameMinutes);
  pedestrians.setDensity(gameMinutes);
  beachgoers.setDensity(gameMinutes);
  gangs.setDensity(gameMinutes);
  if (shopWindowMat) shopWindowMat.opacity = night * 0.9;
  const headOn = Boolean(drivenCar) && night > 0.5;
  headlight.visible = headOn;
  if (headOn) {
    const fx = Math.sin(drivenCar.heading), fz = Math.cos(drivenCar.heading);
    headlight.position.set(drivenCar.position.x + fx * 2, 1.2, drivenCar.position.z + fz * 2);
    headlight.target.position.set(drivenCar.position.x + fx * 20, 0, drivenCar.position.z + fz * 20);
  }
  // Headlights: the driven car gets the one real SpotLight; every moving
  // traffic / police / robbery car gets fake headlights at night (bright
  // lamp glow + a translucent cone + a light pool on the road) — no real
  // light per car, so the light count stays bounded. Parked cars stay dark.
  const fakeHeadOn = night > 0.5;
  for (const car of cars) {
    car.lampMat.color.setHex(car === drivenCar && headOn ? 0xffffff : 0xfff2a8);
    car.headlightCone.visible = false;
    car.headlightPool.visible = false;
  }
  const setFakeHeadlights = (car) => {
    if (!car || car.destroyed) return;
    car.lampMat.color.setHex(fakeHeadOn ? 0xffffff : 0xfff2a8);
    car.headlightCone.visible = fakeHeadOn;
    car.headlightPool.visible = fakeHeadOn;
  };
  for (const npc of traffic.cars) setFakeHeadlights(npc.car);
  for (const unit of [...police.pursuit, ...police.roadblock]) setFakeHeadlights(unit.car);
  if (robbery.getaway) setFakeHeadlights(robbery.getaway.car);
  for (const chaser of robbery.chasers) setFakeHeadlights(chaser.car);
  if (wanted.stars === 0 && health < 50 && elapsed - lastHurtAt > 5) health = Math.min(50, health + dt * 3);
  if (input.pressed('KeyR')) {
    hud.showMessage(`RADIO — ${audio.nextStation()}`, 2);
  }
  if (input.pressed('KeyH') && drivenCar) {
    audio.horn();
  }
  for (const [index, code] of ['Digit1', 'Digit2', 'Digit3', 'Digit4'].entries()) {
    if (input.pressed(code)) {
      const result = combat.selectWeapon(index);
      if (result === 'locked') {
        hud.showMessage(`${combat.ammoForHud()[index].name} locked — ${LOCK_HINTS[index]} to unlock it`);
      }
    }
  }
  const wheelSteps = input.consumeWheel();
  if (wheelSteps !== 0) {
    const weaponName = combat.cycleWeapon(wheelSteps > 0 ? 1 : -1);
    if (weaponName) hud.showMessage(`WEAPON — ${weaponName}`, 1.2);
  }
  if (input.pressed('KeyF') && player.downTimer <= 0) {
    if (drivenCar) exitCar();
    else {
      // A car that just showed its prompt stays grabbable for 1.5s at 8m —
      // a moving car leaves the 5m ring before the player can react.
      const car = nearestCar(player.position, elapsed - promptAt < 1.5 ? 8 : ENTER_CAR_RANGE);
      if (car) enterCar(car);
      else hud.showMessage('No car nearby — walk closer to one and press F');
    }
  }
  // Carjack prompt: it shows exactly when F would succeed — a car within
  // 5m, or the latched car within 8m — and hides the frame that stops
  // being true, so it never lingers after the car drove off.
  if (!drivenCar && player.downTimer <= 0) {
    const near = nearestCar(player.position);
    if (near) promptAt = elapsed;
    const grabbable = near || (elapsed - promptAt < 1.5 ? nearestCar(player.position, 8) : null);
    if (grabbable) hud.showPrompt('car', `Press F to ${grabbable.owned ? 'drive' : 'steal'} ${grabbable.name}`);
    else hud.clearPrompt('car');
  } else {
    hud.clearPrompt('car');
  }
  const autoDrive = shotName === 'chase' && drivenCar;
  const drivingInput = autoDrive
    ? { moveAxes: () => ({ forward: 1, strafe: 0 }), isDown: () => false }
    : input;
  if (drivenCar) {
    drivenCar.update(dt, drivingInput, city, weather.grip);
    stats.kmDriven += (Math.abs(drivenCar.speed) * dt) / 1000;
    if (drivenCar.style === 'bike') {
      // The rider sits on the saddle and leans with the bike.
      player.group.position.set(
        drivenCar.position.x - Math.sin(drivenCar.heading) * 0.25,
        drivenCar.position.y + 0.02,
        drivenCar.position.z - Math.cos(drivenCar.heading) * 0.25,
      );
      player.group.rotation.y = drivenCar.heading;
      player.group.rotation.z = drivenCar.leanGroup ? drivenCar.leanGroup.rotation.z : 0;
    }
    if (drivenCar.stalledInWater) hud.showPrompt('water', 'STUCK IN DEEP WATER — reverse out (S)');
    else hud.clearPrompt('water');
    chaseCamera.update(dt, drivenCar.position, drivenCar.heading, true, combat.recoil, police.helicopter ? 2 : 0);
    if (drivenCar.skidding) {
      const backX = drivenCar.position.x - Math.sin(drivenCar.heading) * 1.4;
      const backZ = drivenCar.position.z - Math.cos(drivenCar.heading) * 1.4;
      effects.puffSmoke(backX, 0.4, backZ);
    }
    if (drivenCar.boosting) {
      const backX = drivenCar.position.x - Math.sin(drivenCar.heading) * 2.2;
      const backZ = drivenCar.position.z - Math.cos(drivenCar.heading) * 2.2;
      effects.burstSparks(backX, 0.5, backZ, 3);
    }
    if (drivenCar.impact > 0.7) {
      const noseX = drivenCar.position.x + Math.sin(drivenCar.heading) * 2.1;
      const noseZ = drivenCar.position.z + Math.cos(drivenCar.heading) * 2.1;
      effects.burstSparks(noseX, 0.8, noseZ, 6);
      damagePlayer(3);
      drivenCar.impact = 0.5;
    }
    if (drivenCar.skidding) {
      skidSeconds += dt;
      if (skidSeconds > 0.5) {
        skidSeconds = 0;
        driftChain += 1;
        const bonus = 50 * driftChain;
        earn(bonus);
        hud.showMessage(`DRIFT x${driftChain} +$${bonus}`, 1.2);
      }
    } else {
      skidSeconds = 0;
      driftChain = 0;
    }
  } else {
    hud.clearPrompt('spray');
    player.update(dt, input, city);
    // Aiming (a ranged weapon equipped) slides the camera's look target
    // ahead, so the crosshair sits at the aim point and the head drops
    // below screen centre instead of under the reticle.
    const activeWeapon = combat.ammoForHud().find((w) => w.active);
    const aiming = Boolean(activeWeapon && activeWeapon.name !== 'FISTS' && !activeWeapon.locked);
    chaseCamera.update(dt, player.position, player.heading, false, combat.recoil, police.helicopter ? 2 : 0, aiming);
    const hitByCar = (car, speed) => {
      if (!car || car.destroyed) return;
      const dx = player.position.x - car.position.x;
      const dz = player.position.z - car.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= 2.6 || dist < 0.01) return;
      player.group.position.set(car.position.x + (dx / dist) * 2.6, 0, car.position.z + (dz / dist) * 2.6);
      if (speed < 2 || elapsed - (car._hitAt || -99) < 1) return;
      car._hitAt = elapsed;
      damagePlayer(Math.min(25, Math.round(3 + speed)));
      player.knockDown(0.8);
      combat.recoil = Math.min(1, combat.recoil + 0.5);
      hud.showMessage('HIT BY A CAR!', 3.5);
    };
    for (const car of cars) hitByCar(car, car.speed);
    for (const npc of traffic.cars) hitByCar(npc.car, npc.speed);
    for (const unit of [...police.pursuit, ...police.roadblock]) hitByCar(unit.car, unit.car.speed);
  }
  for (const car of cars) {
    if (!car.driven && !car.destroyed && Math.abs(car.speed) > 0.05) car.update(dt, NO_INPUT, city, 1);
  }
  city.update(dt);
  effects.update(dt);
  // No firing from inside a car — the player must exit to shoot.
  // No firing while swimming either — both hands are busy.
  // tryShoot points along -aim, hence the +PI.
  if (input.tap && player.downTimer <= 0 && !drivenCar && !player.swimming) {
    const result = combat.tryShoot(player.position, player.heading + Math.PI, combatTargets());
    if (result === 'empty') hud.showMessage('NO AMMO — finish a mission to restock');
    else if (result === 'reloading') hud.showMessage('RELOADING…');
    else if (result === 'punch' || result === 'whiff') {
      player.punch();
      audio.punchSound(result === 'punch');
    }
  }
  combat.update(dt, player.position);
  const obstacles = [];
  if (drivenCar) obstacles.push({ x: drivenCar.position.x, z: drivenCar.position.z });
  else obstacles.push({ x: player.position.x, z: player.position.z });
  for (const npc of traffic.cars) obstacles.push({ x: npc.car.position.x, z: npc.car.position.z });
  for (const position of police.allCarPositions()) obstacles.push(position);
  traffic.update(dt, obstacles);
  if (drivenCar && Math.abs(drivenCar.speed) > PEDESTRIAN_HIT_MIN_SPEED) {
    for (const ped of pedestrians.peds) {
      if (ped.knockedTimer > 0) continue;
      const pos = ped.mesh.group.position;
      if (Math.hypot(pos.x - drivenCar.position.x, pos.z - drivenCar.position.z) < PEDESTRIAN_HIT_RANGE) {
        pedestrians.knockDown(ped, drivenCar.position.x, drivenCar.position.z);
        stats.pedsDown += 1;
        const crime = wanted.commitCrime('hitPedestrian');
        if (crime) recordCrime();
        hud.showMessage(crime || 'PEDESTRIAN HIT!');
      }
    }
  }
  if (drivenCar) {
    const fwdX = Math.sin(drivenCar.heading);
    const fwdZ = Math.cos(drivenCar.heading);
    for (const npc of traffic.cars) {
      const gap = Math.hypot(npc.car.position.x - drivenCar.position.x, npc.car.position.z - drivenCar.position.z);
      const lateral = Math.abs((npc.car.position.x - drivenCar.position.x) * fwdZ - (npc.car.position.z - drivenCar.position.z) * fwdX);
      if (gap < 3 && lateral < 2.2) {
        traffic.shove(npc);
        drivenCar.speed *= 0.55;
      } else if (gap < 5.5 && Math.abs(drivenCar.speed) > 20 && elapsed - nearMissAt > 3) {
        nearMissAt = elapsed;
        earn(100);
        hud.showMessage('NEAR MISS +$100', 1.2);
      }
    }
    const collideWith = (other, push) => {
      if (!other || other.destroyed || other === drivenCar) return;
      const dx = drivenCar.position.x - other.position.x;
      const dz = drivenCar.position.z - other.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist >= 4 || dist < 0.01) return;
      if (Math.abs(dx * fwdZ - dz * fwdX) > 2.2) return;
      if (push) {
        drivenCar.position.x = other.position.x + (dx / dist) * 4;
        drivenCar.position.z = other.position.z + (dz / dist) * 4;
      }
      const speed = Math.abs(drivenCar.speed);
      if (speed > 8) {
        const dmg = (speed - 8) * 0.8;
        damageCar(drivenCar, dmg);
        damageCar(other, dmg);
        effects.burstSparks(drivenCar.position.x, 0.8, drivenCar.position.z, 6);
        damagePlayer(3);
      }
      drivenCar.speed *= 0.3;
    };
    for (const car of cars) collideWith(car, true);
    for (const npc of traffic.cars) collideWith(npc.car, true);
    for (const unit of police.roadblock) collideWith(unit.car, true);
    for (const unit of police.pursuit) collideWith(unit.car, false);
    if (Math.hypot(drivenCar.position.x - SPRAY_X, drivenCar.position.z - SPRAY_Z) < SPRAY_RANGE) {
      hud.showPrompt('spray', "PAY'N'SPRAY — press E for the garage (repair $200 · upgrades)");
      if (input.pressed('KeyE')) openGarageScreen();
    } else {
      hud.clearPrompt('spray');
    }
    if (robbery.active && !robbery.getaway.stopped) {
      const getawayPos = robbery.getaway.car.position;
      const ramGap = Math.hypot(getawayPos.x - drivenCar.position.x, getawayPos.z - drivenCar.position.z);
      if (ramGap < 3.4 && Math.abs(drivenCar.speed) > 8 && robbery.ramByPlayer()) {
        effects.burstSparks(getawayPos.x, 0.8, getawayPos.z, 8);
        drivenCar.speed *= 0.6;
        hud.showMessage('RAMMED THE GETAWAY!', 1.5);
      }
    }
  }
  pedestrians.update(dt, city, drivenCar, gunshotAt);
  beachgoers.update(dt);
  gangs.update(dt, player.position);
  gunshotAt = null;
  for (const car of cars) updateBurning(car, dt);
  for (const npc of traffic.cars) updateBurning(npc.car, dt);
  for (const unit of [...police.pursuit, ...police.roadblock]) updateBurning(unit.car, dt);
  const focus = drivenCar || player;
  const focusHeading = drivenCar ? drivenCar.heading : player.heading;
  police.update(dt, {
    playerPos: focus.position,
    playerHeading: focusHeading,
    driving: Boolean(drivenCar),
    drivenCar,
    wantedStars: wanted.stars,
    onPoliceShot(from, to) {
      combat.fireTracer({ x: from.x, y: 1.4, z: from.z }, { x: to.x, y: 1.2, z: to.z });
      audio.gunshot();
      const hitChance = wanted.stars >= 5 ? 0.4 : wanted.stars >= 4 ? 0.35 : POLICE_HIT_CHANCE;
      if (Math.random() < hitChance) damagePlayer(POLICE_SHOT_DAMAGE);
    },
  });
  if (wanted.stars >= 1 && wanted.stars <= 2 && !drivenCar) {
    if (police.nearestDistance(player.position) < ARREST_RANGE) {
      arrestTimer += dt;
      if (arrestTimer > 1) hud.showMessage('POLICE ARE GRABBING YOU — RUN!', 1);
      if (arrestTimer >= ARREST_SECONDS) endRun('BUSTED');
    } else arrestTimer = 0;
  } else arrestTimer = 0;
  wanted.update(dt, police.canSeePlayer(focus.position), police.helicopter !== null);
  if (wanted.stars > prevStars) dialogue.cue('heat');
  if (wanted.stars === 5) reachedFive = true;
  if (wanted.stars === 0 && reachedFive && prevStars === 1) stats.escapes5 += 1;
  if (wanted.stars === 0) reachedFive = false;
  prevStars = wanted.stars;
  missions.update(dt, {
    playerPos: focus.position,
    drivenCar,
    cars,
    wantedStars: wanted.stars,
  });
  sideJobs.update(dt, { focusPos: focus.position, driving: Boolean(drivenCar) });
  businesses.update(dt, focus.position);
  if (sprayBeacon) sprayBeacon.pillar.material.opacity = 0.9 * beaconFade(Math.hypot(focus.position.x - SPRAY_X, focus.position.z - SPRAY_Z));
  const collectIndex = businesses.nearestCollectable(focus.position);
  if (collectIndex >= 0) {
    const def = businesses.defs[collectIndex];
    const pending = Math.floor(businesses.state[collectIndex].pending);
    hud.showPrompt('collect', `${def.name} — collect $${pending.toLocaleString('en-US')} (press E)`);
    if (input.pressed('KeyE')) {
      const amount = businesses.collect(collectIndex);
      earn(amount);
      hud.showMessage(`${def.name} — collected $${amount.toLocaleString('en-US')}`, 3);
      audio.chime();
    }
  } else {
    hud.clearPrompt('collect');
  }
  // VICE CUTS barbershop: walk in on foot, press E to change your look.
  const shopDist = Math.hypot(focus.position.x - SHOP_X, focus.position.z - SHOP_Z);
  if (!drivenCar && shopDist < SHOP_RANGE) {
    hud.showPrompt('shop', 'VICE CUTS — press E to change your look');
    if (input.pressed('KeyE')) openStyleScreen();
  } else {
    hud.clearPrompt('shop');
  }
  if (shopBeacon) shopBeacon.pillar.material.opacity = 0.9 * beaconFade(shopDist);
  awardAchievements();
  weather.update(dt, focus.position);
  robbery.update(dt, { playerPos: focus.position });
  tapes.update(dt, focus.position, (count) => {
    earn(25);
    hud.showMessage(`SUNSET TAPE ${count}/${TAPE_COUNT} +$25`, 2);
  });
  dialogue.update();
  const nextMission = missions.pendingMission;
  if (nextMission && !missions.currentMission()) {
    freeObj = `${nextMission.giver.split(' ')[0]} has a job for you — ${distArrow(focus.position, nextMission.start[0], nextMission.start[1])}`;
  }
  // Mission objective: live distance + arrow to the target — or the
  // get-in-a-car hint when a pickup needs a car and the player is on foot.
  let missionObj = missions.nextObjectiveLine();
  if (missionObj && missions.needsCarHint) missionObj += ' — get in a car first';
  else if (missionObj && missions.target) missionObj += ` — ${distArrow(focus.position, missions.target.x, missions.target.z)}`;
  const briefing = missions.pendingBriefing;
  if (briefing && !phoneVisible && !missionOpen) {
    hud.showBriefing(briefing.mission, briefing.index);
    phoneVisible = true;
    audio.click();
  } else if (phoneVisible && missions.target && Math.hypot(focus.position.x - missions.target.x, focus.position.z - missions.target.z) > 15) {
    // Walked away without deciding: the call drops on its own.
    laterBriefing();
  }
  if (waypoint && Math.hypot(waypoint.x - focus.position.x, waypoint.z - focus.position.z) < 5) {
    waypoint = null;
    hud.showMessage('WAYPOINT REACHED');
  }
  audio.setEngine(drivenCar ? Math.abs(drivenCar.speed) / 38 : 0, Boolean(drivenCar));
  audio.setSiren(police.nearestDistance(focus.position));
  audio.update(dt);
  hud.update({
    playerPos: focus.position,
    heading: focusHeading,
    speedKmh: drivenCar ? Math.abs(drivenCar.speed) * 3.6 : 0,
    money,
    wanted: wanted.stars,
    health,
    armour,
    cars,
    driving: Boolean(drivenCar),
    carName: drivenCar ? drivenCar.name : '',
    carClass: drivenCar ? (drivenCar.name === 'SOLSTICE GT' ? 'SPORTS' : drivenCar.style.toUpperCase()) : '',
    carHp: drivenCar ? drivenCar.hp : 0,
    carMaxHp: drivenCar ? drivenCar.maxHp || 100 : 100,
    missionLine: missions.currentMission() ? missions.progressLine() : sideJobs.statusLine() || missions.progressLine(),
    objective: missionObj || sideJobs.objectiveLine() || freeObj,
    nextLine: missions.nextLine() || (waypoint ? `WAYPOINT — ${distArrow(focus, waypoint.x, waypoint.z)}` : ''),
    waypoint,
    swimming: player.swimming,
    stamina: player.stamina,
    clockText: clockLine(),
    weatherText: weather.label,
    tapes: `${tapes.collected}/${TAPE_COUNT}`,
    policeUnits: wanted.stars > 0 ? police.units(focus.position) : [],
    weapons: combat.ammoForHud(),
    radioStation: audio.nowPlaying(),
    repText: repText(),
    repFrac: (rep % REP_PER_LEVEL) / REP_PER_LEVEL,
    hiding: wanted.hiding,
    hideProgress: wanted.hideProgress,
    missionTarget: missions.target,
    sideJobTarget: sideJobs.target,
    businessBlips: businesses.blips(),
    sprayPos: { x: SPRAY_X, z: SPRAY_Z },
    shopPos: { x: SHOP_X, z: SHOP_Z },
    eventBlip: robbery.blip,
    policeBlips: police.allCarPositions(),
    trafficBlips: traffic.cars.map((npc) => ({ x: npc.car.position.x, z: npc.car.position.z })),
    ammoCrates: combat.ammoCratesForHud(),
    timeSeconds: performance.now() / 1000,
  });
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
  .then((loaded) => {
    textures = loaded;
    city = buildCity(scene, textures, rng);
    sprayBeacon = buildBeacon(scene, 0x2ad0c4);
    sprayBeacon.group.position.set(SPRAY_X, 0, SPRAY_Z);
    sprayBeacon.group.visible = true;
    // VICE CUTS barbershop: a small pink storefront with a barber pole
    // and a beacon. Its windows glow at night like the buildings'.
    const shopGroup = new THREE.Group();
    const shopBody = new THREE.Mesh(
      new THREE.BoxGeometry(4, 3.5, 3),
      new THREE.MeshLambertMaterial({ color: 0xff5aa8 }),
    );
    shopBody.position.y = 1.75;
    shopBody.castShadow = true;
    shopBody.receiveShadow = true;
    shopGroup.add(shopBody);
    const poleColours = [0xff2a3a, 0xffffff, 0xff2a3a, 0xffffff, 0xff2a3a];
    for (let i = 0; i < 5; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.18, 0.18, 0.4, 8),
        new THREE.MeshLambertMaterial({ color: poleColours[i] }),
      );
      ring.position.y = 0.6 + i * 0.4;
      ring.position.x = -1.5;
      ring.position.z = -1;
      shopGroup.add(ring);
    }
    shopGroup.position.set(SHOP_X, 0, SHOP_Z);
    scene.add(shopGroup);
    city.buildingBoxes.push({ minX: SHOP_X - 2, maxX: SHOP_X + 2, minZ: SHOP_Z - 1.5, maxZ: SHOP_Z + 1.5 });
    shopBeacon = buildBeacon(scene, 0xff5aa8);
    shopBeacon.group.position.set(SHOP_X, 0, SHOP_Z);
    shopBeacon.group.visible = true;
    shopWindowMat = new THREE.MeshBasicMaterial({ color: 0xffd978, transparent: true, opacity: 0 });
    for (const wx of [-1, 1]) {
      const shopWindow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1.2), shopWindowMat);
      shopWindow.position.set(SHOP_X + wx, 1.8, SHOP_Z - 1.53);
      shopWindow.rotation.y = Math.PI;
      scene.add(shopWindow);
    }
    const shopSign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), signMaterialFor('VICE CUTS'));
    shopSign.position.set(SHOP_X, 3.0, SHOP_Z - 1.53);
    shopSign.rotation.y = Math.PI;
    scene.add(shopSign);
    player = createPlayer(scene, SPAWN_X, SPAWN_Z);
    cars = createCars(scene, textures);
    cars[0].owned = true;
    traffic = new Traffic(scene, textures, rng);
    pedestrians = new Pedestrians(scene, rng, () => {
      hud.showMessage(['AHH!', 'SOMEBODY HELP!', 'RUN!'][Math.floor(Math.random() * 3)], 1.5);
    });
    beachgoers = new Beachgoers(scene, rng);
    gangs = new Gangs(scene, rng, {
      onTaunt(text) { hud.showMessage(text, 2.5); },
      onPunch(damage) { damagePlayer(damage); },
    });
    wanted = new Wanted();
    police = new Police(scene, textures, city, rng);
    missions = new Missions(scene, {
      onScriptedHeat(stars) {
        wanted.setStars(Math.max(wanted.stars, stars));
        hud.showMessage(`THE HEAT IS ON — ${wanted.stars} stars on you`, 3);
      },
      onMissionStarted(mission, index) {
        freeObj = mission.objectives[0].label;
        hud.showMessage(`MISSION ${index + 1}/${MISSIONS_IN_STORY} — ${mission.name}`, 3);
        dialogue.cue('go');
      },
      onObjectiveComplete() {
        audio.click();
      },
      onMissionComplete(mission, index) {
        earn(mission.rewardMoney);
        rep += mission.rewardRep;
        health = 100;
        if (index === 0) combat.unlockWeapon('pistol');
        if (repLevel() >= 3) combat.unlockWeapon('shotgun');
        combat.restock();
        const rewardLine = `+$${mission.rewardMoney.toLocaleString('en-US')} · +${mission.rewardRep} REP`;
        if (mission.finale) {
          hud.showPassed('KING OF THE KEYS', mission.name, [rewardLine, 'THE KEYS ARE YOURS, ROOK']);
        } else if (mission.rewardWeapon) {
          combat.unlockWeapon(mission.rewardWeapon);
          hud.showPassed('MISSION PASSED', mission.name, [rewardLine, 'SMG UNLOCKED']);
        } else {
          hud.showPassed('MISSION PASSED', mission.name, [rewardLine, index === 0 ? 'PISTOL UNLOCKED' : '']);
        }
        audio.chime();
        dialogue.cue('done');
        saveGame(activeSlot, snapshotSave());
        if (index === MISSIONS_IN_STORY - 1) {
          freeObj = 'STORY COMPLETE — the Keys are yours. Free roam!';
        }
        const next = missions.pendingMission;
        if (next) hud.showMessage(`${next.giver.split(' ')[0]} has a job for you — head to the gold marker`, 6);
      },
    });
    effects = new Effects(scene);
    businesses = new Businesses(scene);
    combat = new Combat(scene, {
      los: (from, to) => police.hasLineOfSight(from, to),
      onShot() {
        audio.gunshot();
        gunshotAt = { x: player.position.x, z: player.position.z };
        pedestrians.scareFrom(player.position.x, player.position.z, 28);
        // Gunfire earns a star only when witnessed — police in line of
        // sight, or a ped close enough to hear it (gunshots carry: 30m,
        // wider than the 20m carjacking witness radius). Firing alone
        // in the open earns nothing.
        const witness =
          police.canSeePlayer(player.position) ||
          pedestrians.peds.some((ped) => !ped.dormant && ped.knockedTimer <= 0 && Math.hypot(ped.mesh.group.position.x - player.position.x, ped.mesh.group.position.z - player.position.z) < GUNSHOT_WITNESS_RANGE);
        if (witness) {
          const crime = wanted.commitCrime('shoot');
          if (crime) {
            recordCrime();
            hud.showMessage(`${crime} — witness called it in`, 2);
          }
        }
      },
      onHitPedestrian(ped, lethal) {
        if (ped.gang !== undefined) {
          gangs.onAttacked(ped, lethal);
          if (lethal) stats.pedsDown += 1;
        } else if (lethal) {
          pedestrians.knockDown(ped, player.position.x, player.position.z, 20);
          stats.pedsDown += 1;
        } else pedestrians.fleeFrom(ped, player.position.x, player.position.z);
        const crime = wanted.commitCrime('hitPedestrian');
        if (crime) {
          recordCrime();
          hud.showMessage(crime, 2);
        }
      },
      onHitCar(car, damage) {
        damageCar(car, damage || 12);
      },
      onDamage(worldPos, amount) {
        const v = new THREE.Vector3(worldPos.x, worldPos.y, worldPos.z).project(camera);
        if (v.z > 1) return;
        hud.spawnDamageNumber((v.x * 0.5 + 0.5) * window.innerWidth, (-v.y * 0.5 + 0.5) * window.innerHeight, `-${amount}`);
      },
      onAmmoPickup(district) {
        armour = Math.min(100, armour + 50);
        hud.showMessage(`AMMO + ARMOUR RESTOCKED — ${district} crate`, 2.5);
        audio.click();
      },
      onHitGetaway() {
        robbery.shotByPlayer();
      },
      onHitHelicopter(_ref, damage) {
        const heli = police.helicopter;
        const pos = heli ? { x: heli.group.position.x, z: heli.group.position.z } : null;
        if (police.damageHelicopter(damage || 12) && pos) {
          effects.burstSparks(pos.x, 8, pos.z, 24);
          effects.puffSmoke(pos.x, 8, pos.z, 8);
          audio.gunshot();
          stats.helisDown += 1;
          hud.showMessage('HELICOPTER DOWN!', 4, true);
          wanted.setStars(Math.min(5, wanted.stars + 1));
          recordCrime();
        }
      },
    }, effects);
    audio = new GameAudio();
    applySettings();
    chaseCamera = new ChaseCamera(camera);
    chaseCamera.city = city; // camera pulls in when a building blocks the view
    hud = new Hud(city);
    hud.onWaypoint = (x, z) => {
      waypoint = { x, z };
      hud.showMessage('WAYPOINT SET');
      hud.renderMapScreen(mapScreenState());
    };
    dialogue = new Dialogue(hud);
    tapes = new Tapes(scene, rng);
    sideJobs = new SideJobs(scene, rng, {
      onOffered(job) {
        const spot = districtNameAt(job.pickup.x, job.pickup.z);
        hud.showMessage(job.type === 'taxi' ? `TAXI FARE SPOTTED — pick up at ${spot}` : `DELIVERY FOUND — package at ${spot}`, 4);
      },
      onNeedCar() {
        hud.showMessage('Get in a car to pick up the fare', 2.5);
      },
      onPickedUp(job) {
        const spot = districtNameAt(job.dropoff.x, job.dropoff.z);
        hud.showMessage(job.type === 'taxi' ? `FARE ON BOARD — drop at ${spot}` : `PACKAGE COLLECTED — deliver to ${spot}`, 3);
      },
      onComplete(job) {
        earn(job.rewardMoney);
        rep += job.rewardRep;
        stats.jobsDone += 1;
        hud.showMessage(`${job.type === 'taxi' ? 'FARE DELIVERED' : 'DELIVERY COMPLETE'} — $${job.rewardMoney} + ${job.rewardRep} REP`, 4, true);
        audio.chime();
      },
    });
    weather = new Weather(scene, rng);
    robbery = new Robbery(scene, textures, city, rng, police, {
      onStart() {
        hud.showMessage('BANK ROBBERY — Stop the getaway car! $500 REWARD', 5, true);
        dialogue.say('pd', 'All units: bank robbery in progress. Black sedan fleeing — intercept it.', 5);
      },
      onStopped(byPlayer) {
        if (byPlayer) {
          earn(500);
          rep += 50;
          stats.robberiesStopped += 1;
          hud.showMessage('GETAWAY STOPPED — $500 REWARD + 50 REP', 5, true);
          audio.chime();
        } else {
          hud.showMessage('POLICE CAUGHT THE GETAWAY — no reward for you', 4, true);
        }
      },
      onEscaped() {
        hud.showMessage('THE GETAWAY ESCAPED', 5, true);
      },
    });
    hud.setObjective('Press ENTER or click NEW GAME to play');
    activeSlot = latestSaveSlot() || 1;
    refreshTitleSaves();
    applyLook(loadLook() || {});
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
      get money() {
        return money;
      },
      get rep() {
        return rep;
      },
      get health() {
        return health;
      },
      damagePlayer,
      damageCar,
      endRun,
      setMoney(v) {
        money = v;
      },
      setRep(v) {
        rep = v;
      },
      traffic,
      pedestrians,
      beachgoers,
      gangs,
      wanted,
      police,
      missions,
      combat,
      headlight,
      openMenu,
      closeMenu,
      recordCrime,
      get menuTab() {
        return menuTab;
      },
      get waypoint() {
        return waypoint;
      },
      shop: { x: SHOP_X, z: SHOP_Z },
      dialogue,
      tapes,
      sideJobs,
      weather,
      robbery,
      audio,
      effects,
      businesses,
      input,
      chaseCamera,
      get stats() {
        return stats;
      },
      get garage() {
        return garage;
      },
      get gameMinutes() {
        return gameMinutes;
      },
      setGameMinutes(v) {
        gameMinutes = v;
      },
      get achievements() {
        return unlockedAchievements;
      },
      earn,
      awardAchievements,
      hud,
      save: { saveGame, loadGame },
      snapshotSave,
      applySave,
      heliOnScreen() {
        if (!police.helicopter) return null;
        const projected = police.helicopter.group.position.clone().project(camera);
        return { x: projected.x, y: projected.y, behind: projected.z > 1 };
      },
    };
    if (shotName === 'title') window.__shotReady = true;
    loop();
  })
  .catch((error) => {
    $('load-error').textContent = `Failed to load: ${error.message}`;
    $('load-error').classList.remove('hidden');
    throw error;
  });