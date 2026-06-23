import { Vector2 } from '../../core/math/Vector2.js';

/**
 * Stateless 2D geometry helpers used by the physics world.
 *
 * Walls are modelled as thick line segments (capsules): a centre segment plus a
 * radius. Tanks and projectiles are circles. These routines provide the closest
 * point, circle/capsule overlap resolution, and ray/segment intersection used
 * for collision response, bullet bouncing and AI line-of-sight.
 */

/**
 * Closest point on segment AB to point P, written into `out`.
 * @param {number} px @param {number} py
 * @param {number} ax @param {number} ay
 * @param {number} bx @param {number} by
 * @param {Vector2} out
 * @returns {number} the parameter t in [0,1] along AB
 */
export function closestPointOnSegment(px, py, ax, ay, bx, by, out) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = lenSq > 1e-12 ? ((px - ax) * abx + (py - ay) * aby) / lenSq : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  out.x = ax + abx * t;
  out.y = ay + aby * t;
  return t;
}

/**
 * Resolve a circle vs a capsule (thick segment). If overlapping, returns the
 * minimum-translation data needed to push the circle out.
 *
 * @param {number} cx @param {number} cy @param {number} radius circle
 * @param {{ax:number, ay:number, bx:number, by:number, radius:number}} seg capsule
 * @param {{nx:number, ny:number, depth:number}} out collision normal + penetration depth
 * @returns {boolean} true if overlapping
 */
const _cp = new Vector2();
export function circleVsCapsule(cx, cy, radius, seg, out) {
  closestPointOnSegment(cx, cy, seg.ax, seg.ay, seg.bx, seg.by, _cp);
  let dx = cx - _cp.x;
  let dy = cy - _cp.y;
  const combined = radius + seg.radius;
  const distSq = dx * dx + dy * dy;
  if (distSq >= combined * combined) return false;

  let dist = Math.sqrt(distSq);
  if (dist < 1e-9) {
    // Centre lies on the segment — push along the segment normal.
    const sx = seg.bx - seg.ax;
    const sy = seg.by - seg.ay;
    const slen = Math.hypot(sx, sy) || 1;
    dx = -sy / slen;
    dy = sx / slen;
    dist = 0;
  } else {
    dx /= dist;
    dy /= dist;
  }
  out.nx = dx;
  out.ny = dy;
  out.depth = combined - dist;
  return true;
}

/**
 * Ray (origin + dir, dir need not be normalized) vs segment AB.
 * @returns {number} t along the ray in [0, maxT] of the hit, or -1 if none.
 */
export function rayVsSegment(ox, oy, dx, dy, ax, ay, bx, by, maxT = Infinity) {
  const ex = bx - ax;
  const ey = by - ay;
  const denom = dx * ey - dy * ex;
  if (Math.abs(denom) < 1e-12) return -1; // parallel
  const fx = ax - ox;
  const fy = ay - oy;
  const t = (fx * ey - fy * ex) / denom; // along ray
  const u = (fx * dy - fy * dx) / denom; // along segment
  if (t < 0 || t > maxT) return -1;
  if (u < 0 || u > 1) return -1;
  return t;
}

/**
 * Reflect velocity (vx, vy) about a surface with unit normal (nx, ny).
 * @param {{x:number,y:number}} out
 */
export function reflect(vx, vy, nx, ny, out) {
  const d = 2 * (vx * nx + vy * ny);
  out.x = vx - d * nx;
  out.y = vy - d * ny;
  return out;
}
