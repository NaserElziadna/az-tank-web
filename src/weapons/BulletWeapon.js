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
  }

  _onPress(tank, sim) {
    if (sim.liveProjectileCount(tank.slot, 'bullet') >= (tank.bulletCap ?? CFG.ammo)) return;
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
    });
    sim.emit('weapon:fire', { weapon: 'bullet' });
  }

  hudLabel() {
    return '∞';
  }
}
