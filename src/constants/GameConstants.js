/**
 * Master configuration table.
 *
 * All gameplay simulation runs in METRES (the renderer scales by PIXELS_PER_METER).
 * Values are tuned to reproduce the feel of the classic top-down tank battler:
 * fast tanks, constant-speed bullets that bounce off walls, one-hit kills, and a
 * fresh procedural maze every round. Grouped and frozen so it reads as one
 * immutable config object.
 */
export const C = Object.freeze({
  // ── Units / world ─────────────────────────────────────────────────────────
  PIXELS_PER_METER: 20,
  METERS_PER_PIXEL: 1 / 20,

  // ── Simulation ────────────────────────────────────────────────────────────
  STEP: 1 / 60, // fixed timestep (s)
  MAX_DELTA_TIME: 0.1,

  // ── Tank ──────────────────────────────────────────────────────────────────
  TANK: Object.freeze({
    WIDTH: 3.0, // m (across treads)
    HEIGHT: 4.0, // m (front-to-back)
    COLLISION_RADIUS: 1.5, // circle proxy for wall collisions
    FORWARD_SPEED: 15.95, // m/s
    BACK_SPEED: 12.8, // m/s
    ROTATION_SPEED: 5.0, // rad/s
    BARREL_LENGTH: 2.5, // muzzle distance from centre (m)
  }),

  // ── Projectile (defaults / shared) ────────────────────────────────────────
  PROJECTILE: Object.freeze({
    BOUNCE_TIMEOUT_WINDOW: 0.035, // s
    BOUNCE_TIMEOUT_COUNT: 5,
  }),

  // ── Weapons ───────────────────────────────────────────────────────────────
  // speeds m/s, radii m, lifetimes s, offsets m.
  WEAPONS: Object.freeze({
    BULLET: { radius: 0.25, speed: 18, offset: 2.5, ammo: 5, maxLifetime: 10 },
    LASER: { radius: 0, speed: 180, offset: 2.5, lockTime: 0.2, maxLifetime: 0.8, width: 0.2, aimerLength: 60 },
    DOUBLE_BARREL: { radius: 0.25, speed: 18, offset: 2.25, space: 0.45, ammo: 10, reload: 1.0, maxLifetime: 6 },
    SHOTGUN: {
      radius: 0.1, speedMin: 30, speedMax: 35, offset: 2.45, space: 0.4,
      ammo: 3, reload: 1.0, maxLifetime: 2, lifetimeAfterHit: 0.7,
      pellets: 20, spread: 0.3,
    },
    GATLING: {
      radius: 0.1, speedMin: 25, speedMax: 30, offset: 3.0, space: 0.4,
      ammo: 20, chargeTime: 0.5, fireRate: 0.12, dischargeTime: 1.5,
      maxLifetime: 2, spread: 0.1,
    },
    HOMING: { radius: 0.2, speed: 18, offset: 2.5, accel: 40, activationTime: 2.0, maxLifetime: 10, ammo: 1 },
    MINE: {
      bodyRadius: 0.8, launchSpeed: 12.5, offset: -1.45, ammo: 3,
      activationDelay: 0.5, detonationDelay: 0.4,
      shrapnel: 30, shrapnelRadius: 0.1, shrapnelSpeedMin: 25, shrapnelSpeedMax: 35,
      triggerRadius: 1.4,
    },
  }),

  // ── Upgrades ──────────────────────────────────────────────────────────────
  UPGRADES: Object.freeze({
    SHIELD: { radius: 4.3 / 2, lifetime: 6.0, weakenTime: 2.0 },
    SPAWN_SHIELD: { radius: 4.3 / 2, lifetime: 4.0, weakenTime: 2.0 },
    AIMER: { length: 60, lifetime: 10.0 },
    SPEED_BOOST: { lifetime: 10.0, effect: 0.3 },
  }),

  // ── Maze ──────────────────────────────────────────────────────────────────
  MAZE: Object.freeze({
    TILE_SIZE: 10.0, // m
    WALL_WIDTH: 0.8, // m
    BASE_WIDTH: 2,
    WIDTH_FOR_PLAYERS: [0, 2, 4, 6, 8, 9, 10, 11, 12],
    BASE_HEIGHT: 2,
    HEIGHT_FOR_PLAYERS: [0, 1, 2, 3, 4, 5, 5, 6, 6],
    MAX_RANDOM_MULTIPLIER: 1.5,
    MAX_WIDTH: 16,
    MAX_HEIGHT: 10,
    TILE_PROBABILITIES: [0.5, 0.7, 0.9, 0.9, 1.0],
    WALL_PROBABILITIES: [0.5, 0.8, 0.9, 1.0, 1.0],
    MIN_TILES_BETWEEN_TANKS: 4,
    MIN_TILES_PER_TANK: 5,
    MAX_DEAD_END_PENALTY: 5,
  }),

  // ── Collectibles ──────────────────────────────────────────────────────────
  COLLECTIBLE: Object.freeze({
    CRATE_SIZE: 3.2, // m
    GOLD_RADIUS: 1.75,
    DIAMOND_W: 2.2,
    DIAMOND_H: 3.8,
    CRATE_SPAWN_MIN: 3.0,
    CRATE_SPAWN_VARIANCE: 5.0,
    CRATE_MIN_TILES_TO_TANKS: 4,
    MAX_CRATES: 3,
    GOLD_SPAWN_MIN: 12.0,
    GOLD_SPAWN_VARIANCE: 14.0,
    GOLD_MIN_TILES_TO_TANKS: 5,
    MAX_GOLDS: 3,
    PICKUP_RADIUS: 1.6, // tank picks up a collectible within this distance (m)
  }),

  // ── Round / game flow ─────────────────────────────────────────────────────
  FLOW: Object.freeze({
    BETWEEN_ROUNDS_DURATION: 1.0,
    COUNTDOWN_START_VALUE: 3,
    COUNTDOWN_DURATION: 0.5,
    ROUND_FINISHING_DURATION: 1.6, // brief pause after a winner is decided
    GO_DURATION: 0.5,
  }),

  MAX_WEAPON_QUEUE: 3,
});

/** Number of weapon-queue slots a tank may hold beyond its default gun. */
export const MAX_WEAPON_QUEUE = C.MAX_WEAPON_QUEUE;
