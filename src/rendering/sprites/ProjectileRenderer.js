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
        this._missile(ctx, x, y, p.rotation, p.colorKey);
      } else if (p.kind === 'shrapnel') {
        ctx.fillStyle = '#3a3a3a';
        ctx.beginPath();
        ctx.arc(x, y, Math.max(p.radius, 0.12), 0, Math.PI * 2);
        ctx.fill();
      } else {
        const r = Math.max(p.radius, p.kind === 'shotgun' || p.kind === 'gatling' ? 0.13 : 0.24);
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
      // soft outer halo → red → bright white core (a real-looking laser)
      ctx.globalAlpha = a * 0.3;
      ctx.strokeStyle = '#ff2a2a';
      ctx.lineWidth = 0.75 * a + 0.12;
      path();
      ctx.globalAlpha = a * 0.85;
      ctx.strokeStyle = '#ff3b3b';
      ctx.lineWidth = 0.32 * a + 0.06;
      path();
      ctx.globalAlpha = a;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 0.12 * a + 0.03;
      path();
      ctx.restore();
    }
  }

  _missile(ctx, x, y, rot, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    // flame
    ctx.fillStyle = 'rgba(255,150,40,0.85)';
    ctx.beginPath();
    ctx.moveTo(-0.2, 0);
    ctx.lineTo(-0.55, 0.14);
    ctx.lineTo(-0.55, -0.14);
    ctx.closePath();
    ctx.fill();
    // body
    ctx.fillStyle = '#2b2b2b';
    ctx.beginPath();
    ctx.moveTo(0.38, 0);
    ctx.lineTo(-0.2, 0.16);
    ctx.lineTo(-0.2, -0.16);
    ctx.closePath();
    ctx.fill();
    if (color) {
      ctx.fillStyle = color.base;
      ctx.fillRect(-0.12, -0.08, 0.16, 0.16);
    }
    ctx.restore();
  }
}
