import { el } from '../ui/dom.js';

/**
 * On-screen touch controls for one human tank: a left analog thumb-stick and a
 * right fire button, rendered as a DOM overlay above the canvas. Produces the
 * same {@link import('../core/input/ControlScheme.js').ControlIntent} shape the
 * tanks consume, so it merges cleanly with the keyboard controller.
 *
 * Steering is "point where you want to go": the stick direction is the tank's
 * desired heading. {@link read} is given the tank's current rotation and turns
 * it toward the stick while driving forward — far more intuitive on a top-down
 * tank than tilt-to-rotate. If no rotation is supplied it falls back to the old
 * tank-drive mapping (up → forward, tilt → turn). Pointer events cover touch +
 * mouse, so it also works for desktop testing.
 */
const STICK_DEAD = 0.22; // ignore tiny stick offsets (normalized 0..1)
const TURN_EASE = 0.38; // rad of heading error for full-speed turn; eases below it
const DRIVE_ARC = 2.0; // drive forward while the target is within ~115° of facing

export class TouchControls {
  /** @param {HTMLElement} parent element to overlay (the game stage) */
  constructor(parent) {
    this.drive = 0;
    this.turn = 0;
    this.fire = false;
    this._abilityPressed = false; // edge, consumed on read()
    this._stickId = null;
    this._radius = 56; // px throw of the stick
    this._vx = 0; // normalized stick offset (−1..1), +x right
    this._vy = 0; // normalized stick offset (−1..1), +y down
    this._mag = 0; // normalized stick magnitude (0..1)
    this._build(parent);
  }

  _build(parent) {
    this.knob = el('div.touch__knob');
    this.stick = el('div.touch__stick', {}, [this.knob]);
    this.fireBtn = el('div.touch__fire', { text: 'FIRE' });
    this.abilityBtn = el('div.touch__ability', { text: 'POWER' });
    this.root = el('div.touch', {}, [this.stick, this.fireBtn, this.abilityBtn]);
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

    // ── ability button (edge-triggered: one activation per tap) ──
    this.abilityBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._abilityPressed = true;
      this.abilityBtn.classList.add('is-active');
    });
    const aUp = () => this.abilityBtn.classList.remove('is-active');
    this.abilityBtn.addEventListener('pointerup', aUp);
    this.abilityBtn.addEventListener('pointercancel', aUp);
    this.abilityBtn.addEventListener('pointerleave', aUp);
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
    this._vx = clamp(dx / max, -1, 1);
    this._vy = clamp(dy / max, -1, 1);
    this._mag = Math.min(1, Math.hypot(this._vx, this._vy));
  }

  _stickEnd(e) {
    if (this._stickId !== e.pointerId && e.pointerId !== undefined) return;
    this._stickId = null;
    this._vx = 0;
    this._vy = 0;
    this._mag = 0;
    this.drive = 0;
    this.turn = 0;
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  /**
   * @param {number} [currentRot] tank's current world heading (radians). When
   *   given, the stick steers toward the pushed direction; otherwise falls back
   *   to tank-drive (up → forward, tilt → turn).
   * @returns {import('../core/input/ControlScheme.js').ControlIntent}
   */
  read(currentRot) {
    const abilityPressed = this._abilityPressed;
    this._abilityPressed = false; // consume the edge
    let drive = 0;
    let turn = 0;
    if (this._mag >= STICK_DEAD) {
      if (Number.isFinite(currentRot)) {
        // Heading-based: rotate toward where the stick points, drive once roughly facing it.
        const desired = Math.atan2(this._vy, this._vx);
        const err = shortAngle(desired - currentRot);
        turn = clamp(err / TURN_EASE, -1, 1);
        drive = Math.abs(err) < DRIVE_ARC ? 1 : 0;
      } else {
        // Fallback tank-drive: tilt turns, push up/down throttles.
        turn = this._vx;
        const fwd = -this._vy;
        drive = fwd > 0.4 ? 1 : fwd < -0.4 ? -1 : 0;
      }
    }
    this.drive = drive;
    this.turn = turn;
    return { drive, turn, fire: this.fire, firePressed: false, abilityPressed };
  }

  /** True if the stick or fire button is currently engaged. */
  get active() {
    return this._mag >= STICK_DEAD || this.fire || this._abilityPressed;
  }

  dispose() {
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Wrap an angle to (−π, π] so heading errors take the shortest way around. */
function shortAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
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
