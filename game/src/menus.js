// Menus and screens: the tabbed in-game menu (MAP | STORY | STATS |
// EMPIRE | SETTINGS | CONTROLS | SAVE), the settings and style screens,
// the garage, the load screen and the phone briefings. The old screen
// openers route through the menu — M/B/N and the pause buttons all land
// on the right tab — and the game pauses while the menu is open.
import { G, $ } from './context.js';
import { SPRAY_X, SPRAY_Z, SHOP_X, SHOP_Z } from './tuning.js';
import { completionPct, playTimeLine, repLevel, distArrow } from './helpers.js';
import { districtNameAt, districtList } from './city.js';
import { saveSlotSummaries } from './save.js';
import { ACHIEVEMENTS } from './business.js';
import { TAPE_COUNT } from './tapes.js';

const titleScreen = $('title-screen');
const pauseScreen = $('pause-screen');
const settingsScreen = $('settings-screen');

function openSettings() {
  titleScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  G.hud.hideMessage();
  settingsScreen.classList.remove('hidden');
  G.settingsOpen = true;
  syncSettingsControls();
}

function closeSettings() {
  // From the menu (SETTINGS/CONTROLS tab), BACK closes the whole menu —
  // the standalone path below would show the title screen over the game.
  if (G.menuOpen) {
    closeMenu();
    return;
  }
  settingsScreen.classList.add('hidden');
  G.settingsOpen = false;
  if (G.state === 'pause') pauseScreen.classList.remove('hidden');
  else titleScreen.classList.remove('hidden');
}

function syncSettingsControls() {
  const stationSelect = $('radio-station');
  if (G.audio && stationSelect.options.length === 0) {
    for (const name of G.audio.stationNames()) {
      const option = document.createElement('option');
      option.textContent = name;
      stationSelect.appendChild(option);
    }
  }
  $('music-volume').value = G.settings.musicVolume;
  $('music-volume-value').textContent = G.settings.musicVolume;
  $('effects-volume').value = G.settings.effectsVolume;
  $('effects-volume-value').textContent = G.settings.effectsVolume;
  stationSelect.selectedIndex = G.settings.station;
  $('quality-select').value = G.settings.quality;
  $('shadows-toggle').checked = G.settings.shadows;
  $('hud-density').value = G.settings.hudDensity;
}

function openStyleScreen() {
  if (G.missionOpen) closeMissionScreen();
  if (G.empireOpen) closeEmpireScreen();
  if (G.mapOpen) closeMapScreen();
  if (G.garageOpen) closeGarageScreen();
  G.hud.hideMessage();
  $('style-screen').classList.remove('hidden');
  G.styleOpen = true;
}

function closeStyleScreen() {
  $('style-screen').classList.add('hidden');
  G.styleOpen = false;
}

// One tabbed menu (MAP | STORY | STATS | EMPIRE | SETTINGS | CONTROLS |
// SAVE): N and Esc both open it at MAP, M at STORY, B at EMPIRE; Q/E
// switch tabs, Esc closes. The game pauses while it is open (see
// update's early return).
const MENU_TABS = ['map', 'story', 'stats', 'empire', 'settings', 'controls', 'save'];

function nextMissionInfo() {
  const mission = G.missions.currentMission();
  const focus = G.drivenCar || G.player;
  if (mission) {
    const objective = G.missions.currentObjective();
    const target = G.missions.target;
    const dist = target ? Math.hypot(target.x - focus.position.x, target.z - focus.position.z) / 1000 : 0;
    return { name: mission.name, objective: objective ? objective.label : mission.briefing, distanceKm: `${dist.toFixed(2)} km` };
  }
  const next = G.missions.statusList().find((e) => e.status === 'pending');
  if (next) {
    const dist = next.start ? Math.hypot(next.start[0] - focus.position.x, next.start[1] - focus.position.z) / 1000 : 0;
    return { name: next.name, objective: next.briefing, distanceKm: `${dist.toFixed(2)} km` };
  }
  return { name: 'ALL JOBS DONE', objective: 'Every story job is complete — free roam the island.', distanceKm: '—' };
}

// District standing from real per-district crime counts (display only).
function districtStandings() {
  return districtList().map((d) => {
    const crimes = G.stats.crimeCounts?.[d.name] || 0;
    let status = 'NEUTRAL';
    if (crimes >= 5) status = 'HOT';
    else if (crimes > 0) status = 'WARY';
    return { ...d, crimes, status };
  });
}

// Standing label for the district the player is in (HUD rep row).
function districtStatusAt(x, z) {
  const name = districtNameAt(x, z);
  const crimes = G.stats.crimeCounts?.[name] || 0;
  if (crimes >= 5) return 'HOT';
  if (crimes > 0) return 'WARY';
  return 'NEUTRAL';
}

function mapScreenState() {
  const focus = G.drivenCar || G.player;
  const heading = G.drivenCar ? G.drivenCar.heading : G.player.heading;
  const trafficBlips = G.traffic.cars.map((npc) => ({ x: npc.car.position.x, z: npc.car.position.z }));
  return {
    playerPos: focus.position,
    playerHeading: heading,
    cars: G.cars,
    driving: Boolean(G.drivenCar),
    missionTarget: G.missions.target,
    waypoint: G.waypoint,
    policeBlips: G.police.allCarPositions(),
    timeSeconds: performance.now() / 1000,
    trafficBlips,
    ammoCrates: G.combat.ammoCratesForHud(),
    sideJobTarget: G.sideJobs.target,
    eventBlip: G.robbery.blip,
    businessBlips: G.businesses.blips(),
    sprayPos: { x: SPRAY_X, z: SPRAY_Z },
    shopPos: { x: SHOP_X, z: SHOP_Z },
    nextMission: nextMissionInfo(),
    districts: districtStandings(),
    waypointInfo: G.waypoint ? distArrow(focus.position, G.waypoint.x, G.waypoint.z) : '',
  };
}

function showMenuTab(tab) {
  G.hud.hideMissionScreen();
  G.hud.hideEmpireScreen();
  G.hud.hideMapScreen();
  G.hud.hideStatsScreen();
  G.hud.hideSaveScreen();
  settingsScreen.classList.add('hidden');
  G.missionOpen = G.empireOpen = G.mapOpen = G.statsOpen = G.saveOpen = false;
  G.settingsOpen = false;
  G.menuTab = tab;
  G.hud.setActiveMenuTab(tab);
  if (tab === 'map') {
    G.hud.resetMapView();
    // Show first: renderMapScreen paints the canvas, and the label floor
    // reads the canvas's displayed width (0 while hidden).
    G.hud.showMapScreen();
    G.hud.renderMapScreen(mapScreenState());
    G.mapOpen = true;
  } else if (tab === 'story') {
    G.hud.renderMissionList(G.missions.statusList(), G.missions.stageIndex, completionPct(), playTimeLine());
    G.hud.showMissionScreen();
    G.missionOpen = true;
  } else if (tab === 'stats') {
    G.hud.renderStatsScreen(G.stats, { tapes: `${G.tapes.collected}/${TAPE_COUNT}`, playTime: playTimeLine(), pct: completionPct() });
    G.hud.showStatsScreen();
    G.statsOpen = true;
  } else if (tab === 'empire') {
    G.hud.renderEmpireScreen(G.businesses, G.stats, ACHIEVEMENTS, G.unlockedAchievements, G.money, repLevel(), completionPct());
    G.hud.showEmpireScreen();
    G.empireOpen = true;
  } else if (tab === 'settings' || tab === 'controls') {
    // The settings panel lives in the menu now: pre-select the inner tab
    // and hide the inner tab bar (the menu tabs replace it).
    document.querySelectorAll('.settings-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tab));
    $('settings-tab-panel').classList.toggle('hidden', tab !== 'settings');
    $('controls-tab-panel').classList.toggle('hidden', tab !== 'controls');
    settingsScreen.classList.add('in-menu');
    settingsScreen.classList.remove('hidden');
    G.settingsOpen = true;
    syncSettingsControls();
  } else if (tab === 'save') {
    G.hud.renderSaveScreen(saveSlotSummaries());
    G.hud.showSaveScreen();
    G.saveOpen = true;
  }
}

function openMenu(tab) {
  if (G.garageOpen) closeGarageScreen();
  if (G.styleOpen) closeStyleScreen();
  G.menuOpen = true;
  G.hud.showMenuTabs();
  showMenuTab(tab);
}

function closeMenu() {
  G.menuOpen = false;
  G.hud.hideMenuTabs();
  G.hud.hideMissionScreen();
  G.hud.hideEmpireScreen();
  G.hud.hideMapScreen();
  G.hud.hideStatsScreen();
  G.hud.hideSaveScreen();
  settingsScreen.classList.add('hidden');
  settingsScreen.classList.remove('in-menu');
  G.missionOpen = G.empireOpen = G.mapOpen = G.statsOpen = G.saveOpen = false;
  G.settingsOpen = false;
}

function switchMenuTab(delta) {
  const idx = MENU_TABS.indexOf(G.menuTab);
  const next = (idx + delta + MENU_TABS.length) % MENU_TABS.length;
  showMenuTab(MENU_TABS[next]);
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
  if (G.missionOpen) closeMissionScreen();
  if (G.empireOpen) closeEmpireScreen();
  if (G.mapOpen) closeMapScreen();
  G.hud.renderGarageScreen(G.garage, G.money, G.drivenCar, G.wanted.stars);
  G.hud.showGarageScreen();
  G.garageOpen = true;
}

function closeGarageScreen() {
  G.hud.hideGarageScreen();
  G.garageOpen = false;
}

function applyGarageToCar(car) {
  if (G.garage.engine && !car._tuned) {
    car.maxSpeed = car.maxSpeed * 1.15;
    car.accel = car.accel * 1.15;
    car._tuned = true;
  }
  if (G.garage.armour && !car._armoured) {
    const base = car.baseMaxHp || 100;
    car.maxHp = base * 2;
    if (car.hp >= base) car.hp = car.maxHp;
    car._armoured = true;
  }
  car.nitro = G.garage.nitro;
}

function acceptBriefing() {
  const briefing = G.missions.pendingBriefing;
  if (!briefing) return;
  G.hud.hideBriefing();
  G.phoneVisible = false;
  G.missions.startMission(briefing.index);
}

function laterBriefing() {
  if (!G.phoneVisible) return;
  G.hud.hideBriefing();
  G.phoneVisible = false;
  G.missions.dismissBriefing();
}

// Load Game opens the slot picker: the title has no slot selector any
// more — the 3 slots live here, and only here. Resuming means picking
// one of them; NEW GAME always starts fresh (in the latest slot).
function openLoadScreen() {
  G.hud.renderLoadScreen(saveSlotSummaries());
  G.hud.showLoadScreen();
  G.loadOpen = true;
}

function closeLoadScreen() {
  G.hud.hideLoadScreen();
  G.loadOpen = false;
}

export {
  MENU_TABS, openSettings, closeSettings, syncSettingsControls,
  openStyleScreen, closeStyleScreen, nextMissionInfo, districtStandings,
  districtStatusAt, mapScreenState, showMenuTab, openMenu, closeMenu,
  switchMenuTab, openMissionScreen, closeMissionScreen, openEmpireScreen,
  closeEmpireScreen, openMapScreen, closeMapScreen, openGarageScreen,
  closeGarageScreen, applyGarageToCar, acceptBriefing, laterBriefing,
  openLoadScreen, closeLoadScreen,
};
