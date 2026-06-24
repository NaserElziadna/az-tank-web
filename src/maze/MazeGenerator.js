import { C } from '../constants/GameConstants.js';
import { rng as defaultRng } from '../core/math/Random.js';
import { Maze } from './Maze.js';

/**
 * Procedural maze generator (Strategy).
 *
 * Reproduces the original's "probabilistic noise field" character — random tile
 * presence + random interior wall seeds — which yields loopy, braided arenas
 * (not perfect spanning-tree mazes). Connectivity is then guaranteed with a
 * Kruskal-style pass that removes walls between disconnected components (keeping
 * the loops), and spawns are placed greedily to maximise separation.
 */
export class MazeGenerator {
  /** @param {import('../core/math/Random.js').Random} [rng] */
  constructor(rng = defaultRng) {
    this.rng = rng;
  }

  /**
   * @param {number} playerCount
   * @returns {Maze}
   */
  generate(playerCount) {
    const { width, height } = this._dimensions(playerCount);
    const tiles = this._carveMaze(width, height);
    const maze = new Maze(tiles);
    maze.tankSpawns = this._placeSpawns(maze, maze.reachableTiles(), playerCount);
    return maze;
  }

  /**
   * Carve a full rectangular grid into a maze: start fully walled, run a
   * randomised depth-first backtracker (a perfect maze — every cell reachable),
   * then "braid" by removing a share of interior walls to add loops and open
   * chambers. This produces the original's tight-corridor, connected, slightly
   * open arenas rather than a sparse blob of cells.
   *
   * tiles[x][y] = [present, topWall, leftWall]; outer south/east borders are
   * derived from presence by the Maze class.
   */
  _carveMaze(width, height) {
    const tiles = [];
    for (let x = 0; x < width; x++) {
      tiles.push([]);
      for (let y = 0; y < height; y++) tiles[x][y] = [1, 1, 1]; // present, fully walled
    }
    const idx = (x, y) => x * height + y;
    const openWall = (x, y, dx, dy) => {
      if (dx === 1) tiles[x + 1][y][2] = 0; // right → target's left wall
      else if (dx === -1) tiles[x][y][2] = 0; // left → own left wall
      else if (dy === 1) tiles[x][y + 1][1] = 0; // down → target's top wall
      else if (dy === -1) tiles[x][y][1] = 0; // up → own top wall
    };

    // Depth-first backtracker.
    const visited = new Uint8Array(width * height);
    const sx = this.rng.int(0, width - 1);
    const sy = this.rng.int(0, height - 1);
    const stack = [[sx, sy]];
    visited[idx(sx, sy)] = 1;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const opts = [];
      for (const [dx, dy] of dirs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && !visited[idx(nx, ny)]) opts.push([dx, dy]);
      }
      if (opts.length === 0) {
        stack.pop();
        continue;
      }
      const [dx, dy] = opts[this.rng.int(0, opts.length - 1)];
      openWall(x, y, dx, dy);
      visited[idx(x + dx, y + dy)] = 1;
      stack.push([x + dx, y + dy]);
    }

    // Braid: knock out extra interior walls for loops + open chambers.
    const braid = 0.24;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (y > 0 && tiles[x][y][1] === 1 && this.rng.next() < braid) tiles[x][y][1] = 0;
        if (x > 0 && tiles[x][y][2] === 1 && this.rng.next() < braid) tiles[x][y][2] = 0;
      }
    }
    return tiles;
  }

  /** Minimum pairwise tile-distance between chosen spawns (Infinity if <2). */
  _minSpawnSpacing(maze) {
    const s = maze.tankSpawns;
    if (s.length < 2) return Infinity;
    let min = Infinity;
    for (let i = 0; i < s.length; i++) {
      for (let j = i + 1; j < s.length; j++) {
        const a = maze.worldToTile(s[i].x, s[i].y);
        const b = maze.worldToTile(s[j].x, s[j].y);
        min = Math.min(min, maze.tileDistance(a.tx, a.ty, b.tx, b.ty));
      }
    }
    return min;
  }

  _dimensions(n) {
    const M = C.MAZE;
    const i = Math.min(n, M.WIDTH_FOR_PLAYERS.length - 1);
    let w = Math.max(M.BASE_WIDTH, M.WIDTH_FOR_PLAYERS[i]);
    let h = Math.max(M.BASE_HEIGHT, M.HEIGHT_FOR_PLAYERS[i]);
    w = Math.round(w * this.rng.range(1, M.MAX_RANDOM_MULTIPLIER));
    h = Math.round(h * this.rng.range(1, M.MAX_RANDOM_MULTIPLIER));
    w = Math.min(w, M.MAX_WIDTH);
    h = Math.min(h, M.MAX_HEIGHT);
    // Guarantee enough room: the original requires >= MIN_TILES_PER_TANK tiles
    // per tank, so grow the grid until it can hold them (with a little slack).
    const needed = n * M.MIN_TILES_PER_TANK + n;
    let guard = 0;
    while (w * h < needed && guard++ < 20) {
      if (w <= h && w < M.MAX_WIDTH) w++;
      else if (h < M.MAX_HEIGHT) h++;
      else if (w < M.MAX_WIDTH) w++;
      else break;
    }
    return { width: w, height: h };
  }

  /** Steps 1–3 of the spec: wall-seed grid + tile presence → top/left walls. */
  _noiseField(width, height, forceFull) {
    const M = C.MAZE;
    const wallProb = this.rng.pick(M.WALL_PROBABILITIES);
    const tileProb = forceFull ? 1 : this.rng.pick(M.TILE_PROBABILITIES);

    // Directed wall seeds in {0,1,2,3} or 4 (= none).
    const seeds = [];
    for (let i = 0; i <= width; i++) {
      seeds.push([]);
      for (let j = 0; j <= height; j++) {
        seeds[i][j] = this.rng.next() > wallProb ? 4 : Math.floor(this.rng.next() * 4);
      }
    }

    const present = [];
    for (let i = 0; i < width; i++) {
      present.push([]);
      for (let j = 0; j < height; j++) {
        present[i][j] = this.rng.next() > tileProb ? 0 : 1;
      }
    }

    const tiles = [];
    for (let i = 0; i < width; i++) {
      tiles.push([]);
      for (let j = 0; j < height; j++) {
        let top;
        let left;
        if (present[i][j]) {
          top =
            seeds[i][j] === 0 ||
            (i + 1 <= width && seeds[i + 1][j] === 2) ||
            j === 0 ||
            (j > 0 && !present[i][j - 1]);
          left =
            seeds[i][j] === 1 ||
            (j + 1 <= height && seeds[i][j + 1] === 3) ||
            i === 0 ||
            (i > 0 && !present[i - 1][j]);
        } else {
          top = j > 0 && present[i][j - 1] === 1;
          left = i > 0 && present[i - 1][j] === 1;
        }
        tiles[i][j] = [present[i][j], top ? 1 : 0, left ? 1 : 0];
      }
    }
    return tiles;
  }

  _fullGrid(width, height) {
    const tiles = [];
    for (let i = 0; i < width; i++) {
      tiles.push([]);
      for (let j = 0; j < height; j++) {
        // Some random interior walls so the full grid is still maze-like.
        tiles[i][j] = [
          1,
          j === 0 || this.rng.bool(0.32) ? 1 : 0,
          i === 0 || this.rng.bool(0.32) ? 1 : 0,
        ];
      }
    }
    return tiles;
  }

  /** Kruskal-style: remove walls between adjacent present tiles in different sets. */
  _connect(tiles, width, height) {
    const idx = (x, y) => x * height + y;
    const parent = new Int32Array(width * height);
    for (let i = 0; i < parent.length; i++) parent[i] = i;
    const find = (a) => {
      while (parent[a] !== a) {
        parent[a] = parent[parent[a]];
        a = parent[a];
      }
      return a;
    };
    const union = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent[ra] = rb;
    };

    const present = (x, y) => x >= 0 && y >= 0 && x < width && y < height && tiles[x][y][0] === 1;

    // First union everything already open.
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (!present(x, y)) continue;
        if (present(x + 1, y) && tiles[x + 1][y][2] === 0) union(idx(x, y), idx(x + 1, y));
        if (present(x, y + 1) && tiles[x][y + 1][1] === 0) union(idx(x, y), idx(x, y + 1));
      }
    }

    // Then knock down walls between adjacent present tiles still in different sets.
    const pairs = [];
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (!present(x, y)) continue;
        if (present(x + 1, y)) pairs.push([x, y, x + 1, y, 'left']);
        if (present(x, y + 1)) pairs.push([x, y, x, y + 1, 'top']);
      }
    }
    this.rng.shuffle(pairs);
    for (const [x, y, nx, ny, side] of pairs) {
      if (find(idx(x, y)) !== find(idx(nx, ny))) {
        if (side === 'left') tiles[nx][ny][2] = 0;
        else tiles[nx][ny][1] = 0;
        union(idx(x, y), idx(nx, ny));
      }
    }
  }

  /** Keep only the largest connected component (drop isolated islands). */
  _largestComponent(tiles, width, height) {
    const seen = new Set();
    const components = [];
    const idx = (x, y) => x * height + y;
    const present = (x, y) => x >= 0 && y >= 0 && x < width && y < height && tiles[x][y][0] === 1;
    const open = (x, y, dx, dy) => {
      const nx = x + dx;
      const ny = y + dy;
      if (!present(nx, ny)) return false;
      if (dx === 1) return tiles[nx][ny][2] === 0;
      if (dx === -1) return tiles[x][y][2] === 0;
      if (dy === 1) return tiles[x][ny][1] === 0;
      if (dy === -1) return tiles[x][y][1] === 0;
      return false;
    };
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (!present(x, y) || seen.has(idx(x, y))) continue;
        const comp = [];
        const stack = [[x, y]];
        seen.add(idx(x, y));
        while (stack.length) {
          const [cx, cy] = stack.pop();
          comp.push({ x: cx, y: cy });
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (open(cx, cy, dx, dy) && !seen.has(idx(cx + dx, cy + dy))) {
              seen.add(idx(cx + dx, cy + dy));
              stack.push([cx + dx, cy + dy]);
            }
          }
        }
        components.push(comp);
      }
    }
    components.sort((a, b) => b.length - a.length);
    const largest = components[0] || [];
    const keep = new Set(largest.map((t) => idx(t.x, t.y)));
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (present(x, y) && !keep.has(idx(x, y))) tiles[x][y][0] = 0;
      }
    }
    return largest;
  }

  /** Greedy farthest-point placement so tanks start well apart. */
  _placeSpawns(maze, present, count) {
    if (present.length === 0) return [];
    const chosen = [present[this.rng.int(0, present.length - 1)]];
    while (chosen.length < count) {
      let best = null;
      let bestScore = -1;
      for (const t of present) {
        let minD = Infinity;
        for (const c of chosen) {
          const d = maze.tileDistance(t.x, t.y, c.x, c.y);
          if (d < minD) minD = d;
        }
        // Slight random tiebreak keeps layouts varied.
        const score = minD + this.rng.next() * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = t;
        }
      }
      if (!best) break;
      chosen.push(best);
    }
    return chosen.slice(0, count).map((t) => {
      const c = maze.tileCenter(t.x, t.y);
      return { x: c.x, y: c.y, rotation: this.rng.range(0, Math.PI * 2) };
    });
  }
}
