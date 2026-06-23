import jkstraNs from 'jkstra';

// jkstra ships as CommonJS; normalise the default/namespace interop.
const jkstra = jkstraNs && jkstraNs.Graph ? jkstraNs : jkstraNs.default || jkstraNs;

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
 * Navigation graph over a {@link Maze}, backed by the **jkstra** library (the
 * same Dijkstra implementation the original game uses). Builds one vertex per
 * passable tile and 8-connected edges (orthogonal cost 1, diagonal √2, with
 * corner-clip gating), then answers threat-weighted shortest-path queries used
 * by the AI and homing missiles.
 */
export class MazeGraph {
  /** @param {import('./Maze.js').Maze} maze */
  constructor(maze) {
    this.maze = maze;
    this.graph = new jkstra.Graph();
    /** @type {Map<number, any>} tileIndex -> jkstra vertex */
    this._vById = new Map();

    for (let x = 0; x < maze.width; x++) {
      for (let y = 0; y < maze.height; y++) {
        if (maze.present(x, y)) this._vById.set(this._idx(x, y), this.graph.addVertex({ x, y }));
      }
    }
    for (let x = 0; x < maze.width; x++) {
      for (let y = 0; y < maze.height; y++) {
        if (!maze.present(x, y)) continue;
        const from = this._vById.get(this._idx(x, y));
        for (const [dx, dy, len] of DIRS8) {
          if (!maze.canTraverse(x, y, dx, dy)) continue;
          const to = this._vById.get(this._idx(x + dx, y + dy));
          if (to) this.graph.addEdge(from, to, { x: x + dx, y: y + dy, len });
        }
      }
    }
    this._dijkstra = new jkstra.algos.Dijkstra(this.graph);
  }

  _idx(x, y) {
    return x * this.maze.height + y;
  }

  /**
   * Threat-weighted shortest path of tiles from start to end (exclusive→inclusive).
   * @param {{tx:number,ty:number}} start @param {{tx:number,ty:number}} end
   * @param {(tx:number,ty:number)=>number} [weightFn] extra per-tile cost
   * @returns {{x:number,y:number}[]}
   */
  shortestPath(start, end, weightFn = null) {
    const from = this._vById.get(this._idx(start.tx, start.ty));
    const to = this._vById.get(this._idx(end.tx, end.ty));
    if (!from || !to) return [];
    const edges = this._dijkstra.shortestPath(from, to, {
      edgeCost: (e) => e.data.len + (weightFn ? weightFn(e.data.x, e.data.y) : 0),
    });
    if (!edges || edges.length === 0) return [];
    return edges.map((e) => ({ x: e.data.x, y: e.data.y }));
  }
}
