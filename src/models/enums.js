/** Shared enumerations (frozen plain objects — lightweight and tree-shakeable). */

/** Who controls a tank. */
export const ControllerType = Object.freeze({
  HUMAN: 'human',
  AI: 'ai',
});

/** AI skill profiles. */
export const Difficulty = Object.freeze({
  EASY: 'easy',
  HARD: 'hard',
});

/**
 * Weapon kinds a tank can hold. NORMAL is the default infinite-ammo gun; the
 * rest come from weapon crates. These string values double as the render/AI
 * lookup keys, so they must match the crate `kind` keys.
 */
export const WeaponType = Object.freeze({
  NORMAL: 'normal',
  LASER: 'laser',
  DOUBLE_BARREL: 'double',
  SHOTGUN: 'shotgun',
  HOMING: 'homing',
  MINE: 'mine',
  GATLING: 'gatling',
});

/** Collectible kinds that spawn in the arena. */
export const CollectibleType = Object.freeze({
  WEAPON_CRATE: 'weaponCrate',
  GOLD: 'gold',
  DIAMOND: 'diamond',
});

/** High-level round phase used by the round state machine. */
export const RoundPhase = Object.freeze({
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  ENDING: 'ending',
  ENDED: 'ended',
});
