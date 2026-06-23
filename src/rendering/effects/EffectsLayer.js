import { ParticleSystem } from './ParticleSystem.js';
import { rng } from '../../core/math/Random.js';

/**
 * Visual effects layer: owns a {@link ParticleSystem} and listens on the event
 * bus for gameplay moments (a tank exploding, a mine detonating, a weapon
 * firing) to spawn smoke, debris and flame bursts. Decoupled from the sim — it
 * only reacts to events, so gameplay never depends on visuals.
 */
export class EffectsLayer {
  /** @param {import('../../core/events/EventBus.js').EventBus} bus */
  constructor(bus) {
    this.particles = new ParticleSystem(900);
    this._unsub = [];
    this._unsub.push(bus.on('tank:destroyed', (e) => this._explosion(e.x, e.y, e.colorKey)));
    this._unsub.push(bus.on('mine:detonated', (e) => this._explosion(e.x, e.y, null, 0.7)));
    this._unsub.push(bus.on('mine:tripped', (e) => this.particles.burst(e.x, e.y, 6, { color: '210,40,40', speed: 2, life: 0.3 })));
  }

  _explosion(x, y, colorKey, scale = 1) {
    // dark smoke
    this.particles.burst(x, y, Math.round(26 * scale), {
      color: '60,60,60',
      speed: 6 * scale,
      life: 0.9,
      r0: 0.25,
      r1: 1.1 * scale,
      alpha0: 0.6,
      drag: 0.84,
    });
    // bright core
    this.particles.burst(x, y, Math.round(16 * scale), {
      color: '255,160,40',
      speed: 8 * scale,
      life: 0.45,
      r0: 0.2,
      r1: 0.05,
      alpha0: 0.95,
      drag: 0.8,
    });
    // coloured tank debris
    if (colorKey) {
      const rgb = hexToRgb(colorKey.base);
      this.particles.burst(x, y, 14, {
        color: rgb,
        speed: 9,
        life: 0.8,
        r0: 0.22,
        r1: 0.05,
        alpha0: 0.95,
        drag: 0.82,
      });
    }
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
