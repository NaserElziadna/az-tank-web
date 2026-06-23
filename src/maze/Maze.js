import { C } from '../constants/GameConstants.js';

const TILE = C.MAZE.TILE_SIZE;
const WALL = C.MAZE.WALL_WIDTH;
const SQRT2 = Math.SQRT2;

/**
 * A generated maze plus everything derived from it.
 *
 * Storage follows the classic "two edges per cell" scheme: `tiles[x][y] =
 * [floorPresent, topWall, leftWall]`. From that this class derives:
 *  - merged axis-aligned wall rectangles (collision + rendering),
 *  - an 8-connected navigation graph with corner-clip gating,
 *  - all-pairs orthogonal BFS distances,
 *  - a dead-end penalty field (discourages the AI from fleeing into traps),
 *  - validated, well-spaced tank spawn points.
 *
 * Coordinates: tile centre of (tx,ty) is ((tx+0.5)·TILE, (ty+0.5)·TILE) metres.
 */
export class Maze {
  /** @param {number[][][]} tiles */
  constructor(tiles) {
    this.tiles = tiles;
    this.width = tiles.length;
    this.height = tiles[0].length;

    /** @type {{minX:number,minY:number,maxX:number,maxY:number,horizontal:boolean}[]} */
    this.walls = [];
    /** @type {{x:number,y:number,rotation:number}[]} populated by the generator */
    this.tankSpawns = [];

    this._buildWalls();
    this._buildDistances();
    this._buildDeadEndPenalties();
  }

  get worldWidth() {
    return this.width * TILE;
  }

  get worldHeight() {
    return this.height * TILE;
  }

  // ── geometry ────────────────────────────────────────────────────────────
  tileCenter(tx, ty) {
    return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
  }

  worldToTile(x, y) {
    return { tx: Math.floor(x / TILE), ty: Math.floor(y / TILE) };
  }

  inBounds(tx, ty) {
    return tx >= 0 && ty >= 0 && tx < this.width && ty < this.height;
  }

  present(tx, ty) {
    return this.inBounds(tx, ty) && this.tiles[tx][ty][0] === 1;
  }

  /** Can a body move from tile (tx,ty) to the orthogonally-adjacent tile in (dx,dy)? */
  isOpen(tx, ty, dx, dy) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (!this.present(nx, ny)) return false;
    if (dx === 1) return this.tiles[nx][ny][2] === 0; // right: target's left wall
    if (dx === -1) return this.tiles[tx][ty][2] === 0; // left: own left wall
    if (dy === 1) return this.tiles[tx][ny][1] === 0; // down: target's top wall
    if (dy === -1) return this.tiles[tx][ty][1] === 0; // up: own top wall
    return false;
  }

  /** 8-connected passability with corner-clip gating for diagonals. */
  canTraverse(tx, ty, dx, dy) {
    if (dx === 0 || dy === 0) return this.isOpen(tx, ty, dx, dy);
    // Diagonal: both orthogonal legs must be open via either L-shaped route.
    const horizFirst = this.isOpen(tx, ty, dx, 0) && this.isOpen(tx + dx, ty, 0, dy);
    const vertFirst = this.isOpen(tx, ty, 0, dy) && this.isOpen(tx, ty + dy, dx, 0);
    return horizFirst && vertFirst;
  }

  // ── walls → merged axis-aligned rectangles ────────────────────────────────
  _buildWalls() {
    const { width, height } = this;
    const half = WALL / 2;

    // Horizontal wall segments live on grid lines gy ∈ [0..height], column x.
    const hLine = (gy, x) => {
      if (gy < height) return this.tiles[x][gy][1] === 1;
      return this.tiles[x][height - 1][0] === 1; // outer south border
    };
    for (let gy = 0; gy <= height; gy++) {
      let runStart = -1;
      for (let x = 0; x <= width; x++) {
        const on = x < width && hLine(gy, x);
        if (on && runStart < 0) runStart = x;
        if ((!on || x === width) && runStart >= 0) {
          this.walls.push({
            minX: runStart * TILE - half,
            maxX: x * TILE + half,
            minY: gy * TILE - half,
            maxY: gy * TILE + half,
            horizontal: true,
          });
          runStart = -1;
        }
      }
    }

    // Vertical wall segments live on grid lines gx ∈ [0..width], row y.
    const vLine = (gx, y) => {
      if (gx < width) return this.tiles[gx][y][2] === 1;
      return this.tiles[width - 1][y][0] === 1; // outer east border
    };
    for (let gx = 0; gx <= width; gx++) {
      let runStart = -1;
      for (let y = 0; y <= height; y++) {
        const on = y < height && vLine(gx, y);
        if (on && runStart < 0) runStart = y;
        if ((!on || y === height) && runStart >= 0) {
          this.walls.push({
            minX: gx * TILE - half,
            maxX: gx * TILE + half,
            minY: runStart * TILE - half,
            maxY: y * TILE + half,
            horizontal: false,
          });
          runStart = -1;
        }
      }
    }
  }

  // ── all-pairs BFS distances (orthogonal) ──────────────────────────────────
  _buildDistances() {
    /** @type {Map<number, Int16Array>} keyed by tileIndex -> distance grid */
    this.distances = new Map();
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (this.present(x, y)) this.distances.set(this._idx(x, y), this._bfsFrom(x, y));
      }
    }
  }

  _idx(x, y) {
    return x * this.height + y;
  }

  _bfsFrom(sx, sy) {
    const dist = new Int16Array(this.width * this.height).fill(-1);
    const queue = [[sx, sy]];
    dist[this._idx(sx, sy)] = 0;
    let head = 0;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    while (head < queue.length) {
      const [x, y] = queue[head++];
      const d = dist[this._idx(x, y)];
      for (const [dx, dy] of dirs) {
        if (!this.isOpen(x, y, dx, dy)) continue;
        const nx = x + dx;
        const ny = y + dy;
        const ni = this._idx(nx, ny);
        if (dist[ni] === -1) {
          dist[ni] = d + 1;
          queue.push([nx, ny]);
        }
      }
    }
    return dist;
  }

  /** Orthogonal tile-step distance between two tiles, or Infinity if unreachable. */
  tileDistance(ax, ay, bx, by) {
    const grid = this.distances.get(this._idx(ax, ay));
    if (!grid) return Infinity;
    const d = grid[this._idx(bx, by)];
    return d === -1 ? Infinity : d;
  }

  reachableTiles() {
    const out = [];
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height; y++) {
        if (this.present(x, y)) out.push({ x, y });
      }
    }
    return out;
  }

  // ── dead-end penalties (onion-peel from single-exit tiles) ─────────────────
  _buildDeadEndPenalties() {
    const W = this.width;
    const H = this.height;
    this.deadEnd = new Int8Array(W * H);
    const exits = (x, y) => {
      let n = 0;
      if (this.isOpen(x, y, 1, 0)) n++;
      if (this.isOpen(x, y, -1, 0)) n++;
      if (this.isOpen(x, y, 0, 1)) n++;
      if (this.isOpen(x, y, 0, -1)) n++;
      return n;
    };
    const max = C.MAZE.MAX_DEAD_END_PENALTY;
    // Iteratively peel: tiles with one open exit get a penalty descending inward.
    const exitCount = new Int8Array(W * H);
    const queue = [];
    for (let x = 0; x < W; x++) {
      for (let y = 0; y < H; y++) {
        if (!this.present(x, y)) continue;
        const e = exits(x, y);
        exitCount[this._idx(x, y)] = e;
        if (e <= 1) {
          this.deadEnd[this._idx(x, y)] = max;
          queue.push([x, y]);
        }
      }
    }
    let head = 0;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    while (head < queue.length) {
      const [x, y] = queue[head++];
      const p = this.deadEnd[this._idx(x, y)];
      for (const [dx, dy] of dirs) {
        if (!this.isOpen(x, y, dx, dy)) continue;
        const nx = x + dx;
        const ny = y + dy;
        const ni = this._idx(nx, ny);
        exitCount[ni]--;
        if (exitCount[ni] === 1 && this.deadEnd[ni] === 0) {
          this.deadEnd[ni] = Math.max(1, p - 1);
          queue.push([nx, ny]);
        }
      }
    }
  }

  deadEndPenalty(tx, ty) {
    if (!this.inBounds(tx, ty)) return 0;
    return this.deadEnd[this._idx(tx, ty)];
  }
}
