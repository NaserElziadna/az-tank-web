import { ParticleSystem } from './ParticleSystem.js';
import { rng } from '../../core/math/Random.js';

/**
 * Visual effects layer: owns a {@link ParticleSystem} and listens on the event
 * bus for gameplay moments to spawn particles. Matches the original's look —
 * explosions are grey/black **smoke** with a brief white flash (not orange
 * fireballs), wall hits puff light dust (the "collide flare"), and homing
 * missiles leave a black smoke trail. Decoupled from the sim — it only reacts to
 * events, so gameplay never depends on visuals.
 */
export class EffectsLayer {
  /** @param {import('../../core/events/EventBus.js').EventBus} bus */
  constructor(bus) {
    this.particles = new ParticleSystem(1200);
    this._unsub = [];
    this._unsub.push(bus.on('tank:destroyed', (e) => this._explosion(e.x, e.y, e.colorKey)));
    this._unsub.push(bus.on('mine:detonated', (e) => this._explosion(e.x, e.y, null, 0.8)));
    this._unsub.push(bus.on('mine:tripped', (e) => this._puff(e.x, e.y, 6, '210,40,40', 2)));
    // Collide flare: a small dust puff wherever a projectile hits a wall/shield.
    this._unsub.push(bus.on('projectile:bounce', (e) => this._puff(e.x, e.y, 4, '120,120,120', 1.6)));
    // Dust kicked up when a tank drives into a wall.
    this._unsub.push(bus.on('tank:bump', (e) => this._puff(e.x, e.y, 8, '170,165,155', 2.4)));
    // Muzzle flash when any weapon fires.
    this._unsub.push(bus.on('weapon:flash', (e) => this._flash(e.x, e.y)));
  }

  /** Bright muzzle flash + a wisp of smoke. */
  _flash(x, y) {
    this.particles.burst(x, y, 5, { color: '255,235,150', speed: 4, life: 0.12, r0: 0.22, r1: 0.04, alpha0: 0.95, drag: 0.7 });
    this.particles.burst(x, y, 4, { color: '90,90,90', speed: 2.5, life: 0.35, r0: 0.1, r1: 0.4, alpha0: 0.4, drag: 0.85 });
  }

  /** Light dust kicked up behind a moving tank's treads. */
  dust(x, y) {
    this.particles.spawn({
      x: x + (rng.next() - 0.5) * 0.4,
      y: y + (rng.next() - 0.5) * 0.4,
      vx: (rng.next() - 0.5) * 0.5,
      vy: (rng.next() - 0.5) * 0.5,
      life: 0.45,
      r0: 0.12,
      r1: 0.5,
      drag: 0.9,
      color: '150,150,150',
      alpha0: 0.28,
      alpha1: 0,
    });
  }

  /** Grey/black smoke + white flash + coloured debris — the original's style. */
  _explosion(x, y, colorKey, scale = 1) {
    // White flash core (very brief).
    this.particles.burst(x, y, Math.round(10 * scale), {
      color: '255,255,255',
      speed: 7 * scale,
      life: 0.18,
      r0: 0.3,
      r1: 0.05,
      alpha0: 0.95,
      drag: 0.78,
    });
    // Billowing grey smoke (the bulk of the effect).
    this.particles.burst(x, y, Math.round(30 * scale), {
      color: '70,70,72',
      speed: 5 * scale,
      life: 1.1,
      r0: 0.3,
      r1: 1.3 * scale,
      alpha0: 0.55,
      drag: 0.86,
    });
    this.particles.burst(x, y, Math.round(16 * scale), {
      color: '40,40,42',
      speed: 3 * scale,
      life: 1.3,
      r0: 0.4,
      r1: 1.5 * scale,
      alpha0: 0.45,
      drag: 0.88,
    });
    // A little warm spark (small, not a fireball).
    this.particles.burst(x, y, Math.round(8 * scale), {
      color: '255,180,70',
      speed: 9 * scale,
      life: 0.3,
      r0: 0.14,
      r1: 0.03,
      alpha0: 0.9,
      drag: 0.8,
    });
    // Coloured tank debris.
    if (colorKey) {
      this.particles.burst(x, y, 16, {
        color: hexToRgb(colorKey.base),
        speed: 10,
        life: 0.7,
        r0: 0.22,
        r1: 0.04,
        alpha0: 0.95,
        drag: 0.82,
      });
    }
  }

  _puff(x, y, n, color, speed) {
    this.particles.burst(x, y, n, { color, speed, life: 0.35, r0: 0.12, r1: 0.4, alpha0: 0.5, drag: 0.8 });
  }

  /** A faint short streak behind a flying bullet. */
  bulletTrail(x, y, colorKey) {
    this.particles.spawn({
      x,
      y,
      vx: 0,
      vy: 0,
      life: 0.18,
      r0: 0.16,
      r1: 0.02,
      drag: 1,
      color: colorKey ? hexToRgb(colorKey.base) : '60,60,60',
      alpha0: 0.3,
      alpha1: 0,
    });
  }

  /** A drifting smoke puff — called per-frame behind homing missiles. */
  trail(x, y) {
    this.particles.spawn({
      x: x + (rng.next() - 0.5) * 0.1,
      y: y + (rng.next() - 0.5) * 0.1,
      vx: (rng.next() - 0.5) * 0.6,
      vy: (rng.next() - 0.5) * 0.6,
      life: 0.5,
      r0: 0.12,
      r1: 0.4,
      drag: 0.9,
      color: '30,30,30',
      alpha0: 0.4,
      alpha1: 0,
    });
  }

  update(dt) {
    this.particles.update(dt);
  }

  render(ctx) {
    this.particles.render(ctx);
  }

  dispose() {
    for (const off of this._unsub) off();
    this._unsub.length = 0;
    this.particles.clear();
  }
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
