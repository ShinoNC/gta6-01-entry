import { MISSIONS_IN_STORY } from './missions.js';
const SAVE_SLOT_COUNT = 3;
const SAVE_FORMAT_VERSION = 1;
const SAVE_KEY_PREFIX = 'solaris-keys-save-';
const LOOK_KEY = 'solaris-keys-look';
const SETTINGS_KEY = 'solaris-keys-settings-v2';
const memorySlots = new Map();
function isValidSave(data) {
  if (!data || typeof data !== 'object') return false;
  if (data.version !== SAVE_FORMAT_VERSION) return false;
  if (typeof data.money !== 'number' || data.money < 0) return false;
  if (typeof data.rep !== 'number' || data.rep < 0) return false;
  if (!Number.isInteger(data.missionsDone) || data.missionsDone < 0 || data.missionsDone > MISSIONS_IN_STORY) return false;
  if (!Array.isArray(data.weaponsOwned)) return false;
  if (typeof data.playerX !== 'number' || typeof data.playerZ !== 'number') return false;
  return true;
}
export function saveGame(slot, data) {
  const record = { ...data, version: SAVE_FORMAT_VERSION, savedAt: Date.now() };
  memorySlots.set(slot, record);
  try {
    localStorage.setItem(SAVE_KEY_PREFIX + slot, JSON.stringify(record));
    return true;
  } catch {
    return true;
  }
}
export function loadGame(slot) {
  let data = null;
  try {
    const raw = localStorage.getItem(SAVE_KEY_PREFIX + slot);
    if (raw) data = JSON.parse(raw);
  } catch {
  }
  if (!data) data = memorySlots.get(slot) || null;
  return isValidSave(data) ? data : null;
}
export function saveLook(look) {
  try {
    localStorage.setItem(LOOK_KEY, JSON.stringify(look));
  } catch {
  }
}
export function loadLook() {
  try {
    const data = JSON.parse(localStorage.getItem(LOOK_KEY));
    if (data && Number.isInteger(data.hair) && Number.isInteger(data.shirt) && Number.isInteger(data.skin)) return data;
  } catch {
  }
  return null;
}
export const DEFAULT_SETTINGS = { musicVolume: 100, effectsVolume: 100, station: 0, quality: 'high', shadows: false, hudDensity: 'full' };
export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
  }
}
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const defaults = { ...DEFAULT_SETTINGS };
    if (!raw) return defaults;
    const parsed = JSON.parse(raw);
    const settings = { ...defaults };
    if (typeof parsed.musicVolume === 'number') settings.musicVolume = Math.max(0, Math.min(100, parsed.musicVolume));
    if (typeof parsed.effectsVolume === 'number') settings.effectsVolume = Math.max(0, Math.min(100, parsed.effectsVolume));
    if (typeof parsed.station === 'number') settings.station = Math.max(0, Math.min(2, Math.round(parsed.station)));
    if (parsed.quality === 'high' || parsed.quality === 'medium' || parsed.quality === 'low') settings.quality = parsed.quality;
    if (typeof parsed.shadows === 'boolean') settings.shadows = parsed.shadows;
    if (parsed.hudDensity === 'full' || parsed.hudDensity === 'minimal') settings.hudDensity = parsed.hudDensity;
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
export function latestSaveSlot() {
  let bestSlot = null;
  let bestTime = 0;
  for (let slot = 1; slot <= SAVE_SLOT_COUNT; slot += 1) {
    const data = loadGame(slot);
    if (data && data.savedAt > bestTime) {
      bestTime = data.savedAt;
      bestSlot = slot;
    }
  }
  return bestSlot;
}
export function saveSlotSummaries() {
  const summaries = [];
  for (let slot = 1; slot <= SAVE_SLOT_COUNT; slot += 1) {
    const data = loadGame(slot);
    summaries.push(
      data
        ? { slot, money: data.money, rep: data.rep, missionsDone: data.missionsDone, savedAt: data.savedAt }
        : { slot, empty: true },
    );
  }
  return summaries;
}