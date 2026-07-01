/** Shared enumerations (frozen plain objects — lightweight and tree-shakeable). */

/** Who controls a tank. */
export const ControllerType = Object.freeze({
  HUMAN: 'human',
  AI: 'ai',
});

/** AI skill profiles. LETHAL is the boss-mode tier (maxed brain + a tank edge). */
export const Difficulty = Object.freeze({
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
  LETHAL: 'lethal',
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

/**
 * Game-mode identifiers. Each id maps to a strategy in {@link ../game/mode/GameMode.js}
 * that decides win/score/respawn rules; the engine, physics, AI and net layers
 * are mode-agnostic. CLASSIC is the original last-tank-standing, first-to-N match.
 */
export const GameModeId = Object.freeze({
  CLASSIC: 'classic', // last tank standing each round, first to N round-wins
  DEATHMATCH: 'deathmatch', // timed frag-fest, everyone respawns, most kills wins
  TEAM: 'team', // 2v2 team last-team-standing
  KING: 'king', // king of the hill — hold the centre tile
  GOLD_RUSH: 'goldRush', // grab the most gold before time runs out
  COOP: 'coop', // humans vs escalating waves of AI (PvE)
});
