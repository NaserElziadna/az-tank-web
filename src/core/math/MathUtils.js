/** Misc scalar math helpers shared across engine and gameplay. */

export const TAU = Math.PI * 2;

/** @param {number} v @param {number} min @param {number} max */
export function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

/** @param {number} a @param {number} b @param {number} t */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Wrap an angle to (-PI, PI]. @param {number} a */
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/**
 * Smallest signed delta to rotate from `from` to `to` (radians), in (-PI, PI].
 * @param {number} from @param {number} to
 */
export function angleDelta(from, to) {
  return wrapAngle(to - from);
}

/**
 * Rotate `current` toward `target` by at most `maxStep` radians.
 * @param {number} current @param {number} target @param {number} maxStep
 */
export function rotateTowards(current, target, maxStep) {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

/** @param {number} a @param {number} b @param {number} t */
export function moveTowards(a, b, maxStep) {
  const d = b - a;
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

/** @param {number} deg */
export function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

export function approxEqual(a, b, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}
