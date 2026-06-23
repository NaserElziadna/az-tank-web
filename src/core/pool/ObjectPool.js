/**
 * Generic object pool (Object Pool pattern).
 *
 * Projectiles and particles churn rapidly; recycling instances avoids per-frame
 * allocation and the resulting GC stutter. Callers `acquire()`, use the object,
 * then `release()` it; `reset` returns it to a clean state for reuse.
 *
 * @template T
 */
export class ObjectPool {
  /**
   * @param {() => T} factory creates a fresh instance when the pool is empty
   * @param {(obj: T) => void} [reset] clears state on release
   * @param {number} [prefill] number to allocate up front
   */
  constructor(factory, reset = () => {}, prefill = 0) {
    this._factory = factory;
    this._reset = reset;
    /** @type {T[]} */
    this._free = [];
    this._created = 0;
    for (let i = 0; i < prefill; i++) {
      this._created++;
      this._free.push(factory());
    }
  }

  /** @returns {T} */
  acquire() {
    const obj = this._free.pop();
    if (obj) return obj;
    this._created++;
    return this._factory();
  }

  /** @param {T} obj */
  release(obj) {
    this._reset(obj);
    this._free.push(obj);
  }

  get size() {
    return this._created;
  }

  get available() {
    return this._free.length;
  }
}
