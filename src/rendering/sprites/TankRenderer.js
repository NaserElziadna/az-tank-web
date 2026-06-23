import { C } from '../../constants/GameConstants.js';
import { Palette } from '../Palette.js';

const TANK = C.TANK;

/**
 * Draws a top-down tank as layered vector parts (shadow, treads, hull, turret,
 * barrel) tinted to the player's colour with a dark outline — recreating the
 * original's look without any sprite assets. Local space has forward = +X.
 */
export class TankRenderer {
  /**
   * @param {CanvasRenderingContext2D} ctx in world (metre) transform
   * @param {object} t interpolated tank view-state
   * @param {number} t.x @param {number} t.y @param {number} t.rotation
   * @param {object} t.color palette entry
   * @param {number} [t.treadOffset]
   * @param {object|null} [t.shield] { ratio } 0..1 strength
   * @param {{length:number, points:{x:number,y:number}[]}|null} [t.aimer]
   * @param {number} [alpha] fade for spawn/death
   */
  draw(ctx, t, alpha = 1) {
    const color = t.color;

    // Aimer sight (drawn under the tank in world space).
    if (t.aimer && t.aimer.points && t.aimer.points.length > 1) {
      ctx.save();
      ctx.globalAlpha = 0.5 * alpha;
      ctx.strokeStyle = Palette.laser;
      ctx.lineWidth = 0.12;
      ctx.setLineDash([0.5, 0.4]);
      ctx.beginPath();
      ctx.moveTo(t.aimer.points[0].x, t.aimer.points[0].y);
      for (let i = 1; i < t.aimer.points.length; i++) ctx.lineTo(t.aimer.points[i].x, t.aimer.points[i].y);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = alpha;

    // Ground shadow.
    ctx.save();
    ctx.translate(t.x + 0.18, t.y + 0.24);
    ctx.rotate(t.rotation);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    this._roundRect(ctx, -TANK.HEIGHT / 2, -TANK.WIDTH / 2, TANK.HEIGHT, TANK.WIDTH, 0.6);
    ctx.fill();
    ctx.restore();

    ctx.translate(t.x, t.y);
    ctx.rotate(t.rotation);

    const halfLen = TANK.HEIGHT / 2; // along X (forward)
    const halfWid = TANK.WIDTH / 2; // along Y

    // ── treads ──
    const treadThk = 0.92;
    const treadInset = halfWid - treadThk / 2;
    for (const side of [-1, 1]) {
      const cy = side * treadInset;
      ctx.fillStyle = color.tread;
      this._roundRect(ctx, -halfLen, cy - treadThk / 2, TANK.HEIGHT, treadThk, 0.28);
      ctx.fill();
      ctx.lineWidth = 0.12;
      ctx.strokeStyle = Palette.outline;
      this._roundRect(ctx, -halfLen, cy - treadThk / 2, TANK.HEIGHT, treadThk, 0.28);
      ctx.stroke();
      // Tread "teeth", scrolling with movement.
      ctx.strokeStyle = color.treadHi;
      ctx.lineWidth = 0.1;
      const spacing = 0.5;
      const scroll = ((t.treadOffset || 0) % spacing + spacing) % spacing;
      for (let x = -halfLen + scroll; x < halfLen; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, cy - treadThk / 2 + 0.08);
        ctx.lineTo(x, cy + treadThk / 2 - 0.08);
        ctx.stroke();
      }
    }

    // ── hull ──
    const hullLen = TANK.HEIGHT - 0.7;
    const hullWid = TANK.WIDTH - 1.0;
    ctx.fillStyle = color.hull;
    this._roundRect(ctx, -hullLen / 2, -hullWid / 2, hullLen, hullWid, 0.5);
    ctx.fill();
    // top highlight
    ctx.fillStyle = color.hi;
    ctx.globalAlpha = alpha * 0.35;
    this._roundRect(ctx, -hullLen / 2 + 0.2, -hullWid / 2 + 0.18, hullLen - 0.4, hullWid * 0.42, 0.4);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 0.16;
    ctx.strokeStyle = Palette.outline;
    this._roundRect(ctx, -hullLen / 2, -hullWid / 2, hullLen, hullWid, 0.5);
    ctx.stroke();

    // ── barrel ──
    const barrelLen = TANK.BARREL_LENGTH + 0.1;
    ctx.fillStyle = color.barrel;
    this._roundRect(ctx, 0, -0.22, barrelLen, 0.44, 0.16);
    ctx.fill();
    ctx.lineWidth = 0.1;
    ctx.strokeStyle = Palette.outline;
    this._roundRect(ctx, 0, -0.22, barrelLen, 0.44, 0.16);
    ctx.stroke();
    // muzzle
    ctx.fillStyle = '#1c1c1c';
    ctx.beginPath();
    ctx.arc(barrelLen, 0, 0.28, 0, Math.PI * 2);
    ctx.fill();

    // ── turret (sits rear-of-centre so the barrel overhangs the front) ──
    ctx.fillStyle = color.turret;
    ctx.beginPath();
    ctx.arc(-0.25, 0, 0.92, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.16;
    ctx.strokeStyle = Palette.outline;
    ctx.stroke();
    // turret highlight
    ctx.fillStyle = color.hi;
    ctx.globalAlpha = alpha * 0.4;
    ctx.beginPath();
    ctx.arc(-0.45, -0.2, 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;

    ctx.restore();

    // ── shield bubble (world space, on top) ──
    if (t.shield) {
      const r = C.UPGRADES.SHIELD.radius;
      ctx.save();
      const pulse = t.shield.ratio < 0.34 ? 0.4 + 0.4 * Math.abs(Math.sin(performance.now() / 80)) : 0.7;
      ctx.globalAlpha = pulse * alpha;
      ctx.strokeStyle = Palette.shield;
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.arc(t.x, t.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.12 * pulse * alpha;
      ctx.fillStyle = Palette.shield;
      ctx.fill();
      ctx.restore();
    }
  }

  /** Draw a tank's name + a small position marker (for the in-arena label). */
  drawName(ctx, t, name) {
    ctx.save();
    ctx.translate(t.x, t.y - 2.6);
    const scale = 0.06;
    ctx.scale(scale, scale);
    ctx.font = '700 26px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(name, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillText(name, 0, 0);
    ctx.restore();
  }

  _roundRect(ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }
}
