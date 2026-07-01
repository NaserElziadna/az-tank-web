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
    this.lethal = !!player.lethal;
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
    // Lethal tank: keeps more bullets in the air and has a permanent aimer.
    this.bulletCap = this.lethal ? C.LETHAL.bulletCap : C.WEAPONS.BULLET.ammo;
    this.aimer = this.lethal ? { time: Infinity, length: C.UPGRADES.AIMER.length } : null;
    // Health: tanks now take damage instead of dying in one hit.
    this.maxHp = this.lethal ? C.HEALTH.lethal : C.HEALTH.normal;
    this.hp = this.maxHp;
    // One-use activatable powerup held in a dedicated slot + its active timers.
    this.ability = null; // kind string or null
    this.rapidFireTimer = 0;
    this.phaseTimer = 0;
    this.phasing = false;
    this.reconTimer = 0;
    this.locked = false;
    this.alive = true;
    this.stuck = false;
    this.treadOffset = 0;
    this.spawnAnim = 0; // 0→1 fade/scale-in
    this._bumpCd = 0; // throttle wall-bump dust/SFX
  }

  get hasAbility() {
    return this.ability != null;
  }
  get abilityActive() {
    return this.rapidFireTimer > 0 || this.phaseTimer > 0 || this.reconTimer > 0;
  }
  giveAbility(kind) {
    this.ability = kind;
  }
  /** Fire the held one-use ability (consumed). */
  activateAbility(sim) {
    const kind = this.ability;
    if (!kind) return;
    this.ability = null;
    sim.emit('ability:activate', { kind, slot: this.slot });
    if (kind === 'megaLaser') {
      sim.fireMegaLaser(this);
    } else if (kind === 'rapidFire') {
      this.rapidFireTimer = C.ABILITIES.RAPID_FIRE.duration;
    } else if (kind === 'phase') {
      this.phaseTimer = C.ABILITIES.PHASE.duration;
      sim.setPhasing(this, true);
    } else if (kind === 'recon') {
      this.reconTimer = C.ABILITIES.RECON.duration;
      this.aimer = { time: Math.max(this.aimer ? this.aimer.time : 0, C.ABILITIES.RECON.duration), length: C.UPGRADES.AIMER.length };
    }
  }

  get activeWeapon() {
    return this.weaponQueue.length ? this.weaponQueue[this.weaponQueue.length - 1] : this.defaultWeapon;
  }
  get queuedWeaponCount() {
    return this.weaponQueue.length;
  }
  get speedModifier() {
    return 1 + (this.speedBoost ? C.UPGRADES.SPEED_BOOST.effect : 0) + (this.lethal ? C.LETHAL.speedBonus : 0);
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
        // Drive straight along the facing; the circular collider lets Box2D slide
        // the tank along any wall it contacts (and stop head-on) on its own.
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
    // Activate the held one-use ability on the rising edge.
    if (intent && intent.abilityPressed && this.ability) this.activateAbility(sim);
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

  updateTimers(dt, sim) {
    if (this.spawnAnim < 1) this.spawnAnim = Math.min(1, this.spawnAnim + dt * 4); // ~0.25s
    if (this._bumpCd > 0) this._bumpCd -= dt;
    if (this.rapidFireTimer > 0) this.rapidFireTimer -= dt;
    if (this.reconTimer > 0) this.reconTimer -= dt;
    if (this.phaseTimer > 0) {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        // Only solidify again once clear of walls, else stay ghostly a touch longer
        // so we never re-materialise stuck inside a wall.
        if (sim && sim._tankInWall(this)) this.phaseTimer = 0.12;
        else if (sim) sim.setPhasing(this, false);
      }
    }
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
    this.damage = cfg.damage ?? 1;
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
        damage: cfg.shrapnelDamage,
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
    // Online: with revive on, killed bots respawn while a human is alive, so a
    // round ends on human elimination rather than a bots-only last-tank duel.
    this.reviveBots = false;
    this.allHumansDead = false; // round ended by a simultaneous human wipe (no winner)
    this._time = 0; // sim clock (s) for scheduling revives
    this._reviveQueue = []; // [{slot, at}] dead bots awaiting respawn
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
  /** Tanks belonging to real players (a disconnected human's AI stand-in still counts). */
  get humanCount() {
    let n = 0;
    for (const t of this.tanks) if (t.player.isHuman) n++;
    return n;
  }
  get humansAlive() {
    let n = 0;
    for (const t of this.tanks) if (t.alive && t.player.isHuman) n++;
    return n;
  }

  addTank(player, spawn) {
    const body = this.b2.createTank({ kind: 'tank', slot: player.slot }, spawn.x, spawn.y, spawn.rotation);
    const tank = new B2Tank(player, body);
    tank.spawn = { x: spawn.x, y: spawn.y, rotation: spawn.rotation }; // reused on revive
    body.GetFixtureList().GetUserData().gameObject.ref = tank;
    this.tanks.push(tank);
    this._bySlot.set(player.slot, tank);
    player.tank = tank;
    return tank;
  }

  /**
   * Recreate a dead bot's body at its spawn and reset it to full fighting trim.
   * Death destroyed the Box2D body ({@link _killTank}), so this is a full rebuild,
   * not an `alive = true` flip. Emits `tank:revived` for the spawn-in effect.
   */
  reviveTank(slot) {
    const tank = this._bySlot.get(slot);
    if (!tank || tank.alive) return;
    const spawn = tank.spawn || this.maze.tankSpawns[0];
    const body = this.b2.createTank({ kind: 'tank', slot }, spawn.x, spawn.y, spawn.rotation);
    body.GetFixtureList().GetUserData().gameObject.ref = tank;
    tank.body = body;
    tank.position.set(spawn.x, spawn.y);
    tank.prevPosition.copy(tank.position);
    tank.rotation = spawn.rotation;
    tank.prevRotation = spawn.rotation;
    tank.velocity.set(0, 0);
    tank.hp = tank.maxHp;
    tank.alive = true;
    tank.spawnAnim = 0; // fade/scale-in
    tank.intent = null;
    // Drop any transient state the old life was carrying.
    tank.weaponQueue = [];
    tank.shield = null;
    tank.speedBoost = null;
    tank.rapidFireTimer = 0;
    tank.phaseTimer = 0;
    tank.phasing = false;
    tank.reconTimer = 0;
    tank.ability = null;
    tank.locked = false;
    tank.stuck = false;
    tank._bumpCd = 0;
    this.emit('tank:revived', { slot, colorKey: tank.colorKey, x: spawn.x, y: spawn.y });
  }
  setController(slot, controller) {
    this._controllers.set(slot, controller);
  }

  update(dt, acceptInput) {
    this._time += dt;
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
    for (const t of this.tanks) if (t.alive) t.updateTimers(dt, this);
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
    // 7b. respawn any due bots (only while a human is still in the fight)
    this._processRevives();
    // 8. win check
    this._checkFinished();
  }

  /** Bring back queued bots whose respawn delay has elapsed, if a human remains. */
  _processRevives() {
    if (this._reviveQueue.length === 0) return;
    const due = [];
    this._reviveQueue = this._reviveQueue.filter((r) => {
      if (this._time < r.at) return true;
      due.push(r.slot);
      return false;
    });
    if (!due.length) return;
    const humanAlive = this.humansAlive > 0;
    for (const slot of due) if (humanAlive) this.reviveTank(slot); // else let the round end
  }

  /**
   * Decide the round. Online is player-vs-player, so the round resolves on human
   * elimination: the last human alive wins (you never sit watching bots fight).
   * Falls back to the classic last-tank-standing rule when there are no humans.
   */
  _checkFinished() {
    if (this.finished) return;
    // A lone tank (solo human with no bots, or everyone left but one) can't be
    // resolved by the elimination rules below, so end the round directly — a
    // match must never hang. Winner is the survivor, if any.
    if (this.tanks.length <= 1) {
      this.finished = true;
      const s = this.tanks.find((t) => t.alive);
      this.winnerSlot = s ? s.slot : null;
      this.emit('round:decided', { winnerSlot: this.winnerSlot });
      return;
    }
    const humanCount = this.humanCount;
    if (humanCount >= 2) {
      const alive = this.humansAlive;
      if (alive === 0) {
        // Simultaneous wipe — no winner; the match replays the round.
        this.finished = true;
        this.allHumansDead = true;
        this.winnerSlot = null;
        this.emit('round:decided', { winnerSlot: null });
      } else if (alive <= 1) {
        this.finished = true;
        const s = this.tanks.find((t) => t.alive && t.player.isHuman);
        this.winnerSlot = s ? s.slot : null;
        this.emit('round:decided', { winnerSlot: this.winnerSlot });
      }
    } else if (this.aliveCount <= 1 && this.tanks.length > 1) {
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
      const wallObj = objs.find((o) => o.kind === 'wall');
      const trapObj = objs.find((o) => o.kind === 'trap');
      if (proj && tankObj) this._projectileHitTank(proj.ref, tankObj.ref);
      else if (colObj && tankObj) this._pickup(colObj.ref, tankObj.ref);
      else if (trapObj && tankObj) this._mineTouch(trapObj.ref, tankObj.ref);
      else if (wallObj && tankObj) this._tankBump(tankObj.ref);
    }
  }

  /** An armed mine touched by any tank trips immediately (then fuses to detonate). */
  _mineTouch(mine, tank) {
    if (!mine || mine.dead || !tank || !tank.alive) return;
    if (mine.state !== 'armed') return; // still arming, or already tripped
    mine.state = 'tripped';
    this.emit('mine:tripped', { x: mine.position.x, y: mine.position.y });
  }

  /** Dust + thud when a tank drives into a wall (throttled per tank). */
  _tankBump(tank) {
    if (!tank || !tank.alive || tank._bumpCd > 0) return;
    const drive = tank._drive || 0;
    if (drive === 0) return; // only when actually pushing into the wall
    tank._bumpCd = 0.16;
    const dir = Math.sign(drive);
    const x = tank.position.x + Math.cos(tank.rotation) * 1.9 * dir;
    const y = tank.position.y + Math.sin(tank.rotation) * 1.9 * dir;
    this.emit('tank:bump', { x, y });
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
    this._damageTank(tank, p.damage, p.ownerSlot);
    if (p.kind !== 'shrapnel') p.destroy(this);
  }

  /** Apply damage; kill only when HP runs out. */
  _damageTank(tank, amount, killerSlot) {
    if (!tank.alive) return;
    tank.hp -= amount;
    this.emit('tank:damaged', {
      slot: tank.slot,
      x: tank.position.x,
      y: tank.position.y,
      colorKey: tank.colorKey,
      hp: Math.max(0, tank.hp),
      maxHp: tank.maxHp,
    });
    if (tank.hp <= 0) this._killTank(tank, killerSlot);
  }

  _killTank(tank, killerSlot) {
    if (!tank.alive) return;
    tank.alive = false;
    this.killLog.push({ victim: tank.slot, killer: killerSlot });
    if (this.killLog.length > 16) this.killLog.shift();
    this.b2.destroyBody(tank.body);
    this.emit('tank:destroyed', { slot: tank.slot, killerSlot, colorKey: tank.colorKey, x: tank.position.x, y: tank.position.y });
    // Revive a fallen bot after a short delay, but ONLY in a genuine ≥2-human
    // match: revive keeps live opponents around so a bots-only duel can't decide
    // a human-vs-human round. In a solo (1-human) game it would make the round
    // unwinnable (bots respawn forever), so there it stays classic last-tank-
    // standing — the human wins by clearing every bot.
    if (this.reviveBots && this.humanCount >= 2 && !tank.player.isHuman && this.humansAlive > 0) {
      this._reviveQueue.push({ slot: tank.slot, at: this._time + C.FLOW.REVIVE_DELAY });
    }
  }

  _pickup(c, tank) {
    if (!c || !tank || c.dead || !tank.alive) return;
    if (c.category === CollectibleType.WEAPON_CRATE) {
      if (WeaponFactory.isAbility(c.kind)) {
        if (tank.hasAbility) return; // one ability slot — keep the one we have
        tank.giveAbility(c.kind);
      } else if (WeaponFactory.isUpgrade(c.kind)) {
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
    if (cfg.kind !== 'shrapnel') this.emit('weapon:flash', { x: cfg.pos.x, y: cfg.pos.y });
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
      if (victim && !victim.hasActiveShield) this._damageTank(victim, cfg.damage, tank.slot);
    }
    this.beams.push({ points: trace.points, life: cfg.maxLifetime, max: cfg.maxLifetime, colorKey: tank.colorKey });
  }

  /** Mega-laser ability: a short straight beam that ignores walls and damages
   *  every enemy tank along it (the wall-piercing close-range finisher). */
  fireMegaLaser(tank) {
    const cfg = C.ABILITIES.MEGA_LASER;
    const m = tank.muzzle(C.TANK.BARREL_LENGTH);
    const ex = m.x + Math.cos(tank.rotation) * cfg.range;
    const ey = m.y + Math.sin(tank.rotation) * cfg.range;
    const hitR = cfg.width + C.TANK.COLLISION_RADIUS;
    for (const t of this.tanks) {
      if (!t.alive || t.slot === tank.slot || t.hasActiveShield) continue;
      if (segPointDist(t.position.x, t.position.y, m.x, m.y, ex, ey) <= hitR) {
        this._damageTank(t, cfg.damage, tank.slot);
      }
    }
    this.beams.push({ points: [{ x: m.x, y: m.y }, { x: ex, y: ey }], life: cfg.maxLifetime, max: cfg.maxLifetime, colorKey: tank.colorKey, mega: true });
    this.emit('weapon:fire', { weapon: 'laser' });
  }

  /** Toggle whether a tank collides with maze walls (phase ability). */
  setPhasing(tank, on) {
    tank.phasing = on;
    this.b2.setTankMazeCollision(tank.body, !on);
  }

  /** True if the tank's body circle currently overlaps any maze wall. */
  _tankInWall(tank) {
    const r = C.TANK.COLLISION_RADIUS;
    const x = tank.position.x;
    const y = tank.position.y;
    for (const w of this.maze.walls) {
      const cx = Math.max(w.minX, Math.min(x, w.maxX));
      const cy = Math.max(w.minY, Math.min(y, w.maxY));
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy < r * r) return true;
    }
    return false;
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

/** Shortest distance from point (px,py) to segment (ax,ay)-(bx,by). */
function segPointDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}
