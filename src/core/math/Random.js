/**
 * Deterministic, seedable PRNG (mulberry32).
 *
 * A single shared instance drives maze generation, spawn placement and effect
 * jitter so a given seed reproduces a round exactly — invaluable for debugging
 * and for keeping AI/physics deterministic within a fixed-timestep loop.
 */
export class Random {
  /** @param {number} [seed] */
  constructor(seed = (Math.random() * 0xffffffff) >>> 0) {
    this._state = seed >>> 0;
  }

  /** @param {number} seed */
  reseed(seed) {
    this._state = seed >>> 0;
    return this;
  }

  /** Next float in [0, 1). */
  next() {
    this._state |= 0;
    this._state = (this._state + 0x6d2b79f5) | 0;
    let t = Math.imul(this._state ^ (this._state >>> 15), 1 | this._state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return Math.floor(this.range(min, max + 1));
  }

  /** @param {number} [p] probability of true */
  bool(p = 0.5) {
    return this.next() < p;
  }

  /** @template T @param {T[]} arr @returns {T} */
  pick(arr) {
    return arr[Math.floor(this.next() * arr.length)];
  }

  /** In-place Fisher–Yates shuffle. @template T @param {T[]} arr */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    return arr;
  }
}

/** Process-wide default RNG; reseed per round for deterministic replays. */
export const rng = new Random();
