// The wanted system: 1-5 stars. Crimes add stars; hiding out of police
// sight sheds one star every few seconds. The helicopter slows hiding but
// does not stop it — a fast driver can still break away.
export const MAX_WANTED_STARS = 5;
export const SECONDS_HIDDEN_TO_LOSE_ONE_STAR = 8;
const SHOOTING_STAR_COOLDOWN_SECONDS = 4;
const HIT_STAR_COOLDOWN_SECONDS = 2;

export class Wanted {
  constructor() {
    this.stars = 0;
    this.hiddenSeconds = 0;
    this.hiding = false;
    this.lastShootStarAt = -99;
    this.lastHitStarAt = -99;
    this.elapsed = 0;
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
    this.hiddenSeconds += dt * (helicopterWatching ? 0.5 : 1);
    if (this.hiddenSeconds >= SECONDS_HIDDEN_TO_LOSE_ONE_STAR) {
      this.stars -= 1;
      this.hiddenSeconds = 0;
    }
  }
}
