import { Weapon } from './Weapon.js';
import { WeaponType } from '../models/enums.js';
import { C } from '../constants/GameConstants.js';

const CFG = C.WEAPONS.MINE;

/** Drops proximity mines behind the tank. Each arms, then detonates into shrapnel. */
export class MineWeapon extends Weapon {
  constructor() {
    super(WeaponType.MINE);
    this.ammo = CFG.ammo;
    this._cooldown = 0;
  }

  update(dt) {
    if (this._cooldown > 0) this._cooldown -= dt;
  }

  _onPress(tank, sim) {
    if (this.ammo <= 0 || this._cooldown > 0) return;
    this.ammo--;
    this._cooldown = 0.4;
    // Drop behind the tank (negative offset).
    const pos = tank.muzzle(CFG.offset);
    sim.spawnMine({ ownerSlot: tank.slot, colorKey: tank.colorKey, pos });
    sim.emit('weapon:fire', { weapon: 'mine' });
  }

  isDepleted() {
    return this.ammo <= 0 && this._cooldown <= 0;
  }

  hudLabel() {
    return String(this.ammo);
  }
}
