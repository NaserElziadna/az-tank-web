import { Weapon } from './Weapon.js';
import { WeaponType } from '../models/enums.js';
import { C } from '../constants/GameConstants.js';
import { rng } from '../core/math/Random.js';

const CFG = C.WEAPONS.SHOTGUN;

/** Sprays a cone of fast, short-lived buckshot. Devastating up close. */
export class ShotgunWeapon extends Weapon {
  constructor() {
    super(WeaponType.SHOTGUN);
    this.ammo = CFG.ammo;
    this.reloadTimer = 0;
  }

  update(dt) {
    if (this.reloadTimer > 0) this.reloadTimer -= dt;
  }

  _onPress(tank, sim) {
    if (this.ammo <= 0 || this.reloadTimer > 0) return;
    this.ammo--;
    this.reloadTimer = CFG.reload;

    for (let i = 0; i < CFG.pellets; i++) {
      const spread = (rng.next() - 0.5) * CFG.spread;
      const angle = tank.rotation + spread;
      // Origin spread across the barrel width.
      const lateral = (rng.next() - 0.5) * CFG.space;
      const m = tank.muzzle(CFG.offset);
      sim.spawnProjectile({
        kind: 'shotgun',
        ownerSlot: tank.slot,
        colorKey: tank.colorKey,
        pos: {
          x: m.x - Math.sin(tank.rotation) * lateral,
          y: m.y + Math.cos(tank.rotation) * lateral,
        },
        angle,
        speed: rng.range(CFG.speedMin, CFG.speedMax),
        radius: CFG.radius,
        maxLifetime: CFG.maxLifetime,
        lifetimeAfterHit: CFG.lifetimeAfterHit,
      });
    }
    sim.emit('weapon:fire', { weapon: 'shotgun' });
  }

  isDepleted() {
    return this.ammo <= 0 && this.reloadTimer <= 0;
  }

  hudLabel() {
    return String(this.ammo);
  }
}
