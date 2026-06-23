import { Entity } from './Entity.js';
import { CollectibleType } from '../models/enums.js';
import { C } from '../constants/GameConstants.js';

/**
 * A pickup sitting in the arena: a weapon/upgrade crate, a gold coin, or a
 * diamond. Crates grant their contents on pickup; gold/diamond are currency
 * flair (worth a small score bonus here, since there is no metagame economy).
 */
export class CollectibleEntity extends Entity {
  /**
   * @param {object} o
   * @param {string} o.category {@link CollectibleType}
   * @param {string} [o.kind] crate contents key (weapon/upgrade) for WEAPON_CRATE
   * @param {{x:number,y:number}} o.pos
   * @param {number} [o.rotation]
   */
  constructor({ category, kind = null, pos, rotation = 0 }) {
    super();
    this.category = category;
    this.kind = kind;
    this.position.set(pos.x, pos.y);
    this.prevPosition.copy(this.position);
    this.rotation = rotation;
    this.spawnAnim = 0; // 0..1 pop-in
    this.spin = 0;
    this.radius =
      category === CollectibleType.GOLD
        ? C.COLLECTIBLE.GOLD_RADIUS
        : category === CollectibleType.DIAMOND
          ? C.COLLECTIBLE.DIAMOND_W
          : C.COLLECTIBLE.CRATE_SIZE / 2;
  }

  update(dt) {
    this.savePrevious();
    if (this.spawnAnim < 1) this.spawnAnim = Math.min(1, this.spawnAnim + dt * 3);
    if (this.category === CollectibleType.GOLD || this.category === CollectibleType.DIAMOND) {
      this.spin += dt * 2;
    }
  }
}
