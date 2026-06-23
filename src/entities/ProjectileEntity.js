import { Entity } from './Entity.js';
import { Vector2 } from '../core/math/Vector2.js';
import { C } from '../constants/GameConstants.js';

/**
 * A flying projectile: bullet, buckshot pellet, gatling round, homing missile,
 * or mine shrapnel — distinguished by `kind` and a handful of behaviour flags
 * rather than a deep class tree (keeps the pool homogeneous and the physics in
 * one place).
 *
 * It owns its own movement: a swept ray-march that bounces off walls preserving
 * speed (restitution 1). Tank kills are resolved by the round simulation, which
 * is the only thing that knows where the tanks are.
 *
 * The signature mechanic — your own ricochet can kill you — falls out of
 * `deadlyToOwner` flipping true on the first wall bounce.
 */
export class ProjectileEntity extends Entity {
  constructor() {
    super();
    this.velocity = new Vector2();
    this.reset();
  }

  reset() {
    this.kind = 'bullet';
    this.ownerSlot = -1;
    this.radius = C.WEAPONS.BULLET.radius;
    this.maxLifetime = C.WEAPONS.BULLET.maxLifetime;
    this.timeAlive = 0;
    this.velocity.set(0, 0);
    this._initialSpeed = 0;

    this.bounceCount = 0;
    this._bounceTimes = [];
    this.hasBounced = false;

    this.deadlyToOwner = false;
    this.constantSpeed = true;
    this.stopsOnWall = false;
    this.drag = 0; // per-second fractional velocity loss (shrapnel)
    this.lifetimeAfterHit = null;

    this.homing = false;
    this.activationTime = 0;
    this.activated = true;
    this.targetSlot = -1;

    this.colorKey = null; // owner palette for rendering
    this.alive = true;
    this.dead = false;
    this.rotation = 0;
  }

  /** @param {{x:number,y:number}} pos @param {number} angle @param {number} speed */
  launch(pos, angle, speed) {
    this.position.set(pos.x, pos.y);
    this.prevPosition.copy(this.position);
    this.velocity.set(Math.cos(angle) * speed, Math.sin(angle) * speed);
    this._initialSpeed = speed;
    this.rotation = angle;
  }

  get speed() {
    return this.velocity.length();
  }

  /** @param {number} dt @param {import('../game/round/RoundSimulation.js').RoundSimulation} sim */
  update(dt, sim) {
    this.savePrevious();
    this.timeAlive += dt;
    if (this.timeAlive >= this.maxLifetime) {
      this.destroy();
      return;
    }

    // Homing: arm + steer toward the maze-nearest tank once activated.
    if (this.homing) {
      if (!this.activated && this.timeAlive >= this.activationTime) {
        this.activated = true;
        this.deadlyToOwner = true;
      }
      if (this.activated) sim.steerHomingMissile(this, dt);
    }

    // Shrapnel drag → range-limited; dies when nearly stopped.
    if (this.drag > 0) {
      const f = Math.pow(1 - this.drag, dt * 60);
      this.velocity.scale(f);
      if (this.velocity.lengthSq() < 0.25) {
        this.destroy();
        return;
      }
    }

    // Renormalise to constant speed (homing steering inflates magnitude) BEFORE moving.
    if (this.constantSpeed && this._initialSpeed > 0) {
      const len = this.velocity.length();
      if (len > 1e-4) this.velocity.scale(this._initialSpeed / len);
    }

    this._sweepMove(dt, sim.physics);

    this.rotation = this.velocity.angle();
    this._pruneBounces();
    if (this._bounceTimes.length >= C.PROJECTILE.BOUNCE_TIMEOUT_COUNT) this.destroy();
  }

  /**
   * Swept ray-march with wall reflection. Speed is constant within the step
   * (reflection preserves magnitude), so we carry one `speed` scalar and only
   * rotate the unit direction on each bounce, writing the velocity back once.
   */
  _sweepMove(dt, physics) {
    const speed = this.velocity.length();
    if (speed <= 1e-6) return;
    let dirX = this.velocity.x / speed;
    let dirY = this.velocity.y / speed;
    let remaining = speed * dt;

    for (let iter = 0; iter < 6 && remaining > 1e-5; iter++) {
      const hit = physics.raycastWalls(this.position.x, this.position.y, dirX, dirY, remaining, this.radius);
      if (!hit) {
        this.position.x += dirX * remaining;
        this.position.y += dirY * remaining;
        break;
      }
      // Advance to just shy of the wall.
      const travel = Math.max(0, hit.t - 1e-4);
      this.position.x += dirX * travel;
      this.position.y += dirY * travel;
      remaining -= hit.t;

      this._onWallHit();
      if (this.dead) {
        this.velocity.set(dirX * speed, dirY * speed);
        return;
      }
      if (this.stopsOnWall) {
        this.velocity.set(0, 0);
        this.destroy();
        return;
      }

      // Reflect the (unit) direction about the wall normal.
      const dot = dirX * hit.nx + dirY * hit.ny;
      dirX -= 2 * dot * hit.nx;
      dirY -= 2 * dot * hit.ny;
      // Nudge off the surface to avoid re-hitting the same wall this step.
      this.position.x += dirX * 1e-3;
      this.position.y += dirY * 1e-3;
    }

    this.velocity.set(dirX * speed, dirY * speed);
  }

  _onWallHit() {
    this.bounceCount++;
    this.hasBounced = true;
    this._bounceTimes.push(this.timeAlive);
    // After the first wall bounce a normal projectile can kill its own firer.
    this.deadlyToOwner = true;
    if (this.lifetimeAfterHit != null) {
      // Clamp remaining life (shotgun: short-range — vanish soon after first bounce).
      this.maxLifetime = Math.min(this.maxLifetime, this.timeAlive + this.lifetimeAfterHit);
    }
  }

  _pruneBounces() {
    const cutoff = this.timeAlive - C.PROJECTILE.BOUNCE_TIMEOUT_WINDOW;
    while (this._bounceTimes.length && this._bounceTimes[0] < cutoff) this._bounceTimes.shift();
  }

  /** Will this projectile kill `slot` if it overlaps that tank? */
  isDeadlyTo(slot) {
    if (slot === this.ownerSlot) return this.deadlyToOwner;
    return true;
  }
}
