/**
 * @template C context object passed to every state callback
 * @typedef {object} State
 * @property {string} name
 * @property {(ctx: C, from: string|null) => void} [enter]
 * @property {(ctx: C, dt: number) => (string|void)} [update] return a state name to transition
 * @property {(ctx: C, to: string) => void} [exit]
 */

/**
 * A tiny finite-state machine (State pattern).
 *
 * Shared by the round lifecycle (countdown → playing → ending) and AI behaviour
 * (patrol → hunt → attack → evade). A state's `update` may return the name of
 * the next state to transition immediately; `enter`/`exit` hooks fire on change.
 *
 * @template C
 */
export class StateMachine {
  /** @param {C} context */
  constructor(context) {
    this.context = context;
    /** @type {Map<string, State<C>>} */
    this._states = new Map();
    /** @type {State<C>|null} */
    this._current = null;
    this.timeInState = 0;
  }

  /** @param {State<C>} state */
  add(state) {
    this._states.set(state.name, state);
    return this;
  }

  get currentName() {
    return this._current?.name ?? null;
  }

  /** @param {string} name */
  transition(name) {
    if (this._current?.name === name) return;
    const from = this._current?.name ?? null;
    this._current?.exit?.(this.context, name);
    const next = this._states.get(name);
    if (!next) throw new Error(`StateMachine: unknown state "${name}"`);
    this._current = next;
    this.timeInState = 0;
    next.enter?.(this.context, from);
  }

  /** @param {number} dt */
  update(dt) {
    if (!this._current) return;
    this.timeInState += dt;
    const next = this._current.update?.(this.context, dt);
    if (next && next !== this._current.name) this.transition(next);
  }
}
