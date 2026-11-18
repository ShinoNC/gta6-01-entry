// Seeded random numbers (mulberry32) so the city layout is identical on every
// load for a given seed. The screenshot script and the game both use seed 1.
export function makeRng(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer in [min, max] inclusive, from a seeded rng.
export function intBetween(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// Float in [min, max), from a seeded rng.
export function range(rng, min, max) {
  return min + rng() * (max - min);
}

// True with probability p (0..1), from a seeded rng.
export function chance(rng, p) {
  return rng() < p;
}

// Pick one element of an array, from a seeded rng.
export function pick(rng, array) {
  return array[Math.floor(rng() * array.length)];
}

// Pick one entry of [value, weight] pairs, weighted by weight.
export function weightedPick(rng, entries) {
  let total = 0;
  for (const [, weight] of entries) total += weight;
  let roll = rng() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

// A shuffled copy of an array (Fisher-Yates), from a seeded rng.
export function shuffle(rng, array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
