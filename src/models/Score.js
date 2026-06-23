/**
 * Match scoreboard. Owns the running tally per player and the win condition.
 *
 * The classic rules award a point to the last tank standing each round; the
 * match runs until a player reaches {@link Score#target} (or endlessly if 0).
 */
export class Score {
  /** @param {number} [target] points to win; 0 = endless */
  constructor(target = 0) {
    this.target = target;
    /** @type {Map<number, number>} playerSlot -> points */
    this._points = new Map();
  }

  register(slot) {
    if (!this._points.has(slot)) this._points.set(slot, 0);
  }

  get(slot) {
    return this._points.get(slot) ?? 0;
  }

  award(slot, n = 1) {
    this._points.set(slot, this.get(slot) + n);
  }

  /** @returns {number|null} winning slot if the target is reached, else null */
  get winnerSlot() {
    if (this.target <= 0) return null;
    for (const [slot, pts] of this._points) {
      if (pts >= this.target) return slot;
    }
    return null;
  }

  reset() {
    for (const slot of this._points.keys()) this._points.set(slot, 0);
  }
}
