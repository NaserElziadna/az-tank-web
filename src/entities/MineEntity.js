import { Entity } from './Entity.js';
import { Vector2 } from '../core/math/Vector2.js';
import { C } from '../constants/GameConstants.js';
import { rng } from '../core/math/Random.js';

const CFG = C.WEAPONS.MINE;

/**
 * A proximity mine (a Trap). State machine:
 *   arming (can't trip) → armed → tripped (fuse) → detonate → 30 shrapnel.
 * Tossed gently backward on deploy, then settles. Becomes deadly to its layer
 * once armed, so you can blow yourself up by reversing into your own mine.
 */
export class MineEntity extends Entity {
  constructor() {
    super();
    this.velocity = new Vector2();
    this.reset();
  }

  reset() {
    this.ownerSlot = -1;
    this.colorKey = null;
    this.radius = CFG.bodyRadius;
    this.state = 'arming';
    this.armTimer = CFG.activationDelay;
    this.fuse = CFG.detonationDelay;
    this.velocity.set(0, 0);
    this.alive = true;
    this.dead = false;
  }

  /** @param {{x:number,y:number}} pos @param {number} angle launch direction */
  deploy(pos, angle) {
    this.position.set(pos.x, pos.y);
    this.prevPosition.copy(this.position);
    this.velocity.set(Math.cos(angle) * CFG.launchSpeed, Math.sin(angle) * CFG.launchSpeed);
  }

  get armed() {
    return this.state !== 'arming';
  }

  /** @param {number} dt @param {import('../game/round/RoundSimulation.js').RoundSimulation} sim */
  update(dt, sim) {
    this.savePrevious();

    // Slide + settle.
    if (this.velocity.lengthSq() > 0.01) {
      this.position.addScaled(this.velocity, dt);
      this.velocity.scale(Math.pow(0.86, dt * 60));
      sim.physics.resolveCircle(this.position, this.radius);
    }

    if (this.state === 'arming') {
      this.armTimer -= dt;
      if (this.armTimer <= 0) this.state = 'armed';
      return;
    }

    if (this.state === 'armed') {
      for (const tank of sim.tanks) {
        if (!tank.alive) continue;
        if (tank.position.distanceToSq(this.position) <= CFG.triggerRadius * CFG.triggerRadius) {
          this.state = 'tripped';
          sim.emit('mine:tripped', { x: this.position.x, y: this.position.y });
          break;
        }
      }
      return;
    }

    if (this.state === 'tripped') {
      this.fuse -= dt;
      if (this.fuse <= 0) this._detonate(sim);
    }
  }

  _detonate(sim) {
    for (let i = 0; i < CFG.shrapnel; i++) {
      const angle = (i / CFG.shrapnel) * Math.PI * 2 + rng.range(-0.05, 0.05);
      sim.spawnProjectile({
        kind: 'shrapnel',
        ownerSlot: this.ownerSlot,
        colorKey: this.colorKey,
        pos: this.position,
        angle,
        speed: rng.range(CFG.shrapnelSpeedMin, CFG.shrapnelSpeedMax),
        radius: CFG.shrapnelRadius,
        maxLifetime: 3,
        constantSpeed: false,
        stopsOnWall: true,
        drag: 0.04,
        deadlyToOwner: true,
      });
    }
    sim.emit('mine:detonated', { x: this.position.x, y: this.position.y });
    this.destroy();
  }
}
