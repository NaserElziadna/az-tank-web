/**
 * Axis-aligned bounding-box collision helpers.
 *
 * Every maze wall is an axis-aligned rectangle (a merged run of collinear wall
 * segments), so AABB tests give exact, tunnel-free collision for both the tank
 * (a circle pushed out of walls) and projectiles (a ray swept against walls
 * inflated by the projectile radius — Minkowski sum).
 */

/**
 * Resolve a circle against one AABB. If overlapping, writes the minimum
 * translation (normal + depth) into `out` and returns true.
 * @param {number} cx @param {number} cy @param {number} r
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} box
 * @param {{nx:number, ny:number, depth:number}} out
 */
export function circleVsAABB(cx, cy, r, box, out) {
  // Closest point on the box to the circle centre.
  const qx = cx < box.minX ? box.minX : cx > box.maxX ? box.maxX : cx;
  const qy = cy < box.minY ? box.minY : cy > box.maxY ? box.maxY : cy;
  let dx = cx - qx;
  let dy = cy - qy;
  let distSq = dx * dx + dy * dy;

  if (distSq > r * r) return false;

  if (distSq > 1e-12) {
    const dist = Math.sqrt(distSq);
    out.nx = dx / dist;
    out.ny = dy / dist;
    out.depth = r - dist;
  } else {
    // Centre is inside the box — push out along the least-penetrating axis.
    const left = cx - box.minX;
    const right = box.maxX - cx;
    const top = cy - box.minY;
    const bottom = box.maxY - cy;
    const minPen = Math.min(left, right, top, bottom);
    if (minPen === left) {
      out.nx = -1; out.ny = 0; out.depth = left + r;
    } else if (minPen === right) {
      out.nx = 1; out.ny = 0; out.depth = right + r;
    } else if (minPen === top) {
      out.nx = 0; out.ny = -1; out.depth = top + r;
    } else {
      out.nx = 0; out.ny = 1; out.depth = bottom + r;
    }
  }
  return true;
}

/**
 * Ray vs AABB (slab method). The ray starts at (ox,oy) with normalized
 * direction (dx,dy) and length maxDist. Returns the hit distance `t` and the
 * surface normal, or null if no hit in range.
 * @returns {{t:number, nx:number, ny:number}|null}
 */
export function rayVsAABB(ox, oy, dx, dy, maxDist, box) {
  let tmin = 0;
  let tmax = maxDist;
  let nx = 0;
  let ny = 0;

  // X slab
  if (Math.abs(dx) < 1e-12) {
    if (ox < box.minX || ox > box.maxX) return null;
  } else {
    const inv = 1 / dx;
    let t1 = (box.minX - ox) * inv;
    let t2 = (box.maxX - ox) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1; t1 = t2; t2 = tmp;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = sign;
      ny = 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  // Y slab
  if (Math.abs(dy) < 1e-12) {
    if (oy < box.minY || oy > box.maxY) return null;
  } else {
    const inv = 1 / dy;
    let t1 = (box.minY - oy) * inv;
    let t2 = (box.maxY - oy) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1; t1 = t2; t2 = tmp;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = 0;
      ny = sign;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }

  if (tmin < 0 || tmin > maxDist) return null;
  return { t: tmin, nx, ny };
}

/**
 * Ray vs circle (used for line-of-sight / aiming against tanks).
 * @returns {number} hit distance t in [0,maxDist] or -1.
 */
export function rayVsCircle(ox, oy, dx, dy, maxDist, cx, cy, r) {
  const ex = cx - ox;
  const ey = cy - oy;
  const b = ex * dx + ey * dy; // projection of centre onto ray
  const c = ex * ex + ey * ey - r * r;
  if (c > 0 && b < 0) return -1; // origin outside and circle behind
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = b - Math.sqrt(disc);
  if (t < 0 || t > maxDist) return -1;
  return t;
}
