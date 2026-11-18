// Save slots in localStorage: three slots holding money, REP, story
// progress, unlocked weapons and the player's position. Slot 1 is the
// autosave slot, written after every completed mission. Saves carry a format
// version and are validated on load, so a corrupt or hand-edited record is
// treated as an empty slot instead of crashing the game.
import { MISSIONS_IN_STORY } from './missions.js';

export const SAVE_SLOT_COUNT = 3;
const SAVE_FORMAT_VERSION = 1;
const SAVE_KEY_PREFIX = 'solaris-keys-save-';
// In-memory fallback for browsers that block localStorage on file:// URLs.
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
    // Fall through to the in-memory slot.
  }
  if (!data) data = memorySlots.get(slot) || null;
  return isValidSave(data) ? data : null;
}

export function deleteSave(slot) {
  memorySlots.delete(slot);
  try {
    localStorage.removeItem(SAVE_KEY_PREFIX + slot);
  } catch {
    // Nothing to clean up.
  }
}

// The most recently saved non-empty slot, or null when no slot has a save.
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
