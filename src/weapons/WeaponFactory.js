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

  /** Apply an upgrade crate's effect directly to the tank. */
  applyUpgrade(kind, tank) {
    if (kind === UpgradeKind.SHIELD) tank.giveShield(false);
    else if (kind === UpgradeKind.AIMER) tank.giveAimer();
    else if (kind === UpgradeKind.SPEED_BOOST) tank.giveSpeedBoost();
  },
};

/** All crate contents that can spawn, with display metadata. */
export const ALL_CRATES = [
  { kind: WeaponKind.DOUBLE_BARREL, upgrade: false, label: 'Double Barrel' },
  { kind: WeaponKind.SHOTGUN, upgrade: false, label: 'Shotgun' },
  { kind: WeaponKind.GATLING, upgrade: false, label: 'Gatling Gun' },
  { kind: WeaponKind.HOMING, upgrade: false, label: 'Homing Missile' },
  { kind: WeaponKind.MINE, upgrade: false, label: 'Mines' },
  { kind: WeaponKind.LASER, upgrade: false, label: 'Laser' },
  { kind: UpgradeKind.SHIELD, upgrade: true, label: 'Shield' },
  { kind: UpgradeKind.SPEED_BOOST, upgrade: true, label: 'Speed Boost' },
  { kind: UpgradeKind.AIMER, upgrade: true, label: 'Aimer' },
];
