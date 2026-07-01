import { el } from '../ui/dom.js';

/**
 * On-screen touch controls for one human tank: a FLOATING left thumb-stick plus
 * right-hand fire/power buttons, as a DOM overlay above the canvas. Produces the
 * same {@link import('../core/input/ControlScheme.js').ControlIntent} the tanks
 * consume, so it merges cleanly with the keyboard controller.
 *
 * Floating stick: touch anywhere in the left zone and the stick appears under
 * your finger (no hunting for a fixed knob). Control is direct tank-drive —
 * push up/down = forward/reverse, left/right = rotate — which is immediate and
 * precise in a maze (no "turn toward a point then drive" lag). Pointer events
 * cover touch + mouse.
 */
const STICK_DEAD = 0.18; // radial dead zone (whole-vector magnitude, 0..1)
const DRIVE_THRESH = 0.32; // vertical push needed to move (tank-drive fallback only)
const TURN_EASE = 0.35; // heading error (rad) for full-rate turn; eases below it
const DRIVE_ARC = 1.95; // drive forward while the target is within ~112° of facing
const RADIUS = 60; // px throw of the stick

/** A distinct icon per ability kind (shown only while the tank holds one). */
const ABILITY_ICON = { megaLaser: '💥', rapidFire: '⚡', phase: '👻', recon: '🎯' };

export class TouchControls {
  /** @param {HTMLElement} parent element to overlay (the game stage) */
  constructor(parent) {
    this.drive = 0;
    this.turn = 0;
    this.fire = false;
    this._abilityPressed = false; // edge, consumed on read()
    this._stickId = null;
    this._ox = 0; // stick origin (touch-down point), viewport px
    this._oy = 0;
    this._vx = 0; // normalized offset −1..1
    this._vy = 0;
    this._mag = 0;
    this._build(parent);
  }

  _build(parent) {
    this.zone = el('div.touch__zone'); // invisible left-half capture area
    this.knob = el('div.touch__knob');
    this.stick = el('div.touch__stick', {}, [this.knob]); // floating; hidden until touched
    this.fireBtn = el('div.touch__fire', { text: 'FIRE' });
    this.abilityBtn = el('div.touch__ability', { text: '' });
    this.root = el('div.touch', {}, [this.zone, this.stick, this.fireBtn, this.abilityBtn]);
    parent.appendChild(this.root);
    this.setAbility(null); // hidden until the tank actually holds an ability

    // ── floating stick (touch anywhere in the left zone) ──
    this.zone.addEventListener('pointerdown', (e) => this._stickStart(e));
    this.zone.addEventListener('pointermove', (e) => this._stickMove(e));
    const end = (e) => this._stickEnd(e);
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
    this.zone.addEventListener('lostpointercapture', end);

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
    if (this._stickId !== null) return;
    e.preventDefault();
    this._stickId = e.pointerId;
    this._ox = e.clientX;
    this._oy = e.clientY;
    // Place the floating base under the finger and reveal it.
    this.stick.style.left = `${e.clientX - RADIUS}px`;
    this.stick.style.top = `${e.clientY - RADIUS}px`;
    this.stick.classList.add('is-active');
    this.knob.style.transform = 'translate(0px, 0px)';
    try {
      this.zone.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported — move still tracks */
    }
  }

  _stickMove(e) {
    if (this._stickId !== e.pointerId) return;
    let dx = e.clientX - this._ox;
    let dy = e.clientY - this._oy;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
    this._vx = clamp(dx / RADIUS, -1, 1);
    this._vy = clamp(dy / RADIUS, -1, 1);
    this._mag = Math.min(1, Math.hypot(this._vx, this._vy));
  }

  _stickEnd(e) {
    if (this._stickId !== e.pointerId && e.pointerId !== undefined) return;
    this._stickId = null;
    this._vx = this._vy = this._mag = 0;
    this.drive = this.turn = 0;
    this.stick.classList.remove('is-active');
    this.knob.style.transform = 'translate(0px, 0px)';
  }

  /**
   * Heading-based steering: the stick's angle is a TARGET heading; the tank
   * rotates toward it at its capped rate AND drives forward in the same frame
   * (no "turn-then-drive" lag), whenever the target is within a wide arc of the
   * current facing. One clean target angle is derived from the whole stick vector
   * with atan2 (not per-axis), which avoids diagonal cardinal-snapping. The tank
   * angle convention matches the sim: rot 0 = +x, +y = down, same as screen.
   *
   * If no rotation is supplied, falls back to arcade tank-drive.
   * @param {number} [currentRot] the tank's current heading (radians)
   * @returns {import('../core/input/ControlScheme.js').ControlIntent}
   */
  read(currentRot) {
    const abilityPressed = this._abilityPressed;
    this._abilityPressed = false; // consume the edge
    let drive = 0;
    let turn = 0;
    if (this._mag >= STICK_DEAD) {
      if (Number.isFinite(currentRot)) {
        const desired = Math.atan2(this._vy, this._vx);
        const err = shortAngle(desired - currentRot);
        turn = clamp(err / TURN_EASE, -1, 1);
        drive = Math.abs(err) < DRIVE_ARC ? 1 : 0; // turn + drive together
      } else {
        turn = clamp(this._vx * 1.3, -1, 1);
        const fwd = -this._vy; // screen y is down; up = forward
        drive = fwd > DRIVE_THRESH ? 1 : fwd < -DRIVE_THRESH ? -1 : 0;
      }
    }
    this.drive = drive;
    this.turn = turn;
    return { drive, turn, fire: this.fire, firePressed: false, abilityPressed };
  }

  /**
   * Show the POWER button only while the tank holds an ability, with an icon
   * unique to that ability kind. Called each frame with the local tank's ability
   * (a kind string, or null when it has none).
   * @param {string|null} kind
   */
  setAbility(kind) {
    if (!this.abilityBtn) return;
    if (kind) {
      this.abilityBtn.textContent = ABILITY_ICON[kind] || '◆';
      this.abilityBtn.title = kind;
      this.abilityBtn.style.display = '';
    } else {
      this.abilityBtn.style.display = 'none';
    }
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
 * screens, NOT desktops (including touchscreen laptops, which also have a mouse).
 * The test: a coarse primary pointer AND no hover, with a mobile UA fallback.
 * `?touch=1`/`?touch=0` force it on/off for testing.
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
