import { C } from '../../constants/GameConstants.js';
import { rng } from '../../core/math/Random.js';
import { CollectibleEntity } from '../../entities/CollectibleEntity.js';
import { CollectibleType } from '../../models/enums.js';
import { ALL_CRATES } from '../../weapons/WeaponFactory.js';

const CC = C.COLLECTIBLE;

/**
 * Spawns weapon/upgrade crates (and the occasional gold coin) into a running
 * round on independent timers, always placing them a safe distance from every
 * living tank. Encapsulating the spawn cadence keeps the round controller lean.
 */
export class CrateSpawner {
  /**
   * @param {string[]} [enabledKinds] crate content keys allowed this match
   * @param {{goldRush?:boolean}} [opts] goldRush makes gold spawn fast & plentiful
   */
  constructor(enabledKinds = null, { goldRush = false } = {}) {
    this.goldRush = goldRush;
    this.crateTimer = this._nextCrateDelay() * 0.4; // first crate comes a little sooner
    this.goldTimer = goldRush ? 1.5 : this._nextGoldDelay(); // gold rush: near-instant first gold
    this.enabled = enabledKinds;
  }

  _nextCrateDelay() {
    return CC.CRATE_SPAWN_MIN + rng.next() * CC.CRATE_SPAWN_VARIANCE;
  }

  _nextGoldDelay() {
    // Gold rush floods the arena with gold; otherwise it's an occasional bonus.
    if (this.goldRush) return 2.0 + rng.next() * 2.5;
    return CC.GOLD_SPAWN_MIN + rng.next() * CC.GOLD_SPAWN_VARIANCE;
  }

  _crateMenu() {
    if (!this.enabled) return ALL_CRATES;
    const set = new Set(this.enabled);
    const menu = ALL_CRATES.filter((c) => set.has(c.kind));
    return menu.length ? menu : ALL_CRATES;
  }

  /**
   * Pick a crate weighted by rarity so round-deciders (laser, homing, phase, …)
   * stay scarce and commons (aimer, speed, mines) fill most crates. Falls back
   * to a uniform pick if no weights are present.
   */
  _weightedPick(menu) {
    let total = 0;
    for (const c of menu) total += c.weight || 1;
    let r = rng.next() * total;
    for (const c of menu) {
      r -= c.weight || 1;
      if (r <= 0) return c;
    }
    return menu[menu.length - 1];
  }

  /** @param {number} dt @param {import('./RoundSimulation.js').RoundSimulation} sim */
  update(dt, sim) {
    this.crateTimer -= dt;
    if (this.crateTimer <= 0) {
      this.crateTimer = this._nextCrateDelay();
      if (sim.collectibleCount(CollectibleType.WEAPON_CRATE) < CC.MAX_CRATES) {
        this._spawnCrate(sim);
      }
    }

    this.goldTimer -= dt;
    if (this.goldTimer <= 0) {
      this.goldTimer = this._nextGoldDelay();
      const cap = this.goldRush ? 6 : CC.MAX_GOLDS;
      if (sim.collectibleCount(CollectibleType.GOLD) < cap && sim.aliveCount > 1) {
        this._spawnGold(sim);
      }
    }
  }

  _spawnCrate(sim) {
    const tile = this._findTile(sim, CC.CRATE_MIN_TILES_TO_TANKS);
    if (!tile) return;
    const pick = this._weightedPick(this._crateMenu());
    const center = sim.maze.tileCenter(tile.x, tile.y);
    sim.addCollectible(
      new CollectibleEntity({
        category: CollectibleType.WEAPON_CRATE,
        kind: pick.kind,
        pos: center,
        rotation: rng.range(-0.25, 0.25),
      }),
    );
  }

  _spawnGold(sim) {
    const tile = this._findTile(sim, CC.GOLD_MIN_TILES_TO_TANKS);
    if (!tile) return;
    const center = sim.maze.tileCenter(tile.x, tile.y);
    sim.addCollectible(new CollectibleEntity({ category: CollectibleType.GOLD, pos: center }));
  }

  /** Random reachable tile at least `minTiles` from every living tank. */
  _findTile(sim, minTiles) {
    const maze = sim.maze;
    const tiles = maze.reachableTiles();
    rng.shuffle(tiles);
    const tankTiles = sim.tanks.filter((t) => t.alive).map((t) => maze.worldToTile(t.position.x, t.position.y));

    let relaxed = minTiles;
    for (let attempt = 0; attempt < 3; attempt++) {
      for (const tile of tiles) {
        if (this._occupied(sim, tile)) continue;
        let ok = true;
        for (const tt of tankTiles) {
          if (maze.tileDistance(tile.x, tile.y, tt.tx, tt.ty) < relaxed) {
            ok = false;
            break;
          }
        }
        if (ok) return tile;
      }
      relaxed = Math.max(1, relaxed - 2); // relax and retry on tight mazes
    }
    return null;
  }

  _occupied(sim, tile) {
    for (const c of sim.collectibles) {
      const ct = sim.maze.worldToTile(c.position.x, c.position.y);
      if (ct.tx === tile.x && ct.ty === tile.y) return true;
    }
    return false;
  }
}
