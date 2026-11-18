// The wanted system: 1-5 stars. Crimes add stars; hiding out of police
// sight sheds one star at a time. Shedding gets slower the hotter you are —
// one star cools off in seconds, five stars take a long quiet stretch — and
// the helicopter overhead slows hiding to a crawl without stopping it, so a
// fast driver who breaks line of sight can still get clean.
export const MAX_WANTED_STARS = 5;
// Seconds hidden to shed one star at 1 star; each extra star adds more.
const HIDE_SECONDS_AT_ONE_STAR = 6;
const HIDE_SECONDS_PER_EXTRA_STAR = 3;
const HELICOPTER_HIDE_RATE = 0.35;
const SHOOTING_STAR_COOLDOWN_SECONDS = 4;
const HIT_STAR_COOLDOWN_SECONDS = 2;

// How long the player must stay hidden to shed one star at this heat.
export function hideSecondsForStars(stars) {
  return HIDE_SECONDS_AT_ONE_STAR + HIDE_SECONDS_PER_EXTRA_STAR * Math.max(0, stars - 1);
}

export class Wanted {
  constructor() {
    this.stars = 0;
    this.hiddenSeconds = 0;
    this.hiding = false;
    this.lastShootStarAt = -99;
    this.lastHitStarAt = -99;
    this.elapsed = 0;
  }

  // 0..1 progress toward shedding the next star while hidden.
  get hideProgress() {
    if (this.stars === 0) return 0;
    return Math.min(1, this.hiddenSeconds / hideSecondsForStars(this.stars));
  }

  // Records a crime. Returns the toast text, or '' when the crime adds no
  // star (a cooldown, or already at the maximum).
  commitCrime(kind) {
    if (this.stars >= MAX_WANTED_STARS) return '';
    if (kind === 'shoot') {
      if (this.elapsed - this.lastShootStarAt < SHOOTING_STAR_COOLDOWN_SECONDS) return '';
      this.lastShootStarAt = this.elapsed;
    }
    if (kind === 'hitPedestrian') {
      if (this.elapsed - this.lastHitStarAt < HIT_STAR_COOLDOWN_SECONDS) return '';
      this.lastHitStarAt = this.elapsed;
    }
    this.stars += 1;
    this.hiddenSeconds = 0;
    if (kind === 'steal') return 'WANTED LEVEL UP — vehicle theft';
    if (kind === 'hitPedestrian') return 'WANTED LEVEL UP — pedestrian hit';
    return 'WANTED LEVEL UP — shots fired';
  }

  setStars(starCount) {
    this.stars = Math.max(0, Math.min(MAX_WANTED_STARS, starCount));
    this.hiddenSeconds = 0;
  }

  update(dt, policeCanSeePlayer, helicopterWatching) {
    this.elapsed += dt;
    if (this.stars === 0) {
      this.hiding = false;
      this.hiddenSeconds = 0;
      return;
    }
    if (policeCanSeePlayer) {
      this.hiddenSeconds = 0;
      this.hiding = false;
      return;
    }
    this.hiding = true;
    this.hiddenSeconds += dt * (helicopterWatching ? HELICOPTER_HIDE_RATE : 1);
    if (this.hiddenSeconds >= hideSecondsForStars(this.stars)) {
      this.stars -= 1;
      this.hiddenSeconds = 0;
    }
  }
}
