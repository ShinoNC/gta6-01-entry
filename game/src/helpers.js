// Small shared helpers: quality/settings application, progression math
// (rep, completion, earnings, achievements), clock and compass readouts,
// and the crime-witness check. Every function reads the shared context
// object, so the menu, gameplay and boot modules all use the same numbers.
import { G } from './context.js';
import { REP_PER_LEVEL, REP_RANKS } from './tuning.js';
import { districtNameAt } from './city.js';
import { MISSIONS_IN_STORY } from './missions.js';
import { TAPE_COUNT } from './tapes.js';
import { ACHIEVEMENTS, checkAchievements } from './business.js';

const QUALITY_PRESETS = { high: { pixelRatio: 1.25, shadow: 512 }, medium: { pixelRatio: 1, shadow: 512 }, low: { pixelRatio: 1, shadow: 512 } };

function applyQuality() {
  const preset = QUALITY_PRESETS[G.settings.quality] || QUALITY_PRESETS.high;
  G.renderer.setPixelRatio(Math.min(window.devicePixelRatio, preset.pixelRatio));
  const sun = G.city && G.city.sunLight;
  if (!sun) return;
  sun.shadow.mapSize.set(preset.shadow, preset.shadow);
  if (sun.shadow.map) {
    sun.shadow.map.dispose();
    sun.shadow.map = null;
  }
}

function applyShadows() {
  if (G.city && G.city.sunLight) G.city.sunLight.castShadow = G.settings.shadows;
}

function applySettings() {
  if (G.audio) {
    G.audio.setMusicVolume(G.settings.musicVolume / 100);
    G.audio.setEffectsVolume(G.settings.effectsVolume / 100);
    G.audio.setStation(G.settings.station);
  }
  applyQuality();
  applyShadows();
  document.body.classList.toggle('hud-minimal', G.settings.hudDensity === 'minimal');
}

function repLevel() {
  return 1 + Math.floor(G.rep / REP_PER_LEVEL);
}

// Every witnessed crime counts against the district it happened in —
// the map's District Standing panel reads these counts.
function recordCrime() {
  const district = districtNameAt(G.player.position.x, G.player.position.z);
  if (!G.stats.crimeCounts) G.stats.crimeCounts = {};
  const counts = G.stats.crimeCounts;
  counts[district] = (counts[district] || 0) + 1;
}

function completionPct() {
  const storyShare = (50 * G.missions.doneCount()) / MISSIONS_IN_STORY;
  const tapeShare = (15 * G.tapes.collected) / TAPE_COUNT;
  const empireShare = (20 * G.businesses.ownedCount()) / 3;
  const trophyShare = (15 * G.unlockedAchievements.length) / ACHIEVEMENTS.length;
  return Math.round(storyShare + tapeShare + empireShare + trophyShare);
}

function playTimeLine() {
  const totalMinutes = Math.floor(G.elapsed / 60);
  const hours = Math.floor(totalMinutes / 60);
  if (hours > 0) return `${hours}h ${totalMinutes % 60}m played`;
  return `${totalMinutes}m played`;
}

function earn(amount) {
  G.money = G.money + amount;
  G.stats.moneyEarned = G.stats.moneyEarned + amount;
}

function awardAchievements() {
  G.stats.businessesOwned = G.businesses ? G.businesses.ownedCount() : 0;
  const fresh = checkAchievements(G.stats, G.unlockedAchievements);
  for (const achievement of fresh) {
    G.unlockedAchievements.push(achievement.id);
    earn(achievement.reward);
    G.hud.showMessage(`ACHIEVEMENT — ${achievement.name} +$${achievement.reward.toLocaleString('en-US')}`, 4, true);
    G.audio.chime();
  }
}

function clockLine() {
  const total = G.gameMinutes;
  const day = 1 + Math.floor(total / 1440);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(Math.floor(total % 60)).padStart(2, '0');
  return `DAY ${day} ${hh}:${mm}`;
}

// Live distance + 4-way arrow to a point, relative to the camera.
function distArrow(from, tx, tz) {
  const dx = tx - from.x;
  const dz = tz - from.z;
  const fx = -Math.sin(G.chaseCamera.yaw);
  const fz = -Math.cos(G.chaseCamera.yaw);
  const ahead = dx * fx + dz * fz;
  const side = dz * fx - dx * fz;
  let arrow;
  if (Math.abs(ahead) > Math.abs(side)) arrow = ahead > 0 ? '↑' : '↓';
  else arrow = side > 0 ? '→' : '←';
  return `${Math.round(Math.hypot(dx, dz))}m ${arrow}`;
}

function nightFactor() {
  const mins = G.gameMinutes % 1440;
  if (mins >= 1080 || mins < 330) return 1;
  if (mins < 360) return 1 - (mins - 330) / 30;
  if (mins < 1050) return 0;
  return (mins - 1050) / 30;
}

function repText() {
  const level = repLevel();
  const rank = REP_RANKS[Math.min(level, REP_RANKS.length) - 1];
  return `REP ${level} · ${rank} ${G.rep % REP_PER_LEVEL}/${REP_PER_LEVEL} XP`;
}

// GTA-style witness check for a crime on foot or by car: a cop with line
// of sight, or a conscious ped within range, sees it. Unseen, no star.
function crimeWitnessed(range) {
  if (G.police.canSeePlayer(G.player.position)) return true;
  return G.pedestrians.peds.some((ped) => {
    if (ped.dormant || ped.knockedTimer > 0) return false;
    const px = ped.mesh.group.position.x - G.player.position.x;
    const pz = ped.mesh.group.position.z - G.player.position.z;
    return Math.hypot(px, pz) < range;
  });
}

export {
  applyQuality, applyShadows, applySettings, repLevel, recordCrime,
  completionPct, playTimeLine, earn, awardAchievements, clockLine,
  distArrow, nightFactor, repText, crimeWitnessed,
};
