import { InputManager } from './InputManager.js';

/**
 * @typedef {object} ControlIntent
 * @property {number} drive  -1 (reverse) .. +1 (forward)
 * @property {number} turn   -1 (left) .. +1 (right)
 * @property {boolean} fire  fire held this step
 * @property {boolean} firePressed fire newly pressed this step (edge)
 * @property {boolean} abilityPressed activate-ability newly pressed this step (edge)
 */

/**
 * Maps a set of physical keys to an abstract {@link ControlIntent} for one tank.
 *
 * Decoupling key bindings from tank logic means the same TankController works for
 * a human (this class), an AI (an AIController producing the same intent shape),
 * or a future gamepad — the consumer only ever sees a ControlIntent.
 */
export class ControlScheme {
  /**
   * @param {InputManager} input
   * @param {{forward:string, back:string, left:string, right:string, fire:string}} bindings
   *        values are KeyboardEvent.code strings
   */
  constructor(input, bindings) {
    this._input = input;
    this.bindings = bindings;
  }

  /** @returns {ControlIntent} */
  read() {
    const b = this.bindings;
    const i = this._input;
    const drive = (i.isDown(b.forward) ? 1 : 0) - (i.isDown(b.back) ? 1 : 0);
    const turn = (i.isDown(b.right) ? 1 : 0) - (i.isDown(b.left) ? 1 : 0);
    return {
      drive,
      turn,
      fire: i.isDown(b.fire),
      firePressed: i.wasPressed(b.fire),
      abilityPressed: b.ability ? i.wasPressed(b.ability) : false,
    };
  }
}

/** A neutral, no-op intent. */
export const NEUTRAL_INTENT = Object.freeze({
  drive: 0,
  turn: 0,
  fire: false,
  firePressed: false,
  abilityPressed: false,
});
