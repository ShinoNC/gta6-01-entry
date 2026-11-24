// UI event bindings: every button, settings control and delegated click
// handler the page wires up. Called once from the entry file with the two
// functions that still live there (startGame, recoverFromDown) — passing
// them in keeps this module from importing the entry file back. Save and
// load buttons are re-rendered by innerHTML, so those handlers live on
// the document and match the button by attribute.
import { G, $, on, setBootPhase } from './context.js';
import { SPRAY_PRICE } from './tuning.js';
import { applyQuality, applyShadows, repLevel, awardAchievements } from './helpers.js';
import {
  openSettings, closeSettings, openStyleScreen, closeStyleScreen,
  showMenuTab, closeMenu, openMissionScreen, closeMissionScreen,
  openEmpireScreen, closeEmpireScreen, openGarageScreen, closeGarageScreen,
  applyGarageToCar, acceptBriefing, laterBriefing, openLoadScreen,
  closeLoadScreen, mapScreenState,
} from './menus.js';
import { snapshotSave, applySave } from './savegame.js';
import { saveGame, loadGame, saveSettings, saveSlotSummaries } from './save.js';

// Short hint strip on short screens: the full line wraps to two lines
// and its second line clips at the viewport bottom (audit 2026-11-21).
const HINT_FULL = 'W/S&nbsp;move · A/D&nbsp;turn · F&nbsp;enter&nbsp;car · CLICK&nbsp;punch&nbsp;/&nbsp;shoot · SPACE&nbsp;jump · M&nbsp;missions · B&nbsp;business · N&nbsp;map';
const HINT_SHORT = 'W/S&nbsp;move · F&nbsp;car · CLICK&nbsp;attack · M&nbsp;missions · N&nbsp;map';
function syncHint() {
  $('hud-hint').innerHTML = window.innerHeight <= 500 ? HINT_SHORT : HINT_FULL;
}

function bindUI({ startGame, recoverFromDown }) {
  $('start-button').disabled = true;
  $('load-button').disabled = true;
  setBootPhase('LOADING…');
  on('start-button', () => {
    if (!G.booted) return;
    if (loadGame(G.activeSlot) && !G.overwriteArmed) {
      G.overwriteArmed = true;
      $('start-button').textContent = `OVERWRITE SLOT ${G.activeSlot}? CLICK AGAIN`;
      return;
    }
    G.overwriteArmed = false;
    $('start-button').textContent = 'NEW GAME';
    startGame();
  });
  on('load-button', openLoadScreen);
  on('load-back-button', closeLoadScreen);
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
      if (G.menuOpen) showMenuTab(tab.dataset.tab);
    });
  });
  // Save slots are re-rendered by innerHTML (MAP sidebar + SAVE tab), so
  // the handler lives on the document and matches the button by attribute.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-save-slot]');
    if (!btn) return;
    const slot = Number(btn.dataset.saveSlot);
    saveGame(slot, snapshotSave());
    G.hud.showMessage(`GAME SAVED — SLOT ${slot}`);
    if (G.menuOpen && G.menuTab === 'map') G.hud.renderMapScreen(mapScreenState());
    if (G.menuOpen && G.menuTab === 'save') G.hud.renderSaveScreen(saveSlotSummaries());
  });
  // Load buttons are re-rendered by innerHTML (LOAD GAME screen), so this
  // handler also lives on the document and matches by attribute.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-load-slot]');
    if (!btn) return;
    if (!G.booted) return; // applySave needs the world (player, cars, ...)
    const slot = Number(btn.dataset.loadSlot);
    const data = loadGame(slot);
    if (!data) {
      G.hud.showMessage('That slot is empty — pick a slot with a save');
      return;
    }
    G.activeSlot = slot;
    applySave(data);
    closeLoadScreen();
    startGame();
  });
  $('music-volume').addEventListener('input', (event) => {
    G.settings.musicVolume = Number(event.target.value);
    $('music-volume-value').textContent = G.settings.musicVolume;
    if (G.audio) G.audio.setMusicVolume(G.settings.musicVolume / 100);
    saveSettings(G.settings);
  });
  $('effects-volume').addEventListener('input', (event) => {
    G.settings.effectsVolume = Number(event.target.value);
    $('effects-volume-value').textContent = G.settings.effectsVolume;
    if (G.audio) G.audio.setEffectsVolume(G.settings.effectsVolume / 100);
    saveSettings(G.settings);
  });
  $('radio-station').addEventListener('change', (event) => {
    G.settings.station = event.target.selectedIndex;
    if (G.audio) G.audio.setStation(G.settings.station);
    saveSettings(G.settings);
  });
  $('quality-select').addEventListener('change', (event) => {
    G.settings.quality = event.target.value;
    applyQuality();
    saveSettings(G.settings);
  });
  $('shadows-toggle').addEventListener('change', (event) => {
    G.settings.shadows = event.target.checked;
    applyShadows();
    saveSettings(G.settings);
  });
  $('hud-density').addEventListener('change', (event) => {
    G.settings.hudDensity = event.target.value;
    document.body.classList.toggle('hud-minimal', G.settings.hudDensity === 'minimal');
    saveSettings(G.settings);
  });
  on('save-button', () => {
    saveGame(G.activeSlot, snapshotSave());
    G.hud.showMessage(`GAME SAVED — SLOT ${G.activeSlot}`);
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
  on('stats-close-button', closeMenu);
  on('save-close-button', closeMenu);
  on('garage-close-button', closeGarageScreen);
  on('garage-list', (event) => {
    const button = event.target.closest('.garage-buy');
    if (!button || !G.drivenCar) return;
    const action = button.dataset.action;
    if (action === 'repair') {
      if (G.money < SPRAY_PRICE) return;
      G.money = G.money - SPRAY_PRICE;
      G.drivenCar.hp = G.drivenCar.maxHp;
      G.drivenCar.burning = false;
      G.drivenCar.warned = false;
      G.wanted.setStars(0);
      G.hud.showMessage("PAY'N'SPRAY — car repaired, heat cleared ($200)", 3);
    } else {
      const prices = { engine: 4000, armour: 3000, nitro: 3000 };
      if (G.garage[action] || G.money < prices[action]) return;
      G.money = G.money - prices[action];
      G.garage[action] = true;
      applyGarageToCar(G.drivenCar);
      if (action === 'armour') {
        G.drivenCar.maxHp = 200;
        G.drivenCar.hp = 200;
      }
      G.hud.showMessage(`${action.toUpperCase()} INSTALLED — every car you drive from now on`, 4, true);
    }
    G.audio.chime();
    openGarageScreen();
    saveGame(G.activeSlot, snapshotSave());
  });
  on('empire-list', (event) => {
    const buyButton = event.target.closest('.empire-buy');
    const upgradeButton = event.target.closest('.empire-upgrade');
    if (buyButton) {
      const index = Number.parseInt(buyButton.dataset.index, 10);
      const def = G.businesses.defs[index];
      if (G.businesses.canBuy(index, G.money, repLevel()) !== 'ok') return;
      G.money = G.money - def.price;
      G.businesses.buy(index);
      G.stats.businessesOwned = G.businesses.ownedCount();
      G.hud.showMessage(`${def.name} IS YOURS — income starts now`, 4, true);
      G.audio.chime();
      awardAchievements();
      openEmpireScreen();
      saveGame(G.activeSlot, snapshotSave());
    } else if (upgradeButton) {
      const index = Number.parseInt(upgradeButton.dataset.index, 10);
      const def = G.businesses.defs[index];
      if (G.businesses.canUpgrade(index, G.money) !== 'ok') return;
      G.money = G.money - G.businesses.upgradeCost(index);
      G.businesses.upgrade(index);
      G.hud.showMessage(`${def.name} UPGRADED — LV ${G.businesses.state[index].level}`, 4, true);
      G.audio.chime();
      openEmpireScreen();
      saveGame(G.activeSlot, snapshotSave());
    }
  });
  on('phone-accept', acceptBriefing);
  on('phone-later', laterBriefing);
  syncHint();
  window.addEventListener('resize', () => {
    syncHint();
    G.camera.aspect = window.innerWidth / window.innerHeight;
    G.camera.updateProjectionMatrix();
    G.renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

export { bindUI };
