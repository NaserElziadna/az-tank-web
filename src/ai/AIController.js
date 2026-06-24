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
 * Each step it picks the highest-value behaviour — dodge an incoming shot, lay
 * mines, flee when it can't fight, attack a (possibly revenge) target with
 * skill-scaled aim error and reaction delay, grab a crate, hunt, or wander —
 * then turns that into steering + trigger input. All thresholds scale with the
 * personality traits, so EASY bots are short-sighted, shaky and slow to react
 * while HARD bots plan bank-shots, hold grudges and retreat to rearm.
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
    this.reactionTimer = this.t.lethal ? 0 : lerpTrait(0.3, 0, this.t.dexterity); // pre-fire delay
    this.aimError = 0;
    this.aimWobbleTimer = 0;
    this.unstuckTimer = 0;
    this.wanderTimer = 0;
    this.mineDropTimer = 0;
    this.goal = 'wander';
  }

  /**
   * @param {number} dt
   * @param {import('../game/round/RoundSimulation.js').RoundSimulation} sim
   * @returns {import('../core/input/ControlScheme.js').ControlIntent}
   */
  think(dt, sim) {
    const tank = sim.getTank(this.slot);
    if (!tank || !tank.alive) return neutral();

    this.fireCooldown -= dt;
    this.repathTimer -= dt;
    this.wanderTimer -= dt;
    this.mineDropTimer -= dt;
    if (this.releaseFrames > 0) this.releaseFrames--;
    this._updateAimWobble(dt);

    // Unstuck overrides everything for a short burst.
    if (tank.stuck) this.unstuckTimer = 0.45;
    if (this.unstuckTimer > 0) {
      this.unstuckTimer -= dt;
      return { drive: -1, turn: this.slot % 2 === 0 ? 1 : -1, fire: false, firePressed: false };
    }

    const myTile = sim.maze.worldToTile(tank.position.x, tank.position.y);

    // 1. Dodge incoming fire (highest priority).
    const threat = this._threat(tank, sim);
    if (threat) return this._dodge(tank, sim, threat);

    const enemy = this._selectTarget(tank, sim);
    const crate = this._nearestCrate(tank, sim, myTile);
    const crateDist = crate ? crate.dist : Infinity;
    const wantCrate = crate && tank.queuedWeaponCount < C.MAX_WEAPON_QUEUE && crateDist <= lerpTrait(4, 11, this.t.greediness);

    // 2. Tactical mine-laying when carrying mines.
    if (tank.activeWeapon.type === 'mine' && (tank.activeWeapon.ammo ?? 0) > 0 && !wantCrate) {
      return this._layMines(tank, sim, enemy, myTile);
    }

    // 3. Flee when we can't hurt anyone (all enemies shielded) or our gun is dry.
    const aliveEnemies = sim.tanks.filter((o) => o.slot !== this.slot && o.alive);
    const allShielded = aliveEnemies.length > 0 && aliveEnemies.every((o) => o.hasActiveShield);
    const bulletsDry =
      tank.activeWeapon.type === 'normal' && sim.liveProjectileCount(this.slot, 'bullet') >= C.WEAPONS.BULLET.ammo;
    if ((allShielded || bulletsDry) && !wantCrate) {
      const fleeFrom = aliveEnemies.length ? this._nearestOf(tank, sim, aliveEnemies) : null;
      if (fleeFrom) {
        const intent = this._flee(tank, sim, fleeFrom, myTile);
        // Still fire back opportunistically if we actually can.
        if (!bulletsDry && enemy) {
          const aim = this._aimSolution(tank, sim, enemy.tank);
          if (aim && aim.fireReady) return this._tryFire(tank, intent, dt, aim);
        }
        return intent;
      }
    }

    // 4. Attack with a firing solution.
    const aim = enemy ? this._aimSolution(tank, sim, enemy.tank) : null;
    if (aim && aim.fireReady) {
      this.goal = 'attack';
      const intent = { drive: 0, turn: this._aimTurn(tank, aim.angle), fire: false, firePressed: false };
      if (enemy.worldDist > 15 && Math.abs(wrapAngle(aim.angle - tank.rotation)) < 0.4) intent.drive = 0.5;
      return this._tryFire(tank, intent, dt, aim);
    }
    this.reactionTimer = this.t.lethal ? 0 : lerpTrait(0.3, 0, this.t.dexterity); // reset when no shot

    // 5. Go for a crate.
    if (wantCrate) {
      this.goal = 'crate';
      return this._follow(tank, sim, crate.tile, myTile);
    }

    // 6. Hunt the target. _selectTarget only returns reachable enemies, so if we
    // have one we always pursue it — bots converge on the fight instead of
    // wandering in circles. Aim is blended in as we close the distance.
    if (enemy) {
      this.goal = 'hunt';
      const intent = this._follow(tank, sim, enemy.tile, myTile);
      if (aim) intent.turn = this._blendTurn(intent.turn, this._aimTurn(tank, aim.angle));
      return intent;
    }

    // 7. Wander.
    this.goal = 'wander';
    return this._wander(tank, sim, myTile);
  }

  // ── targeting (revenge-biased) ─────────────────────────────────────────────
  _selectTarget(tank, sim) {
    let best = null;
    let bestScore = Infinity;
    const mt = sim.maze.worldToTile(tank.position.x, tank.position.y);
    for (const other of sim.tanks) {
      if (other.slot === this.slot || !other.alive || other.hasActiveShield) continue;
      const ot = sim.maze.worldToTile(other.position.x, other.position.y);
      const td = sim.maze.tileDistance(mt.tx, mt.ty, ot.tx, ot.ty);
      if (td === Infinity) continue;
      const grudge = this._killsBy(sim, other.slot) * lerpTrait(0, 5, this.t.vengefulness);
      const score = td - grudge; // closer + vengeful → lower score
      if (score < bestScore) {
        bestScore = score;
        best = {
          tank: other,
          tile: { x: ot.tx, y: ot.ty },
          tileDist: td,
          worldDist: tank.position.distanceTo(other.position),
        };
      }
    }
    return best;
  }

  _killsBy(sim, enemySlot) {
    let n = 0;
    for (const k of sim.killLog) if (k.victim === this.slot && k.killer === enemySlot) n++;
    return n;
  }

  _nearestOf(tank, sim, list) {
    let best = null;
    let bestD = Infinity;
    const mt = sim.maze.worldToTile(tank.position.x, tank.position.y);
    for (const o of list) {
      const ot = sim.maze.worldToTile(o.position.x, o.position.y);
      const d = sim.maze.tileDistance(mt.tx, mt.ty, ot.tx, ot.ty);
      if (d < bestD) {
        bestD = d;
        best = { tank: o, tile: { x: ot.tx, y: ot.ty }, tileDist: d };
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

  // ── aiming ──────────────────────────────────────────────────────────────
  _updateAimWobble(dt) {
    this.aimWobbleTimer -= dt;
    if (this.aimWobbleTimer <= 0) {
      this.aimWobbleTimer = 0.3;
      // Random aim error, vanishing at high dexterity (EASY bots aim shakily).
      this.aimError = (rng.next() - 0.5) * lerpTrait(0.18, 0, this.t.dexterity);
    }
  }

  /** Search a fan of angles for a shot (direct or banked) that reaches the enemy. */
  _aimSolution(tank, sim, enemy) {
    const cleverness = this.t.cleverness;
    const numAngles = 1 + 2 * Math.round(lerpTrait(0, 2, cleverness)); // odd: 1,3,5
    const spread = lerpTrait(0.5, 1.6, this.t.aggressiveness);
    const bounces = Math.round(lerpTrait(1, 5, cleverness));
    const length = TILE * lerpTrait(3, 8, cleverness);
    const muzzle = tank.muzzle(C.TANK.BARREL_LENGTH);
    const tanksView = sim.tanks.map((t) => ({ id: t.slot, position: t.position, radius: C.TANK.COLLISION_RADIUS }));

    let best = null;
    for (let i = 0; i < numAngles; i++) {
      const offset = numAngles === 1 ? 0 : (i / (numAngles - 1) - 0.5) * spread;
      const angle = tank.rotation + offset;
      const trace = sim.physics.tracePath(muzzle.x, muzzle.y, angle, {
        maxBounces: bounces,
        maxLength: length,
        radius: C.WEAPONS.BULLET.radius,
        tanks: tanksView,
        ignoreTankId: tank.slot,
      });
      if (trace.hitTank && trace.hitTank.id === enemy.slot) {
        // Avoid self-wall suicide, but relaxed so genuine corner bank-shots survive.
        const selfMin = this.t.lethal ? 1.5 : 2;
        if (trace.firstSegmentLength < selfMin && trace.length > trace.firstSegmentLength + 0.5) continue;
        if (!best || trace.length < best.length) best = { angle, length: trace.length };
      }
    }
    if (!best) return null;

    // Apply skill-based aim error so low-dexterity bots genuinely miss.
    const aimAngle = best.angle + this.aimError;
    const headingErr = Math.abs(wrapAngle(aimAngle - tank.rotation));
    const fireTolerance = lerpTrait(0.14, 0.55, this.t.aggressiveness);
    const fireDist = lerpTrait(13, 28, this.t.aggressiveness);
    const fireReady = headingErr < fireTolerance && best.length < fireDist;
    return { angle: aimAngle, fireReady };
  }

  /** Gate firing on a reaction delay (then the per-shot pulse / cooldown). */
  _tryFire(tank, intent, dt, aim) {
    intent.turn = this._aimTurn(tank, aim.angle);
    if (this.reactionTimer > 0) {
      this.reactionTimer -= dt;
      return intent;
    }
    return this._applyFire(tank, intent, true);
  }

  _applyFire(tank, intent, want) {
    if (!want) return intent;
    const auto = tank.activeWeapon.type === 'gatling' || tank.activeWeapon.type === 'laser';
    if (this.releaseFrames > 0 || (!auto && this.fireCooldown > 0)) {
      intent.fire = false;
      return intent;
    }
    intent.fire = true;
    intent.firePressed = true;
    if (!auto) {
      this.fireCooldown = this.t.lethal ? 0.08 : lerpTrait(0.5, 0.13, this.t.dexterity);
      this.releaseFrames = this.t.lethal ? 1 : 2;
      this.reactionTimer = this.t.lethal ? 0 : lerpTrait(0.3, 0, this.t.dexterity); // re-arm for next shot
    }
    return intent;
  }

  // ── mines ─────────────────────────────────────────────────────────────────
  _layMines(tank, sim, enemy, myTile) {
    this.goal = 'mine';
    // Approach the enemy (or wander), dropping mines along the way as traps.
    const intent = enemy ? this._follow(tank, sim, enemy.tile, myTile) : this._wander(tank, sim, myTile);
    if (this.mineDropTimer <= 0) {
      this.mineDropTimer = lerpTrait(2.2, 1.2, this.t.aggressiveness);
      return this._applyFire(tank, intent, true); // drop a mine
    }
    return intent;
  }

  // ── threat / dodge ────────────────────────────────────────────────────────
  _threat(tank, sim) {
    const scary = lerpTrait(14, 4, this.t.boldness);
    const horizon = 1.1;
    let worst = null;
    for (const p of sim.projectiles) {
      if (!p.isDeadlyTo(this.slot)) continue;
      const speed = p.velocity.length();
      if (speed < 0.1) continue;
      const dhx = p.velocity.x / speed;
      const dhy = p.velocity.y / speed;
      const maxLen = speed * horizon;
      const relx = tank.position.x - p.position.x;
      const rely = tank.position.y - p.position.y;
      let proj = clamp(relx * dhx + rely * dhy, 0, maxLen);
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
    const px = -threat.dir.y;
    const py = threat.dir.x;
    const probe = 4;
    const clear = sim.physics.lineOfSight(tank.position.x, tank.position.y, tank.position.x + px * probe, tank.position.y + py * probe);
    const sx = clear ? px : -px;
    const sy = clear ? py : -py;
    const intent = this._driveTo(tank, tank.position.x + sx * probe, tank.position.y + sy * probe, true);
    // Retaliate if a clean shot exists.
    const enemy = this._selectTarget(tank, sim);
    if (enemy) {
      const aim = this._aimSolution(tank, sim, enemy.tank);
      if (aim && aim.fireReady) return this._applyFire(tank, intent, true);
    }
    return intent;
  }

  // ── movement ────────────────────────────────────────────────────────────
  /** Shortest path via the sim's graph (jkstra) when present, else built-in Dijkstra. */
  _shortest(sim, start, end, weightFn) {
    if (typeof sim.shortestPath === 'function') return sim.shortestPath(start, end, weightFn);
    return Pathfinder.shortestPath(sim.maze, start, end, weightFn, 0.1);
  }

  _follow(tank, sim, targetTile, myTile) {
    if (this.repathTimer <= 0 || this.path.length === 0) {
      this.repathTimer = 0.3;
      const threatWeight = lerpTrait(0.1, 1.2, this.t.cleverness);
      this.path = this._shortest(
        sim,
        { tx: myTile.tx, ty: myTile.ty },
        { tx: targetTile.x, ty: targetTile.y },
        (tx, ty) => sim.maze.deadEndPenalty(tx, ty) * threatWeight,
      );
    }
    this._consumeReached(tank, sim);
    if (this.path.length === 0) {
      const c = sim.maze.tileCenter(targetTile.x, targetTile.y);
      return this._driveTo(tank, c.x, c.y, false);
    }
    const c = sim.maze.tileCenter(this.path[0].x, this.path[0].y);
    return this._driveTo(tank, c.x, c.y, this.path.length <= 1);
  }

  /** Flee: hill-climb away from a foe, avoiding dead-ends. */
  _flee(tank, sim, from, myTile) {
    this.goal = 'flee';
    const ft = from.tile;
    const path = Pathfinder.gradientPath(
      sim.maze,
      { tx: myTile.tx, ty: myTile.ty },
      Math.round(lerpTrait(3, 7, this.t.cleverness)),
      (tx, ty) => sim.maze.tileDistance(tx, ty, ft.x, ft.y) - sim.maze.deadEndPenalty(tx, ty) * 0.8,
    );
    if (path.length === 0) return this._driveTo(tank, tank.position.x - (from.tank.position.x - tank.position.x), tank.position.y - (from.tank.position.y - tank.position.y), true);
    const c = sim.maze.tileCenter(path[0].x, path[0].y);
    return this._driveTo(tank, c.x, c.y, false);
  }

  _wander(tank, sim, myTile) {
    if (this.wanderTimer <= 0 || this.path.length === 0) {
      this.wanderTimer = rng.range(1.2, 2.4);
      // Bias toward the nearest living enemy so bots converge on the fight even
      // when there's no clean target (e.g. behind a shield) — never aimless loops.
      let target = null;
      const enemies = sim.tanks.filter((o) => o.slot !== this.slot && o.alive);
      if (enemies.length) {
        const near = this._nearestOf(tank, sim, enemies);
        if (near) target = { x: near.tile.x, y: near.tile.y };
      }
      if (!target) {
        const tiles = sim.maze.reachableTiles();
        const far = tiles.filter((t) => sim.maze.tileDistance(myTile.tx, myTile.ty, t.x, t.y) >= 2);
        target = far.length ? rng.pick(far) : rng.pick(tiles);
      }
      this.path = this._shortest(sim, { tx: myTile.tx, ty: myTile.ty }, { tx: target.x, ty: target.y }, null);
    }
    this._consumeReached(tank, sim);
    if (this.path.length === 0) return { drive: 0, turn: rng.range(-1, 1), fire: false, firePressed: false };
    const c = sim.maze.tileCenter(this.path[0].x, this.path[0].y);
    return this._driveTo(tank, c.x, c.y, false);
  }

  _consumeReached(tank, sim) {
    while (this.path.length) {
      const wp = this.path[0];
      const c = sim.maze.tileCenter(wp.x, wp.y);
      if (tank.position.distanceToSq(c) < 9) this.path.shift();
      else break;
    }
  }

  _driveTo(tank, tx, ty, canReverse) {
    const jitter = (rng.next() - 0.5) * lerpTrait(0.3, 0, this.t.dexterity);
    const desired = Math.atan2(ty - tank.position.y, tx - tank.position.x) + jitter;
    const dist = Math.hypot(tx - tank.position.x, ty - tank.position.y);
    const dead = 0.12;

    const err = wrapAngle(desired - tank.rotation);
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
    return b !== 0 ? b : a;
  }
}

function neutral() {
  return { drive: 0, turn: 0, fire: false, firePressed: false };
}
