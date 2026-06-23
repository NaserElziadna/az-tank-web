import { Entity } from './Entity.js';
import { Vector2 } from '../core/math/Vector2.js';
import { C } from '../constants/GameConstants.js';
import { NEUTRAL_INTENT } from '../core/input/ControlScheme.js';
import { BulletWeapon } from '../weapons/BulletWeapon.js';

/**
 * A tank in the round.
 *
 * Convention: `rotation` is a standard math angle; the barrel/forward direction
 * is (cos θ, sin θ). The tank drives along that axis and rotates in place
 * (no strafing), exactly like the original. Collisions use a circle proxy
 * (corridors are far wider than the tank, so this feels identical and never
 * wedges unfairly).
 *
 * The tank owns its weapon queue: a default infinite bullet gun plus up to
 * {@link C.MAX_WEAPON_QUEUE} picked-up weapons; the most-recently-acquired is
 * active and falls back down the queue as weapons deplete.
 */
export class TankEntity extends Entity {
  /** @param {import('../models/Player.js').Player} player */
  constructor(player) {
    super();
    this.player = player;
    this.slot = player.slot;
    this.colorKey = player.color;

    this.velocity = new Vector2();
    /** @type {import('../core/input/ControlScheme.js').ControlIntent} */
    this.intent = NEUTRAL_INTENT;

    this.defaultWeapon = new BulletWeapon();
    /** @type {import('../weapons/Weapon.js').Weapon[]} most-recent = active */
    this.weaponQueue = [];

    // Upgrades (timers in seconds; null = not held).
    this.shield = null; // { time, weaken }
    this.speedBoost = null; // { time }
    this.aimer = null; // { time, length }

    this.locked = false; // movement disabled (laser charge)
    this.alive = true;
    this.treadOffset = 0; // animated tread scroll (visual only)

    // Stuck detection (for AI).
    this.stuck = false;
    this.stuckNormal = new Vector2();
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

  /** Direction the barrel points. */
  get forward() {
    return new Vector2(Math.cos(this.rotation), Math.sin(this.rotation));
  }

  /** World position of the muzzle for a given barrel offset (m). */
  muzzle(offset) {
    return new Vector2(
      this.position.x + Math.cos(this.rotation) * offset,
      this.position.y + Math.sin(this.rotation) * offset,
    );
  }

  /** @param {import('../weapons/Weapon.js').Weapon} weapon */
  giveWeapon(weapon) {
    this.weaponQueue.push(weapon);
    if (this.weaponQueue.length > C.MAX_WEAPON_QUEUE) this.weaponQueue.shift();
  }

  giveShield(spawn = false) {
    const cfg = spawn ? C.UPGRADES.SPAWN_SHIELD : C.UPGRADES.SHIELD;
    this.shield = { time: cfg.lifetime, weaken: cfg.weakenTime };
  }

  giveSpeedBoost() {
    this.speedBoost = { time: C.UPGRADES.SPEED_BOOST.lifetime };
  }

  giveAimer() {
    this.aimer = { time: C.UPGRADES.AIMER.lifetime, length: C.UPGRADES.AIMER.length };
  }

  /** @param {number} dt @param {import('../game/round/RoundSimulation.js').RoundSimulation} sim */
  update(dt, sim) {
    this.savePrevious();
    const intent = this.intent || NEUTRAL_INTENT;

    this.locked = this.activeWeapon.movementLocked?.() ?? false;

    // ── rotate + drive ──
    let driven = 0;
    if (!this.locked) {
      this.rotation += intent.turn * C.TANK.ROTATION_SPEED * dt;
      if (intent.drive !== 0) {
        const speed = (intent.drive > 0 ? C.TANK.FORWARD_SPEED : -C.TANK.BACK_SPEED) * this.speedModifier;
        this.velocity.set(Math.cos(this.rotation), Math.sin(this.rotation)).scale(speed);
        this.position.addScaled(this.velocity, dt);
        driven = intent.drive;
      } else {
        this.velocity.set(0, 0);
      }
    } else {
      this.velocity.set(0, 0);
    }

    // ── resolve walls ──
    const res = sim.physics.resolveCircle(this.position, C.TANK.COLLISION_RADIUS);
    this.stuck = res.collided && driven !== 0;
    if (res.collided) this.stuckNormal.set(res.nx, res.ny);

    // ── tread animation (visual) ──
    this.treadOffset += (driven * C.TANK.FORWARD_SPEED + Math.abs(intent.turn) * 4) * dt;

    // ── upgrades countdown ──
    if (this.shield) {
      this.shield.time -= dt;
      if (this.shield.time <= 0) this.shield = null;
    }
    if (this.speedBoost) {
      this.speedBoost.time -= dt;
      if (this.speedBoost.time <= 0) this.speedBoost = null;
    }
    if (this.aimer) {
      this.aimer.time -= dt;
      if (this.aimer.time <= 0) this.aimer = null;
    }

    // ── weapons ──
    this.defaultWeapon.update(dt);
    for (const w of this.weaponQueue) w.update(dt);

    // Fire control.
    if (!this.locked || this.activeWeapon.movementLocked?.()) {
      if (intent.fire) this.activeWeapon.onTriggerDown(this, sim);
      else this.activeWeapon.onTriggerUp(this, sim);
    }

    // Drop depleted picked-up weapons (default never depletes).
    for (let i = this.weaponQueue.length - 1; i >= 0; i--) {
      if (this.weaponQueue[i].isDepleted()) this.weaponQueue.splice(i, 1);
    }
  }
}
