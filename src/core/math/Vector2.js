/**
 * A 2D vector.
 *
 * Mutating methods (e.g. {@link Vector2#add}) modify and return `this` for
 * allocation-free hot paths; static helpers return fresh instances. Keeping both
 * styles lets the physics/render loops avoid GC pressure without giving up ergonomics.
 */
export class Vector2 {
  /** @param {number} [x] @param {number} [y] */
  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  /** @param {number} x @param {number} y */
  set(x, y) {
    this.x = x;
    this.y = y;
    return this;
  }

  /** @param {Vector2} v */
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  clone() {
    return new Vector2(this.x, this.y);
  }

  /** @param {Vector2} v */
  add(v) {
    this.x += v.x;
    this.y += v.y;
    return this;
  }

  /** @param {Vector2} v @param {number} s */
  addScaled(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    return this;
  }

  /** @param {Vector2} v */
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    return this;
  }

  /** @param {number} s */
  scale(s) {
    this.x *= s;
    this.y *= s;
    return this;
  }

  /** @param {Vector2} v */
  dot(v) {
    return this.x * v.x + this.y * v.y;
  }

  /** Z-component of the 3D cross product. @param {Vector2} v */
  cross(v) {
    return this.x * v.y - this.y * v.x;
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y;
  }

  length() {
    return Math.hypot(this.x, this.y);
  }

  /** @param {Vector2} v */
  distanceToSq(v) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  /** @param {Vector2} v */
  distanceTo(v) {
    return Math.hypot(this.x - v.x, this.y - v.y);
  }

  normalize() {
    const len = this.length();
    if (len > 1e-9) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }

  /** Rotate in place by `radians`. */
  rotate(radians) {
    const c = Math.cos(radians);
    const s = Math.sin(radians);
    const x = this.x * c - this.y * s;
    const y = this.x * s + this.y * c;
    this.x = x;
    this.y = y;
    return this;
  }

  /** Perpendicular (90° CCW) in place. */
  perp() {
    const x = this.x;
    this.x = -this.y;
    this.y = x;
    return this;
  }

  angle() {
    return Math.atan2(this.y, this.x);
  }

  /** Linearly interpolate toward `v` by `t` in [0,1]. @param {Vector2} v @param {number} t */
  lerp(v, t) {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    return this;
  }

  /** @param {Vector2} a @param {Vector2} b */
  static add(a, b) {
    return new Vector2(a.x + b.x, a.y + b.y);
  }

  /** @param {Vector2} a @param {Vector2} b */
  static sub(a, b) {
    return new Vector2(a.x - b.x, a.y - b.y);
  }

  /** @param {number} radians */
  static fromAngle(radians, length = 1) {
    return new Vector2(Math.cos(radians) * length, Math.sin(radians) * length);
  }
}
