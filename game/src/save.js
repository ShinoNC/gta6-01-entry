// Save slots in localStorage: three slots holding money, REP, story
// progress, unlocked weapons and the player's position. Slot 1 is the
// autosave slot, written after every completed mission.
export const SAVE_SLOT_COUNT = 3;
const SAVE_KEY_PREFIX = 'solaris-keys-save-';
// In-memory fallback for browsers that block localStorage on file:// URLs.
const memorySlots = new Map();

export function saveGame(slot, data) {
  const record = { ...data, savedAt: Date.now() };
  memorySlots.set(slot, record);
  try {
    localStorage.setItem(SAVE_KEY_PREFIX + slot, JSON.stringify(record));
    return true;
  } catch {
    return true;
  }
}

export function loadGame(slot) {
  try {
    const raw = localStorage.getItem(SAVE_KEY_PREFIX + slot);
    if (raw) return JSON.parse(raw);
  } catch {
    // Fall through to the in-memory slot.
  }
  return memorySlots.get(slot) || null;
}

export function saveSlotSummaries() {
  const summaries = [];
  for (let slot = 1; slot <= SAVE_SLOT_COUNT; slot += 1) {
    const data = loadGame(slot);
    summaries.push(
      data ? { slot, money: data.money, missionsDone: data.missionsDone, savedAt: data.savedAt } : { slot, empty: true },
    );
  }
  return summaries;
}
