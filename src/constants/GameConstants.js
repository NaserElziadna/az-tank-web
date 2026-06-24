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
    BULLET: { radius: 0.25, speed: 18, offset: 2.5, ammo: 5, maxLifetime: 10, damage: 1 },
    LASER: { radius: 0, speed: 180, offset: 2.5, lockTime: 0.2, maxLifetime: 0.8, width: 0.2, aimerLength: 60, ammo: 1, damage: 3 },
    DOUBLE_BARREL: { radius: 0.25, speed: 18, offset: 2.25, space: 0.45, ammo: 10, reload: 1.0, maxLifetime: 6, damage: 1 },
    SHOTGUN: {
      radius: 0.1, speedMin: 30, speedMax: 35, offset: 2.45, space: 0.4,
      ammo: 3, reload: 1.0, maxLifetime: 2, lifetimeAfterHit: 0.7,
      pellets: 20, spread: 0.3, damage: 0.5,
    },
    GATLING: {
      radius: 0.1, speedMin: 25, speedMax: 30, offset: 3.0, space: 0.4,
      ammo: 20, chargeTime: 0.5, fireRate: 0.12, dischargeTime: 1.5,
      maxLifetime: 2, spread: 0.1, damage: 0.25,
    },
    HOMING: { radius: 0.38, speed: 17, offset: 2.5, accel: 42, activationTime: 1.1, maxLifetime: 10, ammo: 1, damage: 2 },
    MINE: {
      bodyRadius: 0.8, launchSpeed: 6.0, offset: -1.45, ammo: 1,
      activationDelay: 0.5, detonationDelay: 0.4,
      shrapnel: 30, shrapnelRadius: 0.1, shrapnelSpeedMin: 25, shrapnelSpeedMax: 35,
      triggerRadius: 2.8, shrapnelDamage: 0.5,
    },
  }),

  // ── Health (tanks take damage now instead of dying in one hit) ──────────────
  HEALTH: Object.freeze({
    normal: 3,
    lethal: 5,
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
    TILE_SIZE: 7.0, // m — smaller blocks → tighter, more maze-like corridors
    WALL_WIDTH: 0.8, // m
    BASE_WIDTH: 4,
    WIDTH_FOR_PLAYERS: [0, 8, 9, 10, 11, 12, 13, 14, 15],
    BASE_HEIGHT: 3,
    HEIGHT_FOR_PLAYERS: [0, 6, 6, 7, 7, 8, 8, 9, 9],
    MAX_RANDOM_MULTIPLIER: 1.4,
    MAX_WIDTH: 18,
    MAX_HEIGHT: 12,
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
    CRATE_SPAWN_MIN: 2.5,
    CRATE_SPAWN_VARIANCE: 4.0,
    CRATE_MIN_TILES_TO_TANKS: 4,
    MAX_CRATES: 4,
    GOLD_SPAWN_MIN: 20.0,
    GOLD_SPAWN_VARIANCE: 20.0,
    GOLD_MIN_TILES_TO_TANKS: 5,
    MAX_GOLDS: 3,
    PICKUP_RADIUS: 1.6, // tank picks up a collectible within this distance (m)
  }),

  // ── Round / game flow ─────────────────────────────────────────────────────
  FLOW: Object.freeze({
    BETWEEN_ROUNDS_DURATION: 1.0,
    COUNTDOWN_START_VALUE: 3,
    COUNTDOWN_DURATION: 0.5,
    // Result is shown during ENDING; this also serves as the between-rounds gap.
    ROUND_FINISHING_DURATION: 2.2,
    GO_DURATION: 0.5,
  }),

  // ── Lethal boss tank (mechanical edge over a normal tank) ───────────────────
  LETHAL: Object.freeze({
    speedBonus: 0.18, // +18% movement
    bulletCap: 7, // can keep more bullets in the air than the default 5
  }),

  MAX_WEAPON_QUEUE: 3,
});

/** Number of weapon-queue slots a tank may hold beyond its default gun. */
export const MAX_WEAPON_QUEUE = C.MAX_WEAPON_QUEUE;
