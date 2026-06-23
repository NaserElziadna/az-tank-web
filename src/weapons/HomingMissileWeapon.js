import { Weapon } from './Weapon.js';
import { WeaponType } from '../models/enums.js';
import { C } from '../constants/GameConstants.js';

const CFG = C.WEAPONS.HOMING;

/**
 * Single missile. Flies straight while arming ({@link CFG.activationTime}), then
 * homes on the maze-nearest tank — and becomes deadly to its own firer.
 */
export class HomingMissileWeapon extends Weapon {
  constructor() {
    super(WeaponType.HOMING);
    this.ammo = CFG.ammo;
  }

  _onPress(tank, sim) {
    if (this.ammo <= 0) return;
    this.ammo--;
    const m = tank.muzzle(CFG.offset);
    sim.spawnProjectile({
      kind: 'homing',
      ownerSlot: tank.slot,
      colorKey: tank.colorKey,
      pos: m,
      angle: tank.rotation,
      speed: CFG.speed,
      radius: CFG.radius,
      maxLifetime: CFG.maxLifetime,
      homing: true,
      activationTime: CFG.activationTime,
      deadlyToOwner: false,
    });
    sim.emit('weapon:fire', { weapon: 'homing' });
  }

  isDepleted() {
    return this.ammo <= 0;
  }

  hudLabel() {
    return String(this.ammo);
  }
}
