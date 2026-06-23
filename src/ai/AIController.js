import { profileFor, lerpTrait } from './AIProfile.js';
import { Pathfinder } from '../maze/Pathfinder.js';
import { wrapAngle, clamp } from '../core/math/MathUtils.js';
import { rng } from '../core/math/Random.js';
import { C } from '../constants/GameConstants.js';

const TILE = C.MAZE.TILE_SIZE;

/**
 * Drives an AI tank. Produces the same {@link ControlIntent} shape a human
 * keyboard does, so the tank treats AI and human identically.
 *
 * Each step it picks the highest-value goal — dodge an incoming shot, attack a
 * target (including banking shots off walls), grab a crate, hunt, or wander —
 * then turns that goal into steering + trigger input. All thresholds scale with
 * the personality traits, so EASY bots are short-sighted and twitchy while HARD
 * bots plan bank-shots and dodge early.
 */
export class AIController {
  /** @param {import('../models/Player.js').Player} player */
  constructor(player) {
    this.player = player;
    this.slot = player.slot;
    this.t = profileFor(player.difficulty);

    this.path = []; // tile waypoints {x,y}
    this.repathTimer = 0;
    this.fireCooldown = 0;
    this.releaseFrames = 0; // forces a trigger release so single-shot guns re-fire
    this.unstuckTimer = 0;
    this.wanderTimer = 0;
    this.goal = 'wander';
  }

  /**
   * @param {number} dt
   * @param {import('../game/round/RoundSimulation.js').RoundSimulation} sim
   * @returns {import('../core/input/ControlScheme.js').ControlIntent}
   */
  think(dt, sim) {
    const tank = sim.getTank(this.slot);
    if (!tank || !tank.alive) return { drive: 0, turn: 0, fire: false, firePressed: false };

    this.fireCooldown -= dt;
    this.repathTimer -= dt;
    this.wanderTimer -= dt;
    if (this.releaseFrames > 0) this.releaseFrames--;

    // Unstuck overrides everything for a short burst.
    if (tank.stuck) this.unstuckTimer = 0.45;
    if (this.unstuckTimer > 0) {
      this.unstuckTimer -= dt;
      return { drive: -1, turn: this.slot % 2 === 0 ? 1 : -1, fire: false, firePressed: false };
    }

    const myTile = sim.maze.worldToTile(tank.position.x, tank.position.y);

    // ── 1. dodge incoming fire ──
    const threat = this._threat(tank, sim);
    if (threat) {
      return this._dodge(tank, sim, threat);
    }

    // ── 2. pick a target / objective ──
    const enemy = this._nearestEnemy(tank, sim);
    const crate = this._nearestCrate(tank, sim, myTile);

    let intent = { drive: 0, turn: 0, fire: false, firePressed: false };

    // Aim & fire if we have a target and a firing solution.
    let aim = null;
    if (enemy) aim = this._aimSolution(tank, sim, enemy.tank);

    const crateDist = crate ? sim.maze.tileDistance(myTile.tx, myTile.ty, crate.tile.x, crate.tile.y) : Infinity;
    const wantCrate =
      crate && tank.queuedWeaponCount < C.MAX_WEAPON_QUEUE && crateDist <= lerpTrait(4, 10, this.t.greediness);

    if (aim && aim.fire) {
      // Hold position-ish and shoot.
      this.goal = 'attack';
      intent.turn = this._aimTurn(tank, aim.angle);
      // Creep toward enemy if far, but mostly settle to aim.
      if (enemy.worldDist > 14 && Math.abs(wrapAngle(aim.angle - tank.rotation)) < 0.4) intent.drive = 0.5;
      intent = this._applyFire(tank, intent, true);
    } else if (wantCrate) {
      this.goal = 'crate';
      intent = this._follow(tank, sim, crate.tile, myTile);
    } else if (enemy && enemy.tileDist <= lerpTrait(6, 22, this.t.cleverness)) {
      this.goal = 'hunt';
      intent = this._follow(tank, sim, enemy.tile, myTile);
      // Opportunistic aim while moving.
      if (aim) intent.turn = this._blendTurn(intent.turn, this._aimTurn(tank, aim.angle));
      if (aim && aim.fire) intent = this._applyFire(tank, intent, true);
    } else {
      this.goal = 'wander';
      intent = this._wander(tank, sim, myTile);
    }

    return intent;
  }

  // ── targeting ──────────────────────────────────────────────────────────
  _nearestEnemy(tank, sim) {
    let best = null;
    for (const other of sim.tanks) {
      if (other.slot === this.slot || !other.alive) continue;
      if (other.hasActiveShield) continue;
      const ot = sim.maze.worldToTile(other.position.x, other.position.y);
      const mt = sim.maze.worldToTile(tank.position.x, tank.position.y);
      const td = sim.maze.tileDistance(mt.tx, mt.ty, ot.tx, ot.ty);
      if (td === Infinity) continue;
      if (!best || td < best.tileDist) {
        best = { tank: other, tile: { x: ot.tx, y: ot.ty }, tileDist: td, worldDist: tank.position.distanceTo(other.position) };
      }
    }
    return best;
  }

  _nearestCrate(tank, sim, myTile) {
    let best = null;
    for (const c of sim.collectibles) {
      const ct = sim.maze.worldToTile(c.position.x, c.position.y);
      const d = sim.maze.tileDistance(myTile.tx, myTile.ty, ct.tx, ct.ty);
      if (d === Infinity) continue;
      if (!best || d < best.dist) best = { col: c, tile: { x: ct.tx, y: ct.ty }, dist: d };
    }
    return best;
  }

  /** Search a fan of angles for a shot (direct or banked) that reaches the enemy. */
  _aimSolution(tank, sim, enemy) {
    const cleverness = this.t.cleverness;
    const numAngles = 1 + 2 * Math.round(lerpTrait(0, 2, cleverness)); // odd: 1,3,5
    const spread = lerpTrait(0.5, 1.6, this.t.aggressiveness);
    const bounces = Math.round(lerpTrait(1, 5, cleverness));
    const length = TILE * lerpTrait(3, 8, cleverness);
    const muzzle = tank.muzzle(C.TANK.BARREL_LENGTH);

    let best = null;
    for (let i = 0; i < numAngles; i++) {
      const offset = numAngles === 1 ? 0 : (i / (numAngles - 1) - 0.5) * spread;
      const angle = tank.rotation + offset;
      const trace = sim.physics.tracePath(muzzle.x, muzzle.y, angle, {
        maxBounces: bounces,
        maxLength: length,
        radius: C.WEAPONS.BULLET.radius,
        tanks: sim.tanks.map((t) => ({ id: t.slot, position: t.position, radius: C.TANK.COLLISION_RADIUS })),
        ignoreTankId: tank.slot,
      });
      if (trace.hitTank && trace.hitTank.id === enemy.slot) {
        // Avoid suicidal point-blank wall shots.
        if (trace.firstSegmentLength < 3 && trace.length > trace.firstSegmentLength + 0.5) continue;
        if (!best || trace.length < best.length) best = { angle, length: trace.length };
      }
    }
    if (!best) return null;

    const headingErr = Math.abs(wrapAngle(best.angle - tank.rotation));
    const fireTolerance = lerpTrait(0.08, 0.5, this.t.aggressiveness);
    const fireDist = lerpTrait(8, 22, this.t.aggressiveness);
    const fire = headingErr < fireTolerance && best.length < fireDist;
    return { angle: best.angle, fire };
  }

  _applyFire(tank, intent, want) {
    if (!want) return intent;
    const auto = tank.activeWeapon.type === 'gatling' || tank.activeWeapon.type === 'laser';
    // Forced-release window lets single-shot guns re-arm; cooldown spaces shots.
    if (this.releaseFrames > 0 || (!auto && this.fireCooldown > 0)) {
      intent.fire = false;
      return intent;
    }
    intent.fire = true;
    intent.firePressed = true;
    if (!auto) {
      this.fireCooldown = lerpTrait(0.55, 0.15, this.t.dexterity);
      this.releaseFrames = 2; // release the trigger briefly so the next press registers
    }
    return intent;
  }

  // ── threat / dodge ────────────────────────────────────────────────────────
  _threat(tank, sim) {
    const scary = lerpTrait(4, 14, this.t.boldness === undefined ? 0.5 : 1 - this.t.boldness);
    const horizon = 1.1; // seconds of lookahead
    let worst = null;
    for (const p of sim.projectiles) {
      if (!p.isDeadlyTo(this.slot)) continue;
      const v = p.velocity;
      const speed = v.length();
      if (speed < 0.1) continue;
      const dhx = v.x / speed;
      const dhy = v.y / speed;
      const maxLen = speed * horizon;
      const relx = tank.position.x - p.position.x;
      const rely = tank.position.y - p.position.y;
      let proj = relx * dhx + rely * dhy;
      proj = clamp(proj, 0, maxLen);
      const cx = p.position.x + dhx * proj;
      const cy = p.position.y + dhy * proj;
      const dist = Math.hypot(tank.position.x - cx, tank.position.y - cy);
      if (dist > scary) continue;
      if (!sim.physics.lineOfSight(p.position.x, p.position.y, cx, cy)) continue;
      const time = proj / speed;
      const danger = (scary - dist) / scary + (horizon - time) / horizon;
      if (!worst || danger > worst.danger) worst = { dir: { x: dhx, y: dhy }, danger, dist };
    }
    return worst;
  }

  _dodge(tank, sim, threat) {
    this.goal = 'dodge';
    // Sidestep perpendicular to the incoming shot; pick the clearer side.
    const px = -threat.dir.y;
    const py = threat.dir.x;
    const probe = 4;
    const losPos = sim.physics.lineOfSight(tank.position.x, tank.position.y, tank.position.x + px * probe, tank.position.y + py * probe);
    const sx = losPos ? px : -px;
    const sy = losPos ? py : -py;
    const targetX = tank.position.x + sx * probe;
    const targetY = tank.position.y + sy * probe;
    const intent = this._driveTo(tank, targetX, targetY, true);
    // Opportunistic retaliation while dodging.
    const enemy = this._nearestEnemy(tank, sim);
    if (enemy) {
      const aim = this._aimSolution(tank, sim, enemy.tank);
      if (aim && aim.fire) return this._applyFire(tank, intent, true);
    }
    return intent;
  }

  // ── movement ────────────────────────────────────────────────────────────
  _follow(tank, sim, targetTile, myTile) {
    if (this.repathTimer <= 0 || this.path.length === 0) {
      this.repathTimer = 0.3;
      const threatWeight = lerpTrait(0.1, 1.2, this.t.cleverness);
      this.path = Pathfinder.shortestPath(
        sim.maze,
        { tx: myTile.tx, ty: myTile.ty },
        { tx: targetTile.x, ty: targetTile.y },
        (tx, ty) => sim.maze.deadEndPenalty(tx, ty) * threatWeight,
        0.1,
      );
    }
    // Drop the waypoint once reached.
    while (this.path.length) {
      const wp = this.path[0];
      const c = sim.maze.tileCenter(wp.x, wp.y);
      if (tank.position.distanceToSq(c) < 9) this.path.shift();
      else break;
    }
    if (this.path.length === 0) {
      const c = sim.maze.tileCenter(targetTile.x, targetTile.y);
      return this._driveTo(tank, c.x, c.y, false);
    }
    const next = this.path[0];
    const c = sim.maze.tileCenter(next.x, next.y);
    return this._driveTo(tank, c.x, c.y, this.path.length <= 1);
  }

  _wander(tank, sim, myTile) {
    if (this.wanderTimer <= 0 || this.path.length === 0) {
      this.wanderTimer = rng.range(1.5, 3.5);
      const tiles = sim.maze.reachableTiles();
      const far = tiles.filter((t) => sim.maze.tileDistance(myTile.tx, myTile.ty, t.x, t.y) >= 2);
      const target = far.length ? rng.pick(far) : rng.pick(tiles);
      this.path = Pathfinder.shortestPath(sim.maze, { tx: myTile.tx, ty: myTile.ty }, { tx: target.x, ty: target.y });
    }
    while (this.path.length) {
      const wp = this.path[0];
      const c = sim.maze.tileCenter(wp.x, wp.y);
      if (tank.position.distanceToSq(c) < 9) this.path.shift();
      else break;
    }
    if (this.path.length === 0) return { drive: 0, turn: rng.range(-1, 1), fire: false, firePressed: false };
    const c = sim.maze.tileCenter(this.path[0].x, this.path[0].y);
    return this._driveTo(tank, c.x, c.y, false);
  }

  _driveTo(tank, tx, ty, canReverse) {
    const jitter = (rng.next() - 0.5) * lerpTrait(0.3, 0, this.t.dexterity);
    const desired = Math.atan2(ty - tank.position.y, tx - tank.position.x) + jitter;
    const dist = Math.hypot(tx - tank.position.x, ty - tank.position.y);
    const dead = 0.12;

    let err = wrapAngle(desired - tank.rotation);
    if (canReverse && Math.abs(err) > Math.PI * 0.62) {
      const rev = wrapAngle(desired + Math.PI - tank.rotation);
      return {
        drive: Math.abs(rev) < 0.9 && dist > 1 ? -1 : 0,
        turn: Math.abs(rev) > dead ? Math.sign(rev) : 0,
        fire: false,
        firePressed: false,
      };
    }
    return {
      drive: Math.abs(err) < 0.9 && dist > 1 ? 1 : 0,
      turn: Math.abs(err) > dead ? Math.sign(err) : 0,
      fire: false,
      firePressed: false,
    };
  }

  _aimTurn(tank, aimAngle) {
    const err = wrapAngle(aimAngle - tank.rotation);
    return Math.abs(err) > 0.04 ? clamp(err * 3, -1, 1) : 0;
  }

  _blendTurn(a, b) {
    // Prefer aiming turn when it's decisive.
    return b !== 0 ? b : a;
  }
}
