// Tuning constants for the whole game: spawn, economy, crime rules and
// interaction ranges. Kept in one leaf module so every system can import
// them by name without a circular dependency on the entry file.
import { HOSPITAL_SPAWN } from './city.js';

const { x: SPAWN_X, z: SPAWN_Z } = HOSPITAL_SPAWN;
const START_MONEY = 1250, ENTER_CAR_RANGE = 5, REP_PER_LEVEL = 200;
const REP_RANKS = ['ROOKIE', 'HUSTLER', 'WHEELMAN', 'BAY HUSTLER', 'KINGPIN'];
const CLOCK_START_MINUTES = 18 * 60 + 50, CLOCK_MINUTES_PER_SECOND = 0.5;
const PEDESTRIAN_HIT_RANGE = 2.1, PEDESTRIAN_HIT_MIN_SPEED = 2;
// A car hit only counts as a crime above ~43 km/h: a parking-lot nudge
// knocks the ped down but earns no star.
const PEDESTRIAN_HIT_CRIME_SPEED = 12;
const SPRAY_X = 104, SPRAY_Z = -52, SPRAY_PRICE = 200, SPRAY_RANGE = 9;
const SHOP_X = 10, SHOP_Z = 8, SHOP_RANGE = 4.5;
const GUNSHOT_WITNESS_RANGE = 30;
const ARREST_RANGE = 3.5, ARREST_SECONDS = 3;
const POLICE_HIT_CHANCE = 0.3, POLICE_SHOT_DAMAGE = 8;
const LOCK_HINTS = ['', 'complete MISSION 1', 'complete MISSION 3', 'reach REP 3'];

export {
  SPAWN_X, SPAWN_Z, START_MONEY, ENTER_CAR_RANGE, REP_PER_LEVEL, REP_RANKS,
  CLOCK_START_MINUTES, CLOCK_MINUTES_PER_SECOND, PEDESTRIAN_HIT_RANGE,
  PEDESTRIAN_HIT_MIN_SPEED, PEDESTRIAN_HIT_CRIME_SPEED, SPRAY_X, SPRAY_Z,
  SPRAY_PRICE, SPRAY_RANGE, SHOP_X, SHOP_Z, SHOP_RANGE, GUNSHOT_WITNESS_RANGE,
  ARREST_RANGE, ARREST_SECONDS, POLICE_HIT_CHANCE, POLICE_SHOT_DAMAGE,
  LOCK_HINTS,
};
