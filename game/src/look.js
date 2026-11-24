// Character look: the VICE CUTS barbershop options (hair, shirt, skin),
// the swatch buttons the style screen shows, and applyLook, which
// clamps a partial change, repaints the player model and persists it.
// The look rides in the save file, so loading a save re-applies it.
import { G, $ } from './context.js';
import { saveLook } from './save.js';
import { SKIN_COLOURS, HAIR_COLOURS, SHIRT_COLOURS } from './pedestrians.js';

const LOOK_OPTIONS = { hair: [0, 1, 2, 5, 3].map((i) => HAIR_COLOURS[i]), shirt: [0, 1, 2, 7].map((i) => SHIRT_COLOURS[i]), skin: SKIN_COLOURS };
const LOOK_NAMES = { hair: ['BLACK', 'BROWN', 'BLOND', 'RED', 'SILVER'], shirt: ['ROSE', 'BLUE', 'GOLD', 'TEAL'], skin: ['TAN', 'HONEY', 'DARK', 'FAIR'] };

function applyLook(next) {
  G.look = { ...G.look, ...next };
  const keys = ['hair', 'shirt', 'skin'];
  for (const key of keys) {
    const max = LOOK_OPTIONS[key].length - 1;
    G.look[key] = Math.max(0, Math.min(max, G.look[key] | 0));
  }
  if (G.player) {
    G.player.setAppearance({
      hair: LOOK_OPTIONS.hair[G.look.hair],
      shirt: LOOK_OPTIONS.shirt[G.look.shirt],
      skin: LOOK_OPTIONS.skin[G.look.skin],
    });
  }
  saveLook(G.look);
  for (const key of keys) {
    const row = $(`${key}-swatches`);
    if (row) [...row.children].forEach((el, i) => el.classList.toggle('sel', i === G.look[key]));
  }
}

function buildSwatches() {
  const keys = ['hair', 'shirt', 'skin'];
  for (const key of keys) {
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

export { LOOK_OPTIONS, LOOK_NAMES, applyLook, buildSwatches };
