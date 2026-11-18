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

// Pick one element of an array, from a seeded rng.
export function pick(rng, array) {
  return array[Math.floor(rng() * array.length)];
}
