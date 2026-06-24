import { el } from '../ui/dom.js';

/**
 * On-screen touch controls for one human tank: a left analog thumb-stick and a
 * right fire button, rendered as a DOM overlay above the canvas. Produces the
 * same {@link import('../core/input/ControlScheme.js').ControlIntent} shape the
 * tanks consume, so it merges cleanly with the keyboard controller.
 *
 * The stick maps push-up → forward, pull-down → reverse (above a dead-zone) and
 * tilt left/right → analog turn, matching the arrow-key feel. Pointer events are
 * used (covering touch + mouse) so it also works for desktop testing.
 */
export class TouchControls {
  /** @param {HTMLElement} parent element to overlay (the game stage) */
  constructor(parent) {
    this.drive = 0;
    this.turn = 0;
    this.fire = false;
    this._stickId = null;
    this._radius = 56; // px throw of the stick
    this._build(parent);
  }

  _build(parent) {
    this.knob = el('div.touch__knob');
    this.stick = el('div.touch__stick', {}, [this.knob]);
    this.fireBtn = el('div.touch__fire', { text: 'FIRE' });
    this.root = el('div.touch', {}, [this.stick, this.fireBtn]);
    parent.appendChild(this.root);

    // ── stick ──
    this.stick.addEventListener('pointerdown', (e) => this._stickStart(e));
    this.stick.addEventListener('pointermove', (e) => this._stickMove(e));
    const end = (e) => this._stickEnd(e);
    this.stick.addEventListener('pointerup', end);
    this.stick.addEventListener('pointercancel', end);
    this.stick.addEventListener('lostpointercapture', end);

    // ── fire button ──
    const down = (e) => {
      e.preventDefault();
      this.fire = true;
      this.fireBtn.classList.add('is-active');
    };
    const up = () => {
      this.fire = false;
      this.fireBtn.classList.remove('is-active');
    };
    this.fireBtn.addEventListener('pointerdown', down);
    this.fireBtn.addEventListener('pointerup', up);
    this.fireBtn.addEventListener('pointercancel', up);
    this.fireBtn.addEventListener('pointerleave', up);
    this._fireUp = up;
  }

  _stickStart(e) {
    e.preventDefault();
    this._stickId = e.pointerId;
    try {
      this.stick.setPointerCapture(e.pointerId);
    } catch (err) {
      /* capture unsupported (e.g. synthetic events) — move still tracks */
    }
    this._stickMove(e);
  }

  _stickMove(e) {
    if (this._stickId !== e.pointerId) return;
    const r = this.stick.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    const len = Math.hypot(dx, dy);
    const max = this._radius;
    if (len > max) {
      dx = (dx / len) * max;
      dy = (dy / len) * max;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this.turn = clamp(dx / max, -1, 1);
    const fwd = -dy / max; // up is forward
    this.drive = fwd > 0.4 ? 1 : fwd < -0.4 ? -1 : 0;
  }

  _stickEnd(e) {
    if (this._stickId !== e.pointerId && e.pointerId !== undefined) return;
    this._stickId = null;
    this.drive = 0;
    this.turn = 0;
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  /** @returns {import('../core/input/ControlScheme.js').ControlIntent} */
  read() {
    return { drive: this.drive, turn: this.turn, fire: this.fire, firePressed: false };
  }

  /** True if the stick or fire button is currently engaged. */
  get active() {
    return this.drive !== 0 || this.turn !== 0 || this.fire;
  }

  dispose() {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Whether on-screen controls should be shown — only on genuine mobile/tablet
 * screens, NOT on desktops (including touchscreen laptops, which also have a
 * mouse). The test: a coarse primary pointer AND no hover capability (a mouse
 * provides hover, so touchscreen laptops are excluded), with a mobile user-agent
 * fallback for older browsers. `?touch=1`/`?touch=0` force it on/off for testing.
 */
export function isTouchDevice() {
  try {
    if (typeof location !== 'undefined') {
      if (/[?&]touch=1\b/.test(location.search)) return true;
      if (/[?&]touch=0\b/.test(location.search)) return false;
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const noHover = window.matchMedia('(hover: none)').matches;
      if (coarse && noHover) return true;
    }
    if (typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|IEMobile|BlackBerry|Opera Mini|Mobile/i.test(navigator.userAgent)) {
      return true;
    }
  } catch (e) {
    /* ignore */
  }
  return false;
}
