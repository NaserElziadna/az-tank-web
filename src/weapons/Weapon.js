/**
 * Abstract weapon (the Strategy interface every gun implements).
 *
 * A weapon turns trigger input into projectiles/mines/beams in the round
 * simulation. The tank doesn't know how any specific weapon behaves — it just
 * forwards trigger state and ticks `update`. Single-shot guns fire on the
 * trigger's rising edge (tracked by `_held`); automatic guns (gatling) fire
 * while held.
 *
 * @abstract
 */
export class Weapon {
  /** @param {string} type {@link import('../models/enums.js').WeaponType} */
  constructor(type) {
    this.type = type;
    this._held = false;
  }

  /** Called every step while the fire key is held. */
  onTriggerDown(tank, sim) {
    if (!this._held) {
      this._held = true;
      this._onPress(tank, sim);
    }
    this._onHold(tank, sim);
  }

  onTriggerUp() {
    this._held = false;
  }

  /** Rising-edge fire (single-shot weapons override this). */
  _onPress(_tank, _sim) {}

  /** Held fire (automatic weapons override this). */
  _onHold(_tank, _sim) {}

  /** Advance reload / cooldown timers. */
  update(_dt) {}

  /** Has this picked-up weapon run out and should be removed from the queue? */
  isDepleted() {
    return false;
  }

  /** Does holding this weapon immobilise the tank (e.g. laser charge)? */
  movementLocked() {
    return false;
  }

  /** Short label for the HUD (ammo / state). */
  hudLabel() {
    return '';
  }
}
