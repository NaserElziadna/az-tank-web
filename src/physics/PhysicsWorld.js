import { circleVsAABB, rayVsAABB, rayVsCircle } from './collision/AABB.js';

/**
 * The static collision world: maze walls (axis-aligned rectangles) plus the
 * geometry queries the simulation needs.
 *
 * Responsibilities, all in world metres:
 *  - push a circle (tank) out of walls and report whether it collided;
 *  - raycast against walls (and optionally tank circles) for laser / line-of-sight;
 *  - trace a reflecting "bounce path" used by the AI to aim bank shots and to
 *    predict where projectiles will travel.
 *
 * It is deliberately framework-free and deterministic.
 */
export class PhysicsWorld {
  constructor() {
    /** @type {{minX:number,minY:number,maxX:number,maxY:number}[]} */
    this.walls = [];
    this.width = 0;
    this.height = 0;
    this._mtv = { nx: 0, ny: 0, depth: 0 };
  }

  /** @param {{minX:number,minY:number,maxX:number,maxY:number}[]} walls */
  setWalls(walls, width, height) {
    this.walls = walls;
    this.width = width;
    this.height = height;
  }

  /**
   * Push a circle out of every wall it overlaps (a few relaxation iterations
   * for clean corner behaviour). Mutates `pos`. Returns collision info with the
   * averaged normal, used for tank "stuck" detection.
   * @param {{x:number,y:number}} pos @param {number} radius
   */
  resolveCircle(pos, radius) {
    let collided = false;
    let nx = 0;
    let ny = 0;
    for (let iter = 0; iter < 3; iter++) {
      let any = false;
      for (let i = 0; i < this.walls.length; i++) {
        if (circleVsAABB(pos.x, pos.y, radius, this.walls[i], this._mtv)) {
          pos.x += this._mtv.nx * this._mtv.depth;
          pos.y += this._mtv.ny * this._mtv.depth;
          nx += this._mtv.nx;
          ny += this._mtv.ny;
          any = true;
          collided = true;
        }
      }
      if (!any) break;
    }
    const len = Math.hypot(nx, ny);
    if (len > 1e-6) {
      nx /= len;
      ny /= len;
    }
    return { collided, nx, ny };
  }

  /**
   * Nearest wall hit along a ray, with the projectile radius folded into the
   * walls (Minkowski inflation). Returns the hit distance and surface normal.
   * @returns {{t:number, nx:number, ny:number}|null}
   */
  raycastWalls(ox, oy, dx, dy, maxDist, inflate = 0) {
    let best = null;
    for (let i = 0; i < this.walls.length; i++) {
      const w = this.walls[i];
      const box = inflate
        ? { minX: w.minX - inflate, minY: w.minY - inflate, maxX: w.maxX + inflate, maxY: w.maxY + inflate }
        : w;
      const hit = rayVsAABB(ox, oy, dx, dy, maxDist, box);
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    return best;
  }

  /** Is the straight segment a→b unobstructed by walls? (line-of-sight) */
  lineOfSight(ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6) return true;
    const hit = this.raycastWalls(ax, ay, dx / dist, dy / dist, dist, 0);
    return hit === null;
  }

  /**
   * Trace a ray that reflects off walls up to `maxBounces`, total length capped
   * at `maxLength`. Optionally treats the supplied tank circles as terminal
   * (the ray stops at the first tank hit). This is the AI's "where would my shot
   * go?" and "where will that bullet end up?" predictor.
   *
   * @param {number} ox @param {number} oy @param {number} angle radians
   * @param {object} opts
   * @param {number} [opts.maxBounces]
   * @param {number} [opts.maxLength]
   * @param {number} [opts.radius] projectile radius (wall inflation)
   * @param {Array<{position:{x:number,y:number}, radius:number, id:number}>} [opts.tanks]
   * @param {number} [opts.ignoreTankId] don't terminate on this tank (the firer)
   * @returns {{points:{x:number,y:number}[], hitTank:any, firstSegmentLength:number, length:number}}
   */
  tracePath(ox, oy, angle, opts = {}) {
    const maxBounces = opts.maxBounces ?? 3;
    const maxLength = opts.maxLength ?? 80;
    const radius = opts.radius ?? 0;
    const tanks = opts.tanks ?? null;

    let dx = Math.cos(angle);
    let dy = Math.sin(angle);
    let x = ox;
    let y = oy;
    let remaining = maxLength;
    let total = 0;
    let firstSegmentLength = maxLength;
    const points = [{ x, y }];
    let hitTank = null;

    for (let bounce = 0; bounce <= maxBounces && remaining > 0.001; bounce++) {
      const wallHit = this.raycastWalls(x, y, dx, dy, remaining, radius);
      let segLen = wallHit ? wallHit.t : remaining;

      // Check tanks along this segment (terminal).
      if (tanks) {
        for (const t of tanks) {
          if (t.id === opts.ignoreTankId && bounce === 0) continue;
          const tt = rayVsCircle(x, y, dx, dy, segLen, t.position.x, t.position.y, t.radius);
          if (tt >= 0 && tt < segLen) {
            segLen = tt;
            hitTank = t;
          }
        }
      }

      x += dx * segLen;
      y += dy * segLen;
      total += segLen;
      points.push({ x, y });
      if (bounce === 0) firstSegmentLength = total;

      if (hitTank) break;
      if (!wallHit) break; // ran out of range with no wall

      // Reflect off the wall surface.
      const dot = dx * wallHit.nx + dy * wallHit.ny;
      dx -= 2 * dot * wallHit.nx;
      dy -= 2 * dot * wallHit.ny;
      // Nudge off the surface to avoid re-hitting the same wall.
      x += dx * 1e-3;
      y += dy * 1e-3;
      remaining -= segLen;
    }

    return { points, hitTank, firstSegmentLength, length: total };
  }
}
