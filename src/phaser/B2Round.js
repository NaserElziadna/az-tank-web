import { Box2DWorld, CAT } from '../physics/Box2DWorld.js';
import { PhysicsWorld } from '../physics/PhysicsWorld.js';
import { MazeGraph } from '../maze/MazeGraph.js';
import { Vector2 } from '../core/math/Vector2.js';
import { C } from '../constants/GameConstants.js';
import { CollectibleType } from '../models/enums.js';
import { WeaponFactory } from '../weapons/WeaponFactory.js';
import { BulletWeapon } from '../weapons/BulletWeapon.js';
import { rng } from '../core/math/Random.js';

let _id = 1;
const nextId = () => _id++;

/**
 * A tank backed by a real Box2D body. Exposes the same surface the existing
 * Weapon classes and AIController consume (rotation, muzzle(), slot, colorKey,
 * weapon queue, upgrades), so that verified logic is reused unchanged; only the
 * movement substrate (direct body velocities, original's model) differs.
 */
class B2Tank {
  constructor(player, body) {
    this.player = player;
    this.slot = player.slot;
    this.colorKey = player.color;
    this.body = body;
    this.position = new Vector2(body.GetPosition().x, body.GetPosition().y);
    this.prevPosition = this.position.clone();
    this.rotation = body.GetAngle();
    this.prevRotation = this.rotation;
    this.velocity = new Vector2();
    this.intent = null;
    this.defaultWeapon = new BulletWeapon();
    this.weaponQueue = [];
    this.shield = null;
    this.speedBoost = null;
    this.aimer = null;
    this.locked = false;
    this.alive = true;
    this.stuck = false;
    this.treadOffset = 0;
  }

  get activeWeapon() {
    return this.weaponQueue.length ? this.weaponQueue[this.weaponQueue.length - 1] : this.defaultWeapon;
  }
  get queuedWeaponCount() {
    return this.weaponQueue.length;
  }
  get speedModifier() {
    return 1 + (this.speedBoost ? C.UPGRADES.SPEED_BOOST.effect : 0);
  }
  get hasActiveShield() {
    return this.shield != null;
  }
  get forward() {
    return new Vector2(Math.cos(this.rotation), Math.sin(this.rotation));
  }
  muzzle(offset) {
    return new Vector2(this.position.x + Math.cos(this.rotation) * offset, this.position.y + Math.sin(this.rotation) * offset);
  }
  giveWeapon(w) {
    this.weaponQueue.push(w);
    if (this.weaponQueue.length > C.MAX_WEAPON_QUEUE) this.weaponQueue.shift();
  }
  giveShield() {
    this.shield = { time: C.UPGRADES.SHIELD.lifetime };
  }
  giveSpeedBoost() {
    this.speedBoost = { time: C.UPGRADES.SPEED_BOOST.lifetime };
  }
  giveAimer() {
    this.aimer = { time: C.UPGRADES.AIMER.lifetime, length: C.UPGRADES.AIMER.length };
  }

  /** Set body velocities from the current control intent (pre-step). */
  applyControl(dt, sim) {
    const intent = this.intent;
    this.locked = this.activeWeapon.movementLocked?.() ?? false;
    let drive = 0;
    if (intent && !this.locked) {
      const angVel = intent.turn * C.TANK.ROTATION_SPEED;
      this.body.SetAngularVelocity(angVel);
      if (intent.drive !== 0) {
        const speed = (intent.drive > 0 ? C.TANK.FORWARD_SPEED : -C.TANK.BACK_SPEED) * this.speedModifier;
        this.body.SetLinearVelocity(Box2DWorld.vec(Math.cos(this.rotation) * speed, Math.sin(this.rotation) * speed));
        drive = intent.drive;
      } else {
        this.body.SetLinearVelocity(Box2DWorld.vec(0, 0));
      }
    } else {
      this.body.SetLinearVelocity(Box2DWorld.vec(0, 0));
      this.body.SetAngularVelocity(0);
    }
    this._drive = drive;
    // Fire control.
    if (intent && (!this.locked || this.activeWeapon.movementLocked?.())) {
      if (intent.fire) this.activeWeapon.onTriggerDown(this, sim);
      else this.activeWeapon.onTriggerUp();
    }
  }

  syncFromBody() {
    this.prevPosition.copy(this.position);
    this.prevRotation = this.rotation;
    const p = this.body.GetPosition();
    this.position.set(p.x, p.y);
    this.rotation = this.body.GetAngle();
    const v = this.body.GetLinearVelocity();
    this.velocity.set(v.x, v.y);
    // Stuck = trying to drive but barely moving.
    const speed = Math.hypot(v.x, v.y);
    this.stuck = this._drive !== 0 && speed < C.TANK.FORWARD_SPEED * 0.3;
    this.treadOffset += (this._drive * C.TANK.FORWARD_SPEED) * (1 / 60);
  }

  updateTimers(dt) {
    if (this.shield && (this.shield.time -= dt) <= 0) this.shield = null;
    if (this.speedBoost && (this.speedBoost.time -= dt) <= 0) this.speedBoost = null;
    if (this.aimer && (this.aimer.time -= dt) <= 0) this.aimer = null;
    this.defaultWeapon.update(dt);
    for (const w of this.weaponQueue) w.update(dt);
    for (let i = this.weaponQueue.length - 1; i >= 0; i--) if (this.weaponQueue[i].isDepleted()) this.weaponQueue.splice(i, 1);
  }
}

/** A projectile backed by a Box2D body (restitution-1 bounce is physical). */
class B2Projectile {
  constructor(body, cfg) {
    this.id = nextId();
    this.body = body;
    this.kind = cfg.kind;
    this.ownerSlot = cfg.ownerSlot;
    this.colorKey = cfg.colorKey;
    this.radius = cfg.radius;
    this.maxLifetime = cfg.maxLifetime;
    this.timeAlive = 0;
    this.constantSpeed = cfg.constantSpeed ?? true;
    this.stopsOnWall = cfg.stopsOnWall ?? false;
    this.drag = cfg.drag ?? 0;
    this.lifetimeAfterHit = cfg.lifetimeAfterHit ?? null;
    this.homing = cfg.homing ?? false;
    this.activationTime = cfg.activationTime ?? 0;
    this.activated = !this.homing;
    this.deadlyToOwner = cfg.deadlyToOwner ?? false;
    this.targetSlot = -1;
    this._initialSpeed = cfg.speed;
    this._bounceTimes = [];
    this.position = new Vector2(cfg.pos.x, cfg.pos.y);
    this.prevPosition = this.position.clone();
    this.velocity = new Vector2(Math.cos(cfg.angle) * cfg.speed, Math.sin(cfg.angle) * cfg.speed);
    this.rotation = cfg.angle;
    this.dead = false;
  }

  isDeadlyTo(slot) {
    return slot === this.ownerSlot ? this.deadlyToOwner : true;
  }

  syncFromBody() {
    this.prevPosition.copy(this.position);
    const p = this.body.GetPosition();
    this.position.set(p.x, p.y);
    const v = this.body.GetLinearVelocity();
    this.velocity.set(v.x, v.y);
    this.rotation = Math.atan2(v.y, v.x);
  }

  update(dt, sim) {
    this.timeAlive += dt;
    if (this.timeAlive >= this.maxLifetime) return this.destroy(sim);

    if (this.homing) {
      if (!this.activated && this.timeAlive >= this.activationTime) {
        this.activated = true;
        this.deadlyToOwner = true;
      }
      if (this.activated) sim.steerHomingMissile(this, dt);
    }

    // A wall/shield bounce this step (flagged by the contact listener).
    if (sim.b2.bounced.has(this.id)) {
      this.deadlyToOwner = true;
      this._bounceTimes.push(this.timeAlive);
      sim.emit('projectile:bounce', { x: this.position.x, y: this.position.y }); // collide flare + SFX
      if (this.lifetimeAfterHit != null) this.maxLifetime = Math.min(this.maxLifetime, this.timeAlive + this.lifetimeAfterHit);
      if (this.stopsOnWall) {
        this.body.SetLinearVelocity(Box2DWorld.vec(0, 0));
        return this.destroy(sim);
      }
    }
    // Anti-rattle: 5 bounces within the window.
    const cutoff = this.timeAlive - C.PROJECTILE.BOUNCE_TIMEOUT_WINDOW;
    while (this._bounceTimes.length && this._bounceTimes[0] < cutoff) this._bounceTimes.shift();
    if (this._bounceTimes.length >= C.PROJECTILE.BOUNCE_TIMEOUT_COUNT) return this.destroy(sim);

    if (this.drag > 0) {
      const v = this.body.GetLinearVelocity();
      const f = Math.pow(1 - this.drag, dt * 60);
      this.body.SetLinearVelocity(Box2DWorld.vec(v.x * f, v.y * f));
      if (v.x * v.x + v.y * v.y < 0.5) return this.destroy(sim);
    } else if (this.constantSpeed) {
      // Renormalise to the launch speed (box2d drifts slightly on bounce).
      const v = this.body.GetLinearVelocity();
      const len = Math.hypot(v.x, v.y);
      if (len > 1e-3 && Math.abs(len - this._initialSpeed) > 0.05) {
        const s = this._initialSpeed / len;
        this.body.SetLinearVelocity(Box2DWorld.vec(v.x * s, v.y * s));
      }
    }
  }

  destroy(sim) {
    if (this.dead) return;
    this.dead = true;
    sim.b2.destroyBody(this.body);
  }
}

/** A proximity mine backed by a Box2D body. */
class B2Mine {
  constructor(body, ownerSlot, colorKey) {
    this.id = nextId();
    this.body = body;
    this.ownerSlot = ownerSlot;
    this.colorKey = colorKey;
    this.radius = C.WEAPONS.MINE.bodyRadius;
    this.state = 'arming';
    this.armTimer = C.WEAPONS.MINE.activationDelay;
    this.fuse = C.WEAPONS.MINE.detonationDelay;
    this.position = new Vector2(body.GetPosition().x, body.GetPosition().y);
    this.prevPosition = this.position.clone();
    this.dead = false;
  }
  get armed() {
    return this.state !== 'arming';
  }
  syncFromBody() {
    this.prevPosition.copy(this.position);
    const p = this.body.GetPosition();
    this.position.set(p.x, p.y);
  }
  update(dt, sim) {
    if (this.state === 'arming') {
      if ((this.armTimer -= dt) <= 0) this.state = 'armed';
      return;
    }
    if (this.state === 'armed') {
      for (const t of sim.tanks) {
        if (!t.alive) continue;
        if (t.position.distanceToSq(this.position) <= C.WEAPONS.MINE.triggerRadius ** 2) {
          this.state = 'tripped';
          sim.emit('mine:tripped', { x: this.position.x, y: this.position.y });
          break;
        }
      }
      return;
    }
    if (this.state === 'tripped' && (this.fuse -= dt) <= 0) this._detonate(sim);
  }
  _detonate(sim) {
    const cfg = C.WEAPONS.MINE;
    for (let i = 0; i < cfg.shrapnel; i++) {
      const angle = (i / cfg.shrapnel) * Math.PI * 2 + rng.range(-0.05, 0.05);
      sim.spawnProjectile({
        kind: 'shrapnel',
        ownerSlot: this.ownerSlot,
        colorKey: this.colorKey,
        pos: this.position,
        angle,
        speed: rng.range(cfg.shrapnelSpeedMin, cfg.shrapnelSpeedMax),
        radius: cfg.shrapnelRadius,
        maxLifetime: 3,
        constantSpeed: false,
        stopsOnWall: true,
        drag: 0.04,
        deadlyToOwner: true,
      });
    }
    sim.emit('mine:detonated', { x: this.position.x, y: this.position.y });
    this.destroy(sim);
  }
  destroy(sim) {
    if (this.dead) return;
    this.dead = true;
    sim.b2.destroyBody(this.body);
  }
}

/** A pickup backed by a Box2D sensor body. */
class B2Collectible {
  constructor(body, { category, kind, pos, rotation }) {
    this.id = nextId();
    this.body = body;
    this.category = category;
    this.kind = kind;
    this.position = new Vector2(pos.x, pos.y);
    this.prevPosition = this.position.clone();
    this.rotation = rotation || 0;
    this.spawnAnim = 0;
    this.spin = 0;
    this.dead = false;
  }
  update(dt) {
    if (this.spawnAnim < 1) this.spawnAnim = Math.min(1, this.spawnAnim + dt * 3);
    if (this.category !== CollectibleType.WEAPON_CRATE) this.spin += dt * 2;
  }
  destroy(sim) {
    if (this.dead) return;
    this.dead = true;
    sim.b2.destroyBody(this.body);
  }
}

/**
 * The authoritative round simulation on the original's stack: box2dweb for
 * dynamics, jkstra for AI/missile pathfinding, my geometry helper for AI ray
 * traces. Interface-compatible with the existing weapons + AIController, so the
 * gameplay rules are reused verbatim — only the physics substrate is real Box2D.
 */
export class B2Round {
  constructor(maze, bus) {
    this.maze = maze;
    this.bus = bus;
    this.b2 = new Box2DWorld();
    this.b2.createWalls(maze.walls, { kind: 'maze' });
    this.physics = new PhysicsWorld(); // geometry queries for AI (raycast / LOS / tracePath)
    this.physics.setWalls(maze.walls, maze.worldWidth, maze.worldHeight);
    this.graph = new MazeGraph(maze);

    this.tanks = [];
    this._bySlot = new Map();
    this.projectiles = [];
    this.mines = [];
    this.collectibles = [];
    this.beams = [];
    this.killLog = [];
    this._controllers = new Map();
    this.finished = false;
    this.winnerSlot = null;
  }

  emit(type, payload) {
    this.bus.emit(type, payload);
  }
  getTank(slot) {
    return this._bySlot.get(slot);
  }
  shortestPath(start, end, weightFn) {
    return this.graph.shortestPath(start, end, weightFn);
  }
  get aliveCount() {
    let n = 0;
    for (const t of this.tanks) if (t.alive) n++;
    return n;
  }

  addTank(player, spawn) {
    const body = this.b2.createTank({ kind: 'tank', slot: player.slot }, spawn.x, spawn.y, spawn.rotation);
    const tank = new B2Tank(player, body);
    body.GetFixtureList().GetUserData().gameObject.ref = tank;
    this.tanks.push(tank);
    this._bySlot.set(player.slot, tank);
    player.tank = tank;
    return tank;
  }
  setController(slot, controller) {
    this._controllers.set(slot, controller);
  }

  update(dt, acceptInput) {
    // 1. intents
    for (const t of this.tanks) {
      if (!t.alive) continue;
      if (acceptInput) {
        const c = this._controllers.get(t.slot);
        t.intent = c ? c.think(dt, this) : null;
      } else t.intent = null;
    }
    // 2. apply control + fire (spawns projectiles) pre-step
    for (const t of this.tanks) if (t.alive) t.applyControl(dt, this);
    // 3. step physics
    this.b2.step(dt);
    // 4. sync entity transforms from bodies
    for (const t of this.tanks) if (t.alive) t.syncFromBody();
    for (const p of this.projectiles) if (!p.dead) p.syncFromBody();
    for (const m of this.mines) if (!m.dead) m.syncFromBody();
    // 5. per-entity logic
    for (const t of this.tanks) if (t.alive) t.updateTimers(dt);
    for (const p of this.projectiles) if (!p.dead) p.update(dt, this);
    for (const m of this.mines) if (!m.dead) m.update(dt, this);
    for (const c of this.collectibles) if (!c.dead) c.update(dt);
    for (const b of this.beams) b.life -= dt;
    // 6. resolve contacts (kills / pickups)
    this._resolveContacts();
    // 7. reap
    this.projectiles = this.projectiles.filter((p) => !p.dead);
    this.mines = this.mines.filter((m) => !m.dead);
    this.collectibles = this.collectibles.filter((c) => !c.dead);
    this.beams = this.beams.filter((b) => b.life > 0);
    // 8. win check
    if (!this.finished && this.aliveCount <= 1 && this.tanks.length > 1) {
      this.finished = true;
      const s = this.tanks.find((t) => t.alive);
      this.winnerSlot = s ? s.slot : null;
      this.emit('round:decided', { winnerSlot: this.winnerSlot });
    }
  }

  _resolveContacts() {
    for (const c of this.b2.contacts) {
      const objs = [c.a, c.b];
      const proj = objs.find((o) => o.kind === 'projectile');
      const tankObj = objs.find((o) => o.kind === 'tank');
      const colObj = objs.find((o) => o.kind === 'collectible');
      if (proj && tankObj) this._projectileHitTank(proj.ref, tankObj.ref);
      else if (colObj && tankObj) this._pickup(colObj.ref, tankObj.ref);
    }
  }

  _projectileHitTank(p, tank) {
    if (!p || !tank || p.dead || !tank.alive) return;
    if (!p.isDeadlyTo(tank.slot)) return;
    if (tank.hasActiveShield) {
      // Own un-bounced shot passes through; otherwise reflect + arm.
      if (p.ownerSlot === tank.slot && !p.deadlyToOwner) return;
      const nx = p.position.x - tank.position.x;
      const ny = p.position.y - tank.position.y;
      const len = Math.hypot(nx, ny) || 1;
      const v = p.body.GetLinearVelocity();
      const dot = (v.x * nx + v.y * ny) / len;
      p.body.SetLinearVelocity(Box2DWorld.vec(v.x - 2 * dot * (nx / len), v.y - 2 * dot * (ny / len)));
      p.deadlyToOwner = true;
      return;
    }
    this._killTank(tank, p.ownerSlot);
    if (p.kind !== 'shrapnel') p.destroy(this);
  }

  _killTank(tank, killerSlot) {
    if (!tank.alive) return;
    tank.alive = false;
    this.killLog.push({ victim: tank.slot, killer: killerSlot });
    if (this.killLog.length > 16) this.killLog.shift();
    this.b2.destroyBody(tank.body);
    this.emit('tank:destroyed', { slot: tank.slot, killerSlot, colorKey: tank.colorKey, x: tank.position.x, y: tank.position.y });
  }

  _pickup(c, tank) {
    if (!c || !tank || c.dead || !tank.alive) return;
    if (c.category === CollectibleType.WEAPON_CRATE) {
      if (WeaponFactory.isUpgrade(c.kind)) {
        const has = (c.kind === 'shield' && tank.shield) || (c.kind === 'aimer' && tank.aimer) || (c.kind === 'speedBoost' && tank.speedBoost);
        if (has) return;
        WeaponFactory.applyUpgrade(c.kind, tank);
      } else {
        if (tank.queuedWeaponCount >= C.MAX_WEAPON_QUEUE) return;
        tank.giveWeapon(WeaponFactory.create(c.kind));
        if (c.kind === 'laser') tank.giveAimer();
      }
    }
    c.destroy(this);
    this.emit('collectible:picked', { type: c.category, slot: tank.slot });
  }

  // ── spawning (called by weapons / mines) ──────────────────────────────────
  spawnProjectile(cfg) {
    const gameObject = { kind: 'projectile' };
    const v = { x: Math.cos(cfg.angle) * cfg.speed, y: Math.sin(cfg.angle) * cfg.speed };
    const body = this.b2.createProjectile(gameObject, cfg.pos.x, cfg.pos.y, v.x, v.y, cfg.radius);
    const p = new B2Projectile(body, cfg);
    gameObject.ref = p;
    gameObject.id = p.id;
    this.projectiles.push(p);
    return p;
  }

  spawnMine({ ownerSlot, colorKey, pos }) {
    const gameObject = { kind: 'trap' };
    const tank = this.getTank(ownerSlot);
    const angle = tank ? tank.rotation + Math.PI : 0;
    const speed = C.WEAPONS.MINE.launchSpeed;
    const body = this.b2.createTrap(gameObject, pos.x, pos.y, C.WEAPONS.MINE.bodyRadius, Math.cos(angle) * speed, Math.sin(angle) * speed);
    const m = new B2Mine(body, ownerSlot, colorKey);
    gameObject.ref = m;
    this.mines.push(m);
    return m;
  }

  fireLaser(tank, angle) {
    const cfg = C.WEAPONS.LASER;
    const muzzle = tank.muzzle(C.TANK.BARREL_LENGTH);
    const tanksView = this.tanks.map((t) => ({ id: t.slot, position: t.position, radius: C.TANK.COLLISION_RADIUS }));
    const trace = this.physics.tracePath(muzzle.x, muzzle.y, angle, { maxBounces: 6, maxLength: 200, radius: 0, tanks: tanksView, ignoreTankId: tank.slot });
    if (trace.hitTank) {
      const victim = this.getTank(trace.hitTank.id);
      if (victim && !victim.hasActiveShield) this._killTank(victim, tank.slot);
    }
    this.beams.push({ points: trace.points, life: cfg.maxLifetime, max: cfg.maxLifetime, colorKey: tank.colorKey });
  }

  steerHomingMissile(proj, dt) {
    const target = this._homingTarget(proj);
    if (!target) return;
    const pt = this.maze.worldToTile(proj.position.x, proj.position.y);
    const tt = this.maze.worldToTile(target.position.x, target.position.y);
    const td = this.maze.tileDistance(pt.tx, pt.ty, tt.tx, tt.ty);
    let wx = target.position.x;
    let wy = target.position.y;
    if (td > 1 && td !== Infinity) {
      const path = this.graph.shortestPath({ tx: pt.tx, ty: pt.ty }, { tx: tt.tx, ty: tt.ty });
      if (path.length) {
        const cc = this.maze.tileCenter(path[0].x, path[0].y);
        wx = cc.x;
        wy = cc.y;
      }
    }
    const accel = C.WEAPONS.HOMING.accel;
    const v = proj.body.GetLinearVelocity();
    let dx = wx - proj.position.x;
    let dy = wy - proj.position.y;
    const len = Math.hypot(dx, dy) || 1;
    proj.body.SetLinearVelocity(Box2DWorld.vec(v.x + (dx / len) * accel * dt, v.y + (dy / len) * accel * dt));
    proj.targetSlot = target.slot;
  }

  _homingTarget(proj) {
    let best = null;
    let bestD = Infinity;
    const pt = this.maze.worldToTile(proj.position.x, proj.position.y);
    for (const t of this.tanks) {
      if (!t.alive) continue;
      const tt = this.maze.worldToTile(t.position.x, t.position.y);
      const d = this.maze.tileDistance(pt.tx, pt.ty, tt.tx, tt.ty) + (t.slot === proj.ownerSlot ? 0.5 : 0);
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

  addCollectible(spec) {
    const category = spec.category;
    const kind = spec.kind;
    const pos = spec.pos || spec.position;
    const rotation = spec.rotation || 0;
    const radius = category === CollectibleType.GOLD ? C.COLLECTIBLE.GOLD_RADIUS : category === CollectibleType.DIAMOND ? C.COLLECTIBLE.DIAMOND_W : C.COLLECTIBLE.CRATE_SIZE / 2;
    const gameObject = { kind: 'collectible' };
    const body = this.b2.createCollectible(gameObject, pos.x, pos.y, radius);
    const c = new B2Collectible(body, { category, kind, pos, rotation });
    gameObject.ref = c;
    this.collectibles.push(c);
    this.emit('collectible:spawned', { type: category });
    return c;
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
    this._controllers.clear();
    this._bySlot.clear();
  }
}
