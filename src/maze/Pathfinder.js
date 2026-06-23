const SQRT2 = Math.SQRT2;
const DIRS8 = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
];

/**
 * Graph search over a {@link Maze}'s 8-connected navigation grid.
 *
 * Provides Dijkstra shortest paths (optionally threat-weighted, for AI routing
 * that avoids danger) and greedy gradient following (for fleeing along an
 * arbitrary scalar field). Stateless — all maze state is passed in.
 */
export class Pathfinder {
  /**
   * Threat-aware shortest path from start to end tile.
   * @param {import('./Maze.js').Maze} maze
   * @param {{tx:number,ty:number}} start
   * @param {{tx:number,ty:number}} end
   * @param {(tx:number,ty:number)=>number} [weightFn] extra per-tile cost
   * @param {number} [lengthWeight] multiplier on raw path length
   * @returns {{x:number,y:number}[]} tiles from start (exclusive) to end (inclusive)
   */
  static shortestPath(maze, start, end, weightFn = null, lengthWeight = 1) {
    const W = maze.width;
    const H = maze.height;
    const idx = (x, y) => x * H + y;
    const dist = new Float64Array(W * H).fill(Infinity);
    const prev = new Int32Array(W * H).fill(-1);
    const visited = new Uint8Array(W * H);
    const startI = idx(start.tx, start.ty);
    dist[startI] = 0;

    // Small mazes → a simple array-scan priority queue is plenty fast.
    const open = [startI];
    while (open.length) {
      // extract-min
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (visited[cur]) continue;
      visited[cur] = 1;
      const cx = Math.floor(cur / H);
      const cy = cur % H;
      if (cx === end.tx && cy === end.ty) break;

      for (const [dx, dy, len] of DIRS8) {
        if (!maze.canTraverse(cx, cy, dx, dy)) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        const ni = idx(nx, ny);
        if (visited[ni]) continue;
        const extra = weightFn ? weightFn(nx, ny) : 0;
        const nd = dist[cur] + len * lengthWeight + extra;
        if (nd < dist[ni]) {
          dist[ni] = nd;
          prev[ni] = cur;
          open.push(ni);
        }
      }
    }

    const endI = idx(end.tx, end.ty);
    if (dist[endI] === Infinity) return [];
    const path = [];
    let c = endI;
    while (c !== startI && c !== -1) {
      path.push({ x: Math.floor(c / H), y: c % H });
      c = prev[c];
    }
    path.reverse();
    return path;
  }

  /**
   * Greedy 8-connected hill-climb maximising `gradientFn`. Used for fleeing.
   * @param {import('./Maze.js').Maze} maze
   * @param {{tx:number,ty:number}} start
   * @param {number} maxLength
   * @param {(tx:number,ty:number)=>number} gradientFn
   * @returns {{x:number,y:number}[]}
   */
  static gradientPath(maze, start, maxLength, gradientFn) {
    const path = [];
    let cx = start.tx;
    let cy = start.ty;
    const visited = new Set([cx * maze.height + cy]);
    for (let step = 0; step < maxLength; step++) {
      let bestVal = gradientFn(cx, cy);
      let bx = -1;
      let by = -1;
      for (const [dx, dy] of DIRS8) {
        if (!maze.canTraverse(cx, cy, dx, dy)) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (visited.has(nx * maze.height + ny)) continue;
        const v = gradientFn(nx, ny);
        if (v > bestVal) {
          bestVal = v;
          bx = nx;
          by = ny;
        }
      }
      if (bx < 0) break;
      cx = bx;
      cy = by;
      visited.add(cx * maze.height + cy);
      path.push({ x: cx, y: cy });
    }
    return path;
  }
}
