import { Weapon } from './Weapon.js';
import { WeaponType } from '../models/enums.js';
import { C } from '../constants/GameConstants.js';

const CFG = C.WEAPONS.DOUBLE_BARREL;

/** Fires two parallel bullets side-by-side. Limited ammo, short reload. */
export class DoubleBarrelWeapon extends Weapon {
  constructor() {
    super(WeaponType.DOUBLE_BARREL);
    this.ammo = CFG.ammo; // individual rounds; 2 spent per pull
    this.reloadTimer = 0;
  }

  update(dt) {
    if (this.reloadTimer > 0) this.reloadTimer -= dt;
  }

  _onPress(tank, sim) {
    if (this.ammo < 2 || this.reloadTimer > 0) return;
    this.reloadTimer = CFG.reload;
    this.ammo -= 2;

    // Perpendicular offset for the two barrels.
    const px = -Math.sin(tank.rotation) * (CFG.space / 2);
    const py = Math.cos(tank.rotation) * (CFG.space / 2);
    for (const s of [-1, 1]) {
      const m = tank.muzzle(CFG.offset);
      sim.spawnProjectile({
        kind: 'double',
        ownerSlot: tank.slot,
        colorKey: tank.colorKey,
        pos: { x: m.x + px * s, y: m.y + py * s },
        angle: tank.rotation,
        speed: CFG.speed,
        radius: CFG.radius,
        maxLifetime: CFG.maxLifetime,
      });
    }
    sim.emit('weapon:fire', { weapon: 'double' });
  }

  isDepleted() {
    return this.ammo < 2 && this.reloadTimer <= 0;
  }

  hudLabel() {
    return String(Math.floor(this.ammo / 2));
  }
}
