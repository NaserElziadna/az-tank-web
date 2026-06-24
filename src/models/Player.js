import { ControllerType, Difficulty } from './enums.js';

/**
 * A participant in a match — human or AI. Persists across rounds (its score
 * accumulates); the per-round tank entity is a separate, transient object.
 */
export class Player {
  /**
   * @param {object} opts
   * @param {number} opts.slot 0-based seat index
   * @param {string} opts.name display name
   * @param {string} opts.controller {@link ControllerType}
   * @param {{base:string, tread:string, accent:string, name:string}} opts.color palette entry
   * @param {import('../core/input/ControlScheme.js').ControlScheme} [opts.controls] for humans
   * @param {string} [opts.difficulty] for AI ({@link Difficulty})
   * @param {boolean} [opts.lethal] boss tank — mechanical edge + menacing skin
   */
  constructor({ slot, name, controller, color, controls = null, difficulty = Difficulty.HARD, lethal = false }) {
    this.slot = slot;
    this.name = name;
    this.controller = controller;
    this.color = color;
    this.controls = controls;
    this.difficulty = difficulty;
    this.lethal = lethal;

    this.score = 0;
    /** Live tank entity for the current round (null between rounds). */
    this.tank = null;
  }

  get isHuman() {
    return this.controller === ControllerType.HUMAN;
  }

  get isAI() {
    return this.controller === ControllerType.AI;
  }

  get isLethal() {
    return this.lethal;
  }

  addPoint(n = 1) {
    this.score += n;
  }

  reset() {
    this.score = 0;
    this.tank = null;
  }
}
