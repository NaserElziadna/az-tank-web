/**
 * Minimal synchronous publish/subscribe bus (Observer pattern).
 *
 * Used to decouple gameplay producers (a tank died, a crate was picked up) from
 * consumers (HUD, audio, score service) so systems never reach into each other.
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to an event.
   * @param {string} type
   * @param {(payload?: any) => void} handler
   * @returns {() => void} unsubscribe
   */
  on(type, handler) {
    let set = this._listeners.get(type);
    if (!set) {
      set = new Set();
      this._listeners.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  /** Subscribe for a single emission. */
  once(type, handler) {
    const off = this.on(type, (payload) => {
      off();
      handler(payload);
    });
    return off;
  }

  /** @param {string} type @param {Function} handler */
  off(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }

  /** @param {string} type @param {any} [payload] */
  emit(type, payload) {
    const set = this._listeners.get(type);
    if (!set) return;
    // Iterate a copy so handlers may unsubscribe/emit during dispatch.
    for (const handler of [...set]) handler(payload);
  }

  clear() {
    this._listeners.clear();
  }
}
