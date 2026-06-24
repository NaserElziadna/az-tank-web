import { Palette } from '../Palette.js';

/**
 * Renders projectiles (bullets, pellets, shrapnel, homing missiles) and the
 * transient laser beams. Each kind has a distinct, readable silhouette so
 * players can tell incoming fire apart at a glance.
 */
export class ProjectileRenderer {
  /**
   * @param {CanvasRenderingContext2D} ctx world transform
   * @param {import('../../entities/ProjectileEntity.js').ProjectileEntity[]} projectiles
   * @param {object[]} beams
   * @param {number} alpha interpolation
   */
  draw(ctx, projectiles, beams, alpha) {
    for (const p of projectiles) {
      const x = p.prevPosition.x + (p.position.x - p.prevPosition.x) * alpha;
      const y = p.prevPosition.y + (p.position.y - p.prevPosition.y) * alpha;

      if (p.kind === 'homing') {
        this._missile(ctx, x, y, p.rotation, p.colorKey, p.radius, p.activated);
      } else if (p.kind === 'shrapnel') {
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(p.radius, 0.12), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const r = Math.max(p.radius, p.kind === 'shotgun' || p.kind === 'gatling' ? 0.13 : 0.24);
        // Coloured motion streak behind fast main bullets (sense of speed).
        if ((p.kind === 'bullet' || p.kind === 'double') && p.velocity) {
          const sp = Math.hypot(p.velocity.x, p.velocity.y);
          if (sp > 1) {
            const ux = p.velocity.x / sp;
            const uy = p.velocity.y / sp;
            const len = Math.min(1.3, sp * 0.06);
            ctx.save();
            ctx.globalAlpha = 0.32;
            ctx.strokeStyle = p.colorKey ? p.colorKey.base : '#cfcfcf';
            ctx.lineWidth = r * 1.1;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x - ux * len, y - uy * len);
            ctx.lineTo(x, y);
            ctx.stroke();
            ctx.restore();
          }
        }
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (p.colorKey && r > 0.18) {
          ctx.strokeStyle = p.colorKey.base;
          ctx.lineWidth = 0.07;
          ctx.stroke();
        }
        // sheen → reads as a round metal ball, not a flat dot
        ctx.fillStyle = 'rgba(255,255,255,0.45)';
        ctx.beginPath();
        ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.34, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (const b of beams) {
      const a = Math.max(0, b.life / b.max);
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(b.points[0].x, b.points[0].y);
        for (let i = 1; i < b.points.length; i++) ctx.lineTo(b.points[i].x, b.points[i].y);
        ctx.stroke();
      };
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // Mega-laser reads as a thick violet wall-piercing beam; the normal laser is red.
      const halo = b.mega ? '#c34bff' : '#ff2a2a';
      const mid = b.mega ? '#d06bff' : '#ff3b3b';
      const wide = b.mega ? 1.6 : 0.75;
      const midW = b.mega ? 0.6 : 0.32;
      ctx.globalAlpha = a * 0.3;
      ctx.strokeStyle = halo;
      ctx.lineWidth = wide * a + 0.12;
      path();
      ctx.globalAlpha = a * 0.85;
      ctx.strokeStyle = mid;
      ctx.lineWidth = midW * a + 0.06;
      path();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = (b.mega ? 0.2 : 0.12) * a + 0.03;
      path();
      ctx.restore();
    }
  }

  /** A clearly-readable rocket: long body, nose cone, fins, coloured band and a
   *  flickering exhaust flame. Scaled off the projectile radius so it's never a
   *  tiny dot. `activated` brightens the flame once it's homing. */
  _missile(ctx, x, y, rot, color, radius = 0.38, activated = false) {
    const s = Math.max(radius / 0.38, 1); // base art tuned for r=0.38
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.scale(s, s);

    const len = 1.5; // nose-to-tail
    const hw = 0.34; // half-width of the body
    const nose = len * 0.55;
    const tail = -len * 0.45;

    // Exhaust flame (flickers; bigger + brighter once homing).
    const flick = 0.7 + 0.3 * Math.abs(Math.sin(performance.now() / 40));
    const flameLen = (activated ? 1.0 : 0.6) * flick;
    ctx.fillStyle = 'rgba(255,210,90,0.95)';
    ctx.beginPath();
    ctx.moveTo(tail, hw * 0.7);
    ctx.lineTo(tail - flameLen, 0);
    ctx.lineTo(tail, -hw * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,120,30,0.9)';
    ctx.beginPath();
    ctx.moveTo(tail, hw * 0.45);
    ctx.lineTo(tail - flameLen * 0.6, 0);
    ctx.lineTo(tail, -hw * 0.45);
    ctx.closePath();
    ctx.fill();

    // Tail fins.
    ctx.fillStyle = color ? color.base : '#cc3030';
    ctx.beginPath();
    ctx.moveTo(tail + 0.18, hw);
    ctx.lineTo(tail - 0.05, hw + 0.32);
    ctx.lineTo(tail + 0.05, hw * 0.2);
    ctx.closePath();
    ctx.moveTo(tail + 0.18, -hw);
    ctx.lineTo(tail - 0.05, -(hw + 0.32));
    ctx.lineTo(tail + 0.05, -hw * 0.2);
    ctx.closePath();
    ctx.fill();

    // Body (rounded-end capsule).
    ctx.fillStyle = '#e8eaee';
    this._capsule(ctx, tail + 0.1, nose - 0.28, hw);
    ctx.fill();
    ctx.lineWidth = 0.08;
    ctx.strokeStyle = '#2a2c31';
    this._capsule(ctx, tail + 0.1, nose - 0.28, hw);
    ctx.stroke();

    // Nose cone.
    ctx.fillStyle = color ? color.base : '#cc3030';
    ctx.beginPath();
    ctx.moveTo(nose, 0);
    ctx.lineTo(nose - 0.42, hw);
    ctx.lineTo(nose - 0.42, -hw);
    ctx.closePath();
    ctx.fill();

    // Coloured ID band so you can tell whose rocket it is.
    ctx.fillStyle = color ? color.base : '#cc3030';
    ctx.fillRect(-0.05, -hw, 0.26, hw * 2);
    ctx.restore();
  }

  _capsule(ctx, x0, x1, hw) {
    ctx.beginPath();
    ctx.moveTo(x0 + hw, -hw);
    ctx.lineTo(x1 - hw, -hw);
    ctx.arc(x1 - hw, 0, hw, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x0 + hw, hw);
    ctx.arc(x0 + hw, 0, hw, Math.PI / 2, -Math.PI / 2);
    ctx.closePath();
  }
}
