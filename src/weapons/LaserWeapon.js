import { Weapon } from './Weapon.js';
import { WeaponType } from '../models/enums.js';
import { C } from '../constants/GameConstants.js';

const CFG = C.WEAPONS.LASER;

/**
 * Hitscan beam. Holding the trigger charges (immobilising the tank) for
 * {@link CFG.lockTime}; on release/charge-complete it fires an instant beam that
 * reflects off walls and kills the first tank it reaches. Comes with an aimer.
 */
export class LaserWeapon extends Weapon {
  constructor() {
    super(WeaponType.LASER);
    this.ammo = 3;
    this._charging = false;
    this._lock = 0;
  }

  _onPress() {
    if (this.ammo > 0) {
      this._charging = true;
      this._lock = 0;
    }
  }

  _onHold(tank, sim) {
    if (!this._charging) return;
    this._lock += 1 / 60;
    if (this._lock >= CFG.lockTime) {
      this._charging = false;
      this.ammo--;
      sim.fireLaser(tank, tank.rotation);
      sim.emit('weapon:fire', { weapon: 'laser' });
    }
  }

  onTriggerUp() {
    super.onTriggerUp();
    this._charging = false;
    this._lock = 0;
  }

  movementLocked() {
    return this._charging;
  }

  isDepleted() {
    return this.ammo <= 0 && !this._charging;
  }

  hudLabel() {
    return String(this.ammo);
  }
}
