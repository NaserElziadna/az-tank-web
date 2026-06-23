import { PhysicsWorld } from '../../physics/PhysicsWorld.js';
import { ObjectPool } from '../../core/pool/ObjectPool.js';
import { ProjectileEntity } from '../../entities/ProjectileEntity.js';
import { MineEntity } from '../../entities/MineEntity.js';
import { TankEntity } from '../../entities/TankEntity.js';
import { CollectibleEntity } from '../../entities/CollectibleEntity.js';
import { CollectibleType } from '../../models/enums.js';
import { WeaponFactory } from '../../weapons/WeaponFactory.js';
import { Pathfinder } from '../../maze/Pathfinder.js';
import { C } from '../../constants/GameConstants.js';

const TILE = C.MAZE.TILE_SIZE;

/**
 * The authoritative simulation for one round.
 *
 * Owns the maze, the physics world, and every live entity (tanks, projectiles,
 * mines, collectibles, laser beams). It advances the fixed-step physics, lets
 * each weapon spawn projectiles into it, resolves all collisions — including the
 * signature ricochet-self-kill and shield bounce — and reports the winner when
 * one tank remains.
 *
 * Controllers (human or AI) are pluggable: each exposes `think(dt, sim)` and
 * the sim asks them for an intent every step, so tanks treat both identically.
 */
export class RoundSimulation {
  /**
   * @param {import('../../maze/Maze.js').Maze} maze
   * @param {import('../../core/events/EventBus.js').EventBus} bus
   */
  constructor(maze, bus) {
    this.maze = maze;
    this.bus = bus;
    this.physics = new PhysicsWorld();
    this.physics.setWalls(maze.walls, maze.worldWidth, maze.worldHeight);

    /** @type {TankEntity[]} */
    this.tanks = [];
    this._tankBySlot = new Map();
    /** @type {ProjectileEntity[]} */
    this.projectiles = [];
    /** @type {MineEntity[]} */
    this.mines = [];
    /** @type {CollectibleEntity[]} */
    this.collectibles = [];
    /** @type {{points:{x:number,y:number}[], life:number, max:number, colorKey:any}[]} */
    this.beams = [];

    /** @type {Map<number, {think:(dt:number, sim:RoundSimulation)=>any}>} */
    this._controllers = new Map();

    this._projectilePool = new ObjectPool(
      () => new ProjectileEntity(),
      (p) => p.reset(),
      48,
    );
    this._minePool = new ObjectPool(
      () => new MineEntity(),
      (m) => m.reset(),
      8,
    );

    this.finished = false;
    this.winnerSlot = null;
  }

  emit(type, payload) {
    this.bus.emit(type, payload);
  }

  getTank(slot) {
    return this._tankBySlot.get(slot);
  }

  // ── setup ────────────────────────────────────────────────────────────────
  /** @param {import('../../models/Player.js').Player} player @param {{x:number,y:number,rotation:number}} spawn */
  addTank(player, spawn) {
    const tank = new TankEntity(player);
    tank.position.set(spawn.x, spawn.y);
    tank.prevPosition.copy(tank.position);
    tank.rotation = spawn.rotation;
    // No spawn shield in last-tank-standing: the 3-2-1 countdown is the buffer,
    // and no projectiles exist at round start. Shields come only from crates.
    this.tanks.push(tank);
    this._tankBySlot.set(player.slot, tank);
    player.tank = tank;
    return tank;
  }

  /** @param {number} slot @param {{think:Function}} controller */
  setController(slot, controller) {
    this._controllers.set(slot, controller);
  }

  get aliveCount() {
    let n = 0;
    for (const t of this.tanks) if (t.alive) n++;
    return n;
  }

  // ── main step ──────────────────────────────────────────────────────────
  /** @param {number} dt @param {boolean} acceptInput tanks read controls only when true */
  update(dt, acceptInput) {
    // 1. controllers → intents
    for (const tank of this.tanks) {
      if (!tank.alive) continue;
      if (acceptInput) {
        const ctrl = this._controllers.get(tank.slot);
        tank.intent = ctrl ? ctrl.think(dt, this) : null;
      } else {
        tank.intent = null;
      }
    }

    // 2. tanks
    for (const tank of this.tanks) if (tank.alive) tank.update(dt, this);
    this._separateTanks();

    // 3. mines
    for (const mine of this.mines) mine.update(dt, this);

    // 4. projectiles
    for (const p of this.projectiles) p.update(dt, this);

    // 5. collectibles
    for (const c of this.collectibles) c.update(dt);

    // 6. beams (transient visuals)
    for (const b of this.beams) b.life -= dt;

    // 7. collisions
    this._resolveProjectileHits();
    this._resolveCollectiblePickups();

    // 8. reap dead
    this._reap();

    // 9. win check
    if (!this.finished && this.aliveCount <= 1 && this.tanks.length > 1) {
      this.finished = true;
      const survivor = this.tanks.find((t) => t.alive);
      this.winnerSlot = survivor ? survivor.slot : null; // null = mutual destruction (draw)
      this.emit('round:decided', { winnerSlot: this.winnerSlot });
    }
  }

  // ── projectile spawning (called by weapons / mines) ────────────────────────
  /** @param {object} cfg see ProjectileEntity fields */
  spawnProjectile(cfg) {
    const p = this._projectilePool.acquire();
    p.kind = cfg.kind;
    p.ownerSlot = cfg.ownerSlot;
    p.colorKey = cfg.colorKey;
    p.radius = cfg.radius;
    p.maxLifetime = cfg.maxLifetime;
    p.constantSpeed = cfg.constantSpeed ?? true;
    p.stopsOnWall = cfg.stopsOnWall ?? false;
    p.drag = cfg.drag ?? 0;
    p.lifetimeAfterHit = cfg.lifetimeAfterHit ?? null;
    p.homing = cfg.homing ?? false;
    p.activationTime = cfg.activationTime ?? 0;
    p.activated = !p.homing;
    p.deadlyToOwner = cfg.deadlyToOwner ?? false;
    p.launch(cfg.pos, cfg.angle, cfg.speed);
    this.projectiles.push(p);
    return p;
  }

  spawnMine({ ownerSlot, colorKey, pos }) {
    const m = this._minePool.acquire();
    m.ownerSlot = ownerSlot;
    m.colorKey = colorKey;
    // Toss toward the tank's rear-facing direction (already offset behind it).
    const tank = this.getTank(ownerSlot);
    const angle = tank ? tank.rotation + Math.PI : 0;
    m.deploy(pos, angle);
    this.mines.push(m);
    return m;
  }

  /** Fire an instant laser beam that reflects off walls and kills the first tank. */
  fireLaser(tank, angle) {
    const cfg = C.WEAPONS.LASER;
    const muzzle = tank.muzzle(C.TANK.BARREL_LENGTH);
    let x = muzzle.x;
    let y = muzzle.y;
    let dx = Math.cos(angle);
    let dy = Math.sin(angle);
    let remaining = 200;
    const points = [{ x, y }];
    let bounces = 0;

    while (remaining > 0.01 && bounces <= 6) {
      const wall = this.physics.raycastWalls(x, y, dx, dy, remaining, 0);
      const segLen = wall ? wall.t : remaining;
      // Nearest tank along this segment.
      let hitTank = null;
      let hitT = segLen;
      for (const t of this.tanks) {
        if (!t.alive) continue;
        if (t.slot === tank.slot && bounces === 0) continue;
        const tt = rayCircle(x, y, dx, dy, hitT, t.position.x, t.position.y, C.TANK.COLLISION_RADIUS);
        if (tt >= 0 && tt < hitT) {
          hitT = tt;
          hitTank = t;
        }
      }
      x += dx * hitT;
      y += dy * hitT;
      points.push({ x, y });
      if (hitTank) {
        if (!hitTank.hasActiveShield) this._killTank(hitTank, tank.slot);
        break; // beam stops at the (shielded or killed) tank
      }
      if (!wall) break;
      const dot = dx * wall.nx + dy * wall.ny;
      dx -= 2 * dot * wall.nx;
      dy -= 2 * dot * wall.ny;
      x += dx * 1e-3;
      y += dy * 1e-3;
      remaining -= segLen;
      bounces++;
    }
    this.beams.push({ points, life: cfg.maxLifetime, max: cfg.maxLifetime, colorKey: tank.colorKey });
  }

  /** Steer a homing missile one step toward the maze-nearest tank. */
  steerHomingMissile(proj, dt) {
    const target = this._homingTarget(proj);
    if (!target) return;
    let wx;
    let wy;
    const pt = this.maze.worldToTile(proj.position.x, proj.position.y);
    const tt = this.maze.worldToTile(target.position.x, target.position.y);
    const td = this.maze.tileDistance(pt.tx, pt.ty, tt.tx, tt.ty);
    if (td <= 1 || td === Infinity) {
      wx = target.position.x;
      wy = target.position.y;
    } else {
      const path = Pathfinder.shortestPath(this.maze, { tx: pt.tx, ty: pt.ty }, { tx: tt.tx, ty: tt.ty });
      if (path.length) {
        const c = this.maze.tileCenter(path[0].x, path[0].y);
        wx = c.x;
        wy = c.y;
      } else {
        wx = target.position.x;
        wy = target.position.y;
      }
    }
    // Accelerate toward the waypoint along the true direction; the projectile's
    // constant-speed clamp then renormalises magnitude, so this just steers.
    const accel = C.WEAPONS.HOMING.accel;
    let dx = wx - proj.position.x;
    let dy = wy - proj.position.y;
    const len = Math.hypot(dx, dy) || 1;
    proj.velocity.x += (dx / len) * accel * dt;
    proj.velocity.y += (dy / len) * accel * dt;
    proj.targetSlot = target.slot;
  }

  _homingTarget(proj) {
    let best = null;
    let bestD = Infinity;
    const pt = this.maze.worldToTile(proj.position.x, proj.position.y);
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const ownerBias = t.slot === proj.ownerSlot ? 0.5 : 0; // prefer enemies
      const tt = this.maze.worldToTile(t.position.x, t.position.y);
      const d = this.maze.tileDistance(pt.tx, pt.ty, tt.tx, tt.ty) + ownerBias;
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    return best;
  }

  liveProjectileCount(slot, kind) {
    let n = 0;
    for (const p of this.projectiles) if (!p.dead && p.ownerSlot === slot && p.kind === kind) n++;
    return n;
  }

  // ── collisions ─────────────────────────────────────────────────────────
  _resolveProjectileHits() {
    const shieldR = C.UPGRADES.SHIELD.radius;
    const halfLen = C.TANK.HEIGHT / 2; // forward axis (local X)
    const halfWid = C.TANK.WIDTH / 2; // lateral axis (local Y)

    for (const p of this.projectiles) {
      if (p.dead) continue;
      for (const tank of this.tanks) {
        if (!tank.alive) continue;
        if (!p.isDeadlyTo(tank.slot)) continue;

        if (tank.hasActiveShield) {
          // Shield is a circle around the tank. Your own un-bounced shot passes
          // straight through your own shield; everything else bounces off it
          // (and becomes deadly to its owner), so nobody is killed through a shield.
          const rr = shieldR + p.radius;
          const dx0 = p.position.x - tank.position.x;
          const dy0 = p.position.y - tank.position.y;
          if (dx0 * dx0 + dy0 * dy0 > rr * rr) continue;
          if (p.ownerSlot === tank.slot && !p.deadlyToOwner) continue; // pass through own shield
          let nx = dx0;
          let ny = dy0;
          const len = Math.hypot(nx, ny) || 1;
          nx /= len;
          ny /= len;
          const dot = p.velocity.x * nx + p.velocity.y * ny;
          p.velocity.x -= 2 * dot * nx;
          p.velocity.y -= 2 * dot * ny;
          p.position.x = tank.position.x + nx * (rr + 0.05);
          p.position.y = tank.position.y + ny * (rr + 0.05);
          p.deadlyToOwner = true;
          p.bounceCount++;
          continue;
        }

        // Oriented-box hit test: the tank is 3 m wide x 4 m long, so a shot
        // along the barrel axis reaches the full 4 m length (not a 3 m circle).
        const dx = p.position.x - tank.position.x;
        const dy = p.position.y - tank.position.y;
        const cos = Math.cos(tank.rotation);
        const sin = Math.sin(tank.rotation);
        const lx = dx * cos + dy * sin;
        const ly = -dx * sin + dy * cos;
        if (Math.abs(lx) <= halfLen + p.radius && Math.abs(ly) <= halfWid + p.radius) {
          this._killTank(tank, p.ownerSlot);
          if (p.kind !== 'shrapnel') p.destroy();
          break;
        }
      }
    }
  }

  /** Push overlapping tanks apart, then re-resolve each against walls. */
  _separateTanks() {
    const R = C.TANK.COLLISION_RADIUS;
    const minDist = R * 2;
    for (let i = 0; i < this.tanks.length; i++) {
      const a = this.tanks[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < this.tanks.length; j++) {
        const b = this.tanks[j];
        if (!b.alive) continue;
        let dx = b.position.x - a.position.x;
        let dy = b.position.y - a.position.y;
        let d = Math.hypot(dx, dy);
        if (d >= minDist) continue;
        if (d < 1e-4) {
          dx = 1;
          dy = 0;
          d = 1;
        }
        const push = (minDist - d) / 2;
        const nx = dx / d;
        const ny = dy / d;
        a.position.x -= nx * push;
        a.position.y -= ny * push;
        b.position.x += nx * push;
        b.position.y += ny * push;
        this.physics.resolveCircle(a.position, R);
        this.physics.resolveCircle(b.position, R);
      }
    }
  }

  _killTank(tank, killerSlot) {
    if (!tank.alive) return;
    tank.alive = false;
    this.emit('tank:destroyed', {
      slot: tank.slot,
      killerSlot,
      colorKey: tank.colorKey,
      x: tank.position.x,
      y: tank.position.y,
    });
  }

  _resolveCollectiblePickups() {
    const R = C.COLLECTIBLE.PICKUP_RADIUS;
    for (const c of this.collectibles) {
      if (c.dead) continue;
      for (const tank of this.tanks) {
        if (!tank.alive) continue;
        const rr = R + C.TANK.COLLISION_RADIUS - 0.6;
        if (c.position.distanceToSq(tank.position) > rr * rr) continue;
        if (this._pickup(c, tank)) {
          c.destroy();
          this.emit('collectible:picked', { type: c.category, slot: tank.slot });
          break;
        }
      }
    }
  }

  /** @returns {boolean} whether the pickup was consumed */
  _pickup(c, tank) {
    if (c.category === CollectibleType.WEAPON_CRATE) {
      if (WeaponFactory.isUpgrade(c.kind)) {
        WeaponFactory.applyUpgrade(c.kind, tank);
        return true;
      }
      if (tank.queuedWeaponCount >= C.MAX_WEAPON_QUEUE) return false;
      tank.giveWeapon(WeaponFactory.create(c.kind));
      // The laser crate comes bundled with a laser-sight aimer in the original.
      if (c.kind === 'laser') tank.giveAimer();
      return true;
    }
    // Gold / diamond — flair currency; small score handled by GameController.
    return true;
  }

  _reap() {
    this.projectiles = filterReleasing(this.projectiles, (p) => p.dead, (p) => this._projectilePool.release(p));
    this.mines = filterReleasing(this.mines, (m) => m.dead, (m) => this._minePool.release(m));
    this.collectibles = this.collectibles.filter((c) => !c.dead);
    this.beams = this.beams.filter((b) => b.life > 0);
  }

  /** Add a collectible to the arena. */
  addCollectible(collectible) {
    this.collectibles.push(collectible);
    this.emit('collectible:spawned', { type: collectible.category });
  }

  collectibleCount(category) {
    let n = 0;
    for (const c of this.collectibles) if (!c.dead && c.category === category) n++;
    return n;
  }

  destroy() {
    this.tanks.length = 0;
    this.projectiles.length = 0;
    this.mines.length = 0;
    this.collectibles.length = 0;
    this.beams.length = 0;
    this._controllers.clear();
    this._tankBySlot.clear();
  }
}

/** Remove items matching `pred`, calling `onRemove` for each, returning kept items. */
function filterReleasing(arr, pred, onRemove) {
  const kept = [];
  for (const item of arr) {
    if (pred(item)) onRemove(item);
    else kept.push(item);
  }
  return kept;
}

/** Local ray-vs-circle (avoids an import cycle with AABB helpers). */
function rayCircle(ox, oy, dx, dy, maxDist, cx, cy, r) {
  const ex = cx - ox;
  const ey = cy - oy;
  const b = ex * dx + ey * dy;
  const c = ex * ex + ey * ey - r * r;
  if (c > 0 && b < 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = b - Math.sqrt(disc);
  if (t < 0 || t > maxDist) return -1;
  return t;
}
