/**
 * Centralised keyboard state tracker.
 *
 * Listens once at the document level and exposes both polled state (`isDown`)
 * and edge detection (`wasPressed`) so per-frame consumers can ask "is forward
 * held?" while one-shot actions (fire) read a fresh press. Several tanks share
 * one InputManager; each reads its own keys via a {@link ControlScheme}.
 */
export class InputManager {
  constructor(target = window) {
    /** @type {Set<string>} currently held key codes */
    this._down = new Set();
    /** @type {Set<string>} pressed since last consume */
    this._pressed = new Set();
    this._target = target;
    this._enabled = true;

    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onBlur = this._onBlur.bind(this);
  }

  attach() {
    this._target.addEventListener('keydown', this._onKeyDown);
    this._target.addEventListener('keyup', this._onKeyUp);
    this._target.addEventListener('blur', this._onBlur);
  }

  detach() {
    this._target.removeEventListener('keydown', this._onKeyDown);
    this._target.removeEventListener('keyup', this._onKeyUp);
    this._target.removeEventListener('blur', this._onBlur);
  }

  set enabled(v) {
    this._enabled = v;
    if (!v) this.reset();
  }

  /** @param {KeyboardEvent} e */
  _onKeyDown(e) {
    if (!this._enabled) return;
    // Stop arrows / space from scrolling the page during play.
    if (PREVENT_DEFAULT.has(e.code)) e.preventDefault();
    if (!this._down.has(e.code)) this._pressed.add(e.code);
    this._down.add(e.code);
  }

  /** @param {KeyboardEvent} e */
  _onKeyUp(e) {
    this._down.delete(e.code);
  }

  _onBlur() {
    this.reset();
  }

  /** @param {string} code KeyboardEvent.code */
  isDown(code) {
    return this._down.has(code);
  }

  /** Was the key first pressed since the last {@link clearPressed}? */
  wasPressed(code) {
    return this._pressed.has(code);
  }

  /** Call at the end of each simulation step to reset edge detection. */
  clearPressed() {
    this._pressed.clear();
  }

  reset() {
    this._down.clear();
    this._pressed.clear();
  }
}

const PREVENT_DEFAULT = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
]);
