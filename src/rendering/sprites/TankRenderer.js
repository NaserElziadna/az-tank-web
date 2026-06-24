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

    const halfLen = TANK.HEIGHT / 2; // along X (forward)
    const halfWid = TANK.WIDTH / 2; // along Y
    const O = Palette.outline;

    // Ground shadow.
    ctx.save();
    ctx.translate(t.x + 0.16, t.y + 0.22);
    ctx.rotate(t.rotation);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    this._roundRect(ctx, -halfLen, -halfWid, TANK.HEIGHT, TANK.WIDTH, 0.7);
    ctx.fill();
    ctx.restore();

    ctx.translate(t.x, t.y);
    ctx.rotate(t.rotation);
    if (t.spawnAnim != null && t.spawnAnim < 1) {
      const s = 0.55 + 0.45 * t.spawnAnim; // scale-in pop on spawn
      ctx.scale(s, s);
    }

    // ── treads (dark rounded blocks down each side, with scrolling teeth) ──
    const treadThk = 0.98;
    const treadInset = halfWid - treadThk / 2;
    const treadLen = TANK.HEIGHT - 0.1;
    for (const side of [-1, 1]) {
      const cy = side * treadInset;
      ctx.fillStyle = color.tread;
      this._roundRect(ctx, -treadLen / 2, cy - treadThk / 2, treadLen, treadThk, 0.3);
      ctx.fill();
      // top highlight strip → 3D
      ctx.fillStyle = color.treadHi;
      ctx.globalAlpha = alpha * 0.55;
      this._roundRect(ctx, -treadLen / 2 + 0.08, cy - treadThk / 2 + 0.07, treadLen - 0.16, treadThk * 0.34, 0.18);
      ctx.fill();
      ctx.globalAlpha = alpha;
      // teeth notches, scrolling with motion
      ctx.strokeStyle = 'rgba(0,0,0,0.32)';
      ctx.lineWidth = 0.11;
      const spacing = 0.56;
      const scroll = (((t.treadOffset || 0) % spacing) + spacing) % spacing;
      for (let x = -treadLen / 2 + scroll; x < treadLen / 2; x += spacing) {
        ctx.beginPath();
        ctx.moveTo(x, cy - treadThk / 2 + 0.07);
        ctx.lineTo(x, cy + treadThk / 2 - 0.07);
        ctx.stroke();
      }
      ctx.lineWidth = 0.14;
      ctx.strokeStyle = O;
      this._roundRect(ctx, -treadLen / 2, cy - treadThk / 2, treadLen, treadThk, 0.3);
      ctx.stroke();
    }

    // ── hull (rounded body with a bevel: light top, shaded bottom) ──
    const hullLen = TANK.HEIGHT - 0.5;
    const hullWid = TANK.WIDTH - 0.85;
    ctx.fillStyle = color.hull;
    this._roundRect(ctx, -hullLen / 2, -hullWid / 2, hullLen, hullWid, 0.6);
    ctx.fill();
    ctx.fillStyle = color.hi; // top bevel
    ctx.globalAlpha = alpha * 0.32;
    this._roundRect(ctx, -hullLen / 2 + 0.16, -hullWid / 2 + 0.12, hullLen - 0.32, hullWid * 0.44, 0.5);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.14)'; // bottom shade
    this._roundRect(ctx, -hullLen / 2 + 0.16, hullWid * 0.06, hullLen - 0.32, hullWid * 0.4, 0.4);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 0.16;
    ctx.strokeStyle = O;
    this._roundRect(ctx, -hullLen / 2, -hullWid / 2, hullLen, hullWid, 0.6);
    ctx.stroke();

    // ── barrel (thick gunmetal, highlight stripe, dark muzzle) ──
    const barrelLen = TANK.BARREL_LENGTH + 0.2;
    const barrelW = 0.5;
    ctx.fillStyle = '#3b3e44';
    this._roundRect(ctx, 0.15, -barrelW / 2, barrelLen, barrelW, 0.18);
    ctx.fill();
    ctx.fillStyle = '#6a6e76';
    this._roundRect(ctx, 0.3, -barrelW / 2 + 0.07, barrelLen - 0.25, barrelW * 0.28, 0.08);
    ctx.fill();
    ctx.lineWidth = 0.1;
    ctx.strokeStyle = O;
    this._roundRect(ctx, 0.15, -barrelW / 2, barrelLen, barrelW, 0.18);
    ctx.stroke();
    ctx.fillStyle = '#191b1f';
    ctx.beginPath();
    ctx.arc(0.15 + barrelLen, 0, 0.31, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.08;
    ctx.stroke();

    // ── turret (dome, slightly back of centre, with highlight + hatch) ──
    const turretX = -0.15;
    const turretR = 0.96;
    ctx.fillStyle = color.turret;
    ctx.beginPath();
    ctx.arc(turretX, 0, turretR, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.16;
    ctx.strokeStyle = O;
    ctx.stroke();
    ctx.fillStyle = color.hi;
    ctx.globalAlpha = alpha * 0.45;
    ctx.beginPath();
    ctx.arc(turretX - 0.26, -0.28, 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.beginPath();
    ctx.arc(turretX, 0, 0.32, 0, Math.PI * 2);
    ctx.fill();

    // ── lethal boss skin: nose spikes, red barrel tip, glowing turret core ──
    if (t.lethal) {
      const accent = (t.color && t.color.accent) || '#ff2a2a';
      ctx.fillStyle = '#0e0e11';
      ctx.lineWidth = 0.05;
      ctx.strokeStyle = O;
      for (const sy of [-0.7, 0, 0.7]) {
        ctx.beginPath();
        ctx.moveTo(halfLen - 0.2, sy - 0.22);
        ctx.lineTo(halfLen + 0.55, sy);
        ctx.lineTo(halfLen - 0.2, sy + 0.22);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = accent; // red barrel tip
      ctx.beginPath();
      ctx.arc(0.15 + barrelLen, 0, 0.17, 0, Math.PI * 2);
      ctx.fill();
      const glow = 0.45 + 0.35 * Math.abs(Math.sin(performance.now() / 220)); // pulsing core
      ctx.globalAlpha = alpha * glow;
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(turretX, 0, 0.34, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = alpha;
    }

    ctx.restore();

    // ── shield bubble (world space, on top) ──
    if (t.shield) {
      const r = C.UPGRADES.SHIELD.radius;
      const weak = t.shield.ratio < 0.34;
      ctx.save();
      const pulse = weak ? 0.4 + 0.4 * Math.abs(Math.sin(performance.now() / 80)) : 0.7;
      const rr = r * (1 + 0.05 * Math.sin(performance.now() / 240)); // gentle breathe
      ctx.globalAlpha = pulse * alpha;
      ctx.strokeStyle = Palette.shield;
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.arc(t.x, t.y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.12 * pulse * alpha;
      ctx.fillStyle = Palette.shield;
      ctx.fill();
      // hairline cracks when the shield is about to fail
      if (weak) {
        ctx.globalAlpha = pulse * alpha;
        ctx.lineWidth = 0.05;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + 0.6;
          ctx.beginPath();
          ctx.moveTo(t.x + Math.cos(a) * rr * 0.35, t.y + Math.sin(a) * rr * 0.35);
          ctx.lineTo(t.x + Math.cos(a + 0.25) * rr, t.y + Math.sin(a + 0.25) * rr);
          ctx.stroke();
        }
      }
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
