import { BulletWeapon } from './BulletWeapon.js';
import { DoubleBarrelWeapon } from './DoubleBarrelWeapon.js';
import { ShotgunWeapon } from './ShotgunWeapon.js';
import { GatlingWeapon } from './GatlingWeapon.js';
import { HomingMissileWeapon } from './HomingMissileWeapon.js';
import { MineWeapon } from './MineWeapon.js';
import { LaserWeapon } from './LaserWeapon.js';

/** Crate-content keys for weapon crates. */
export const WeaponKind = Object.freeze({
  LASER: 'laser',
  DOUBLE_BARREL: 'double',
  SHOTGUN: 'shotgun',
  HOMING: 'homing',
  MINE: 'mine',
  GATLING: 'gatling',
});

/** Crate-content keys for upgrade crates. */
export const UpgradeKind = Object.freeze({
  SHIELD: 'shield',
  AIMER: 'aimer',
  SPEED_BOOST: 'speedBoost',
});

/** Crate-content keys for one-use activatable abilities (fired with the ability key). */
export const AbilityKind = Object.freeze({
  MEGA_LASER: 'megaLaser',
  RAPID_FIRE: 'rapidFire',
  PHASE: 'phase',
  RECON: 'recon',
});

const ABILITY_SET = new Set(Object.values(AbilityKind));

const WEAPON_CTORS = {
  [WeaponKind.LASER]: LaserWeapon,
  [WeaponKind.DOUBLE_BARREL]: DoubleBarrelWeapon,
  [WeaponKind.SHOTGUN]: ShotgunWeapon,
  [WeaponKind.HOMING]: HomingMissileWeapon,
  [WeaponKind.MINE]: MineWeapon,
  [WeaponKind.GATLING]: GatlingWeapon,
};

/**
 * Builds weapons from crate keys (Factory) and applies upgrades to a tank.
 * Centralising construction keeps crate-spawning code declarative.
 */
export const WeaponFactory = {
  /** @param {string} kind {@link WeaponKind} @returns {import('./Weapon.js').Weapon} */
  create(kind) {
    const Ctor = WEAPON_CTORS[kind];
    if (!Ctor) throw new Error(`WeaponFactory: unknown weapon kind "${kind}"`);
    return new Ctor();
  },

  createDefault() {
    return new BulletWeapon();
  },

  isUpgrade(kind) {
    return kind === UpgradeKind.SHIELD || kind === UpgradeKind.AIMER || kind === UpgradeKind.SPEED_BOOST;
  },

  isAbility(kind) {
    return ABILITY_SET.has(kind);
  },

  /** Apply an upgrade crate's effect directly to the tank. */
  applyUpgrade(kind, tank) {
    if (kind === UpgradeKind.SHIELD) tank.giveShield(false);
    else if (kind === UpgradeKind.AIMER) tank.giveAimer();
    else if (kind === UpgradeKind.SPEED_BOOST) tank.giveSpeedBoost();
  },
};

/**
 * Rarity weights (relative spawn odds). A uniform pick made a game-swinging
 * Mega-Laser as likely as a humble Aimer, which reads as "lost to a lucky
 * pickup"; weighting keeps the round-deciders scarce. Common ≈ 50, uncommon ≈
 * 35, rare ≈ 15 — so any given crate is a specific rare only ~3–4% of the time.
 */
export const Rarity = Object.freeze({ COMMON: 50, UNCOMMON: 35, RARE: 15 });

/**
 * All crate contents that can spawn, with display metadata + a rarity `weight`.
 * Rare (round-deciding) items: Laser, Homing, Mega-Laser, Rapid-Fire, Phase.
 */
export const ALL_CRATES = [
  { kind: WeaponKind.DOUBLE_BARREL, upgrade: false, label: 'Double Barrel', weight: Rarity.COMMON },
  { kind: WeaponKind.MINE, upgrade: false, label: 'Mines', weight: Rarity.COMMON },
  { kind: WeaponKind.SHOTGUN, upgrade: false, label: 'Shotgun', weight: Rarity.UNCOMMON },
  { kind: WeaponKind.GATLING, upgrade: false, label: 'Gatling Gun', weight: Rarity.UNCOMMON },
  { kind: WeaponKind.HOMING, upgrade: false, label: 'Homing Missile', weight: Rarity.RARE },
  { kind: WeaponKind.LASER, upgrade: false, label: 'Laser', weight: Rarity.RARE },
  { kind: UpgradeKind.AIMER, upgrade: true, label: 'Aimer', weight: Rarity.COMMON },
  { kind: UpgradeKind.SPEED_BOOST, upgrade: true, label: 'Speed Boost', weight: Rarity.COMMON },
  { kind: UpgradeKind.SHIELD, upgrade: true, label: 'Shield', weight: Rarity.UNCOMMON },
  { kind: AbilityKind.RECON, ability: true, label: 'Recon', weight: Rarity.UNCOMMON },
  { kind: AbilityKind.MEGA_LASER, ability: true, label: 'Mega Laser', weight: Rarity.RARE },
  { kind: AbilityKind.RAPID_FIRE, ability: true, label: 'Rapid Fire', weight: Rarity.RARE },
  { kind: AbilityKind.PHASE, ability: true, label: 'Phase', weight: Rarity.RARE },
];
