import { rng } from '../../core/math/Random.js';

/**
 * Lightweight pooled particle system for smoke, sparks and debris.
 *
 * Particles are plain structs stored in a flat array; dead ones are swapped to
 * the tail and the live count shrinks, so updates stay cache-friendly with zero
 * per-frame allocation. Rendered as soft circles with fading alpha.
 */
export class ParticleSystem {
  /** @param {number} [capacity] */
  constructor(capacity = 600) {
    this._pool = [];
    for (let i = 0; i < capacity; i++) this._pool.push(makeParticle());
    this._count = 0;
  }

  get count() {
    return this._count;
  }

  clear() {
    this._count = 0;
  }

  /**
   * Spawn one particle. Positions/velocities are in world metres.
   * @param {object} o
   */
  spawn(o) {
    if (this._count >= this._pool.length) return;
    const p = this._pool[this._count++];
    p.x = o.x;
    p.y = o.y;
    p.vx = o.vx ?? 0;
    p.vy = o.vy ?? 0;
    p.life = o.life ?? 0.5;
    p.maxLife = p.life;
    p.r0 = o.r0 ?? 0.1;
    p.r1 = o.r1 ?? p.r0;
    p.drag = o.drag ?? 0.9;
    p.color = o.color ?? '0,0,0';
    p.alpha0 = o.alpha0 ?? 0.5;
    p.alpha1 = o.alpha1 ?? 0;
  }

  /**
   * Burst helper — emits `n` particles radiating from (x,y).
   * @param {object} o
   */
  burst(x, y, n, o = {}) {
    const speed = o.speed ?? 3;
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const s = speed * rng.range(0.2, 1);
      this.spawn({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: (o.life ?? 0.6) * rng.range(0.6, 1.2),
        r0: o.r0 ?? 0.12,
        r1: o.r1 ?? 0.4,
        drag: o.drag ?? 0.86,
        color: o.color ?? '60,60,60',
        alpha0: o.alpha0 ?? 0.55,
        alpha1: 0,
      });
    }
  }

  /** @param {number} dt */
  update(dt) {
    for (let i = 0; i < this._count; ) {
      const p = this._pool[i];
      p.life -= dt;
      if (p.life <= 0) {
        // swap-remove
        this._pool[i] = this._pool[this._count - 1];
        this._pool[this._count - 1] = p;
        this._count--;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
      i++;
    }
  }

  /** @param {CanvasRenderingContext2D} ctx */
  render(ctx) {
    for (let i = 0; i < this._count; i++) {
      const p = this._pool[i];
      const t = 1 - p.life / p.maxLife; // 0..1
      const r = p.r0 + (p.r1 - p.r0) * t;
      const a = p.alpha0 + (p.alpha1 - p.alpha0) * t;
      ctx.fillStyle = `rgba(${p.color},${a})`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function makeParticle() {
  return {
    x: 0, y: 0, vx: 0, vy: 0,
    life: 0, maxLife: 1,
    r0: 0.1, r1: 0.1, drag: 0.9,
    color: '0,0,0', alpha0: 0.5, alpha1: 0,
  };
}
