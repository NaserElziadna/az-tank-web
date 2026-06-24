import { Palette } from '../Palette.js';
import { CollectibleType } from '../../models/enums.js';
import { WeaponFactory } from '../../weapons/WeaponFactory.js';
import { C } from '../../constants/GameConstants.js';

const back = (t) => {
  // Back.Out easing for the spawn pop.
  const s = 1.70158;
  const p = t - 1;
  return p * p * ((s + 1) * p + s) + 1;
};

/**
 * Renders pickups (weapon/upgrade crates, gold, diamonds) and mines. Each crate
 * carries a small vector glyph hinting at its contents so players can decide
 * whether it's worth grabbing.
 */
export class CollectibleRenderer {
  draw(ctx, collectibles, alpha) {
    for (const c of collectibles) {
      const x = c.position.x;
      const y = c.position.y;
      const pop = back(Math.min(1, c.spawnAnim));
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(pop, pop);
      if (c.category === CollectibleType.WEAPON_CRATE) this._crate(ctx, c.kind);
      else if (c.category === CollectibleType.GOLD) this._gold(ctx, c.spin);
      else if (c.category === CollectibleType.DIAMOND) this._diamond(ctx, c.spin);
      ctx.restore();
    }
  }

  drawMines(ctx, mines) {
    for (const m of mines) {
      ctx.save();
      ctx.translate(m.position.x, m.position.y);
      const r = 0.55;
      ctx.fillStyle = m.armed ? '#5a2222' : '#333';
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 0.1;
      ctx.strokeStyle = Palette.outline;
      ctx.stroke();
      // spikes
      ctx.strokeStyle = '#222';
      ctx.lineWidth = 0.12;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a) * (r + 0.22), Math.sin(a) * (r + 0.22));
        ctx.stroke();
      }
      // blinking armed light
      const blink = m.state === 'tripped' ? Math.abs(Math.sin(performance.now() / 50)) : m.armed ? 0.7 : 0.2;
      ctx.fillStyle = `rgba(255,40,40,${blink})`;
      ctx.beginPath();
      ctx.arc(0, 0, 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  _crate(ctx, kind) {
    const s = C.COLLECTIBLE.CRATE_SIZE;
    const h = s / 2;
    // Light rounded square with a dark icon (matches the original's crates).
    // drop shadow
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    this._round(ctx, -h + 0.14, -h + 0.2, s, s, 0.4);
    ctx.fill();
    // light-grey box body (matches the original's pale crates)
    ctx.fillStyle = '#d7d8db';
    this._round(ctx, -h, -h, s, s, 0.4);
    ctx.fill();
    // top highlight + bottom shade for a subtle 3D edge
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    this._round(ctx, -h + 0.16, -h + 0.14, s - 0.32, s * 0.3, 0.3);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    this._round(ctx, -h + 0.16, h * 0.12, s - 0.32, s * 0.34, 0.3);
    ctx.fill();
    // dark rounded border
    ctx.lineWidth = 0.18;
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    this._round(ctx, -h, -h, s, s, 0.4);
    ctx.stroke();
    // dark icon, drawn directly on the light face
    ctx.save();
    ctx.scale(0.92, 0.92);
    ctx.fillStyle = '#33363c';
    ctx.strokeStyle = '#33363c';
    ctx.lineWidth = 0.22;
    this._glyph(ctx, kind);
    ctx.restore();
  }

  _glyph(ctx, kind) {
    ctx.save();
    ctx.lineCap = 'round';
    switch (kind) {
      case 'double':
        ctx.fillRect(-0.5, -0.5, 0.3, 1.0);
        ctx.fillRect(0.2, -0.5, 0.3, 1.0);
        break;
      case 'shotgun':
        ctx.beginPath();
        ctx.moveTo(-0.6, 0);
        ctx.lineTo(0.5, -0.5);
        ctx.moveTo(-0.6, 0);
        ctx.lineTo(0.5, 0.5);
        ctx.moveTo(-0.6, 0);
        ctx.lineTo(0.6, 0);
        ctx.stroke();
        break;
      case 'gatling':
        for (let i = -1; i <= 1; i++) ctx.fillRect(-0.5 + (i + 1) * 0.35, -0.5, 0.2, 1.0);
        break;
      case 'homing':
        ctx.beginPath();
        ctx.moveTo(0.6, 0);
        ctx.lineTo(-0.4, 0.5);
        ctx.lineTo(-0.2, 0);
        ctx.lineTo(-0.4, -0.5);
        ctx.closePath();
        ctx.fill();
        break;
      case 'mine':
        ctx.beginPath();
        ctx.arc(0, 0, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#b07a3c';
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(Math.cos(a) * 0.4, Math.sin(a) * 0.4);
          ctx.lineTo(Math.cos(a) * 0.65, Math.sin(a) * 0.65);
          ctx.stroke();
        }
        break;
      case 'laser':
        ctx.beginPath();
        ctx.moveTo(-0.6, 0.5);
        ctx.lineTo(0.6, -0.5);
        ctx.stroke();
        break;
      case 'shield':
        ctx.beginPath();
        ctx.moveTo(0, -0.6);
        ctx.lineTo(0.55, -0.3);
        ctx.lineTo(0.55, 0.2);
        ctx.lineTo(0, 0.65);
        ctx.lineTo(-0.55, 0.2);
        ctx.lineTo(-0.55, -0.3);
        ctx.closePath();
        ctx.stroke();
        break;
      case 'speedBoost':
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(-0.5 + i * 0.4, -0.5);
          ctx.lineTo(0.1 + i * 0.4, 0);
          ctx.lineTo(-0.5 + i * 0.4, 0.5);
          ctx.stroke();
        }
        break;
      case 'aimer':
        ctx.beginPath();
        ctx.arc(0, 0, 0.45, 0, Math.PI * 2);
        ctx.moveTo(-0.7, 0);
        ctx.lineTo(0.7, 0);
        ctx.moveTo(0, -0.7);
        ctx.lineTo(0, 0.7);
        ctx.stroke();
        break;
      default:
        break;
    }
    ctx.restore();
  }

  _gold(ctx, spin) {
    const r = C.COLLECTIBLE.GOLD_RADIUS * 0.7;
    const squash = Math.abs(Math.cos(spin)) * 0.6 + 0.4;
    ctx.scale(squash, 1);
    ctx.fillStyle = Palette.gold;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.16;
    ctx.strokeStyle = Palette.goldDark;
    ctx.stroke();
    // Embossed coin: inner ring + raised centre (no "$").
    ctx.lineWidth = 0.12;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.beginPath();
    ctx.arc(-r * 0.28, -r * 0.28, r * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  _diamond(ctx, spin) {
    const w = C.COLLECTIBLE.DIAMOND_W * 0.6;
    const h = C.COLLECTIBLE.DIAMOND_H * 0.5;
    const squash = Math.abs(Math.cos(spin)) * 0.7 + 0.3;
    ctx.save();
    ctx.scale(squash, 1);
    ctx.fillStyle = Palette.diamond;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, -h / 6);
    ctx.lineTo(w / 2, h / 6);
    ctx.lineTo(0, h / 2);
    ctx.lineTo(-w / 2, h / 6);
    ctx.lineTo(-w / 2, -h / 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = Palette.diamondLight;
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, -h / 6);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 0.12;
    ctx.strokeStyle = '#0e8c4f';
    ctx.beginPath();
    ctx.moveTo(0, -h / 2);
    ctx.lineTo(w / 2, -h / 6);
    ctx.lineTo(w / 2, h / 6);
    ctx.lineTo(0, h / 2);
    ctx.lineTo(-w / 2, h / 6);
    ctx.lineTo(-w / 2, -h / 6);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  _round(ctx, x, y, w, h, r) {
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
