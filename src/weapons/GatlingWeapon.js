import { Weapon } from './Weapon.js';
import { WeaponType } from '../models/enums.js';
import { C } from '../constants/GameConstants.js';
import { rng } from '../core/math/Random.js';

const CFG = C.WEAPONS.GATLING;

/**
 * Automatic gun: spins up for {@link CFG.chargeTime} then streams rounds at
 * {@link CFG.fireRate} while the trigger is held, with a slight random cone.
 */
export class GatlingWeapon extends Weapon {
  constructor() {
    super(WeaponType.GATLING);
    this.ammo = CFG.ammo;
    this.charge = 0; // spin-up progress while held
    this._fireCooldown = 0;
  }

  update(dt) {
    if (this._fireCooldown > 0) this._fireCooldown -= dt;
    if (!this._held && this.charge > 0) this.charge = Math.max(0, this.charge - dt / CFG.dischargeTime);
  }

  _onHold(tank, sim) {
    this.charge = Math.min(1, this.charge + 1 / 60 / CFG.chargeTime);
    if (this.charge < 1) return;
    if (this.ammo <= 0 || this._fireCooldown > 0) return;
    this._fireCooldown = CFG.fireRate;
    this.ammo--;

    const angle = tank.rotation + (rng.next() - 0.5) * CFG.spread;
    const m = tank.muzzle(CFG.offset);
    sim.spawnProjectile({
      kind: 'gatling',
      ownerSlot: tank.slot,
      colorKey: tank.colorKey,
      pos: m,
      angle,
      speed: rng.range(CFG.speedMin, CFG.speedMax),
      radius: CFG.radius,
      maxLifetime: CFG.maxLifetime,
    });
    sim.emit('weapon:fire', { weapon: 'gatling' });
  }

  isDepleted() {
    return this.ammo <= 0;
  }

  hudLabel() {
    return String(this.ammo);
  }
}
