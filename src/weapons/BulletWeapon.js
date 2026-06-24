import { Weapon } from './Weapon.js';
import { WeaponType } from '../models/enums.js';
import { C } from '../constants/GameConstants.js';

const CFG = C.WEAPONS.BULLET;

/**
 * The default gun. Infinite over the round, but capped at {@link CFG.ammo} live
 * bullets at once (firing is gated on how many of your bullets are still in the
 * air). One shot per trigger press.
 */
export class BulletWeapon extends Weapon {
  constructor() {
    super(WeaponType.NORMAL);
    this._cd = 0; // rapid-fire cadence cooldown
  }

  update(dt) {
    if (this._cd > 0) this._cd -= dt;
  }

  _onPress(tank, sim) {
    if (sim.liveProjectileCount(tank.slot, 'bullet') >= (tank.bulletCap ?? CFG.ammo)) return;
    this._spawn(tank, sim);
  }

  /** While the rapid-fire ability is active, stream bullets fast (held trigger). */
  _onHold(tank, sim) {
    if (!(tank.rapidFireTimer > 0) || this._cd > 0) return;
    if (sim.liveProjectileCount(tank.slot, 'bullet') >= C.ABILITIES.RAPID_FIRE.cap) return;
    this._cd = C.ABILITIES.RAPID_FIRE.cooldown;
    this._spawn(tank, sim);
  }

  _spawn(tank, sim) {
    const muzzle = tank.muzzle(CFG.offset);
    sim.spawnProjectile({
      kind: 'bullet',
      ownerSlot: tank.slot,
      colorKey: tank.colorKey,
      pos: muzzle,
      angle: tank.rotation,
      speed: CFG.speed,
      radius: CFG.radius,
      maxLifetime: CFG.maxLifetime,
      damage: CFG.damage,
    });
    sim.emit('weapon:fire', { weapon: 'bullet' });
  }

  hudLabel() {
    return '∞';
  }
}
