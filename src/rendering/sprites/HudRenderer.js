/**
 * Bottom player panel HUD (screen-space, CSS pixels).
 *
 * For each player it draws a small upward-facing tank icon, the player name, and
 * the running score — mirroring the original's bottom strip. The active human's
 * current weapon/ammo is shown beneath their icon. A version label sits in the
 * corner.
 */
export class HudRenderer {
  /**
   * @param {CanvasRenderingContext2D} ctx screen transform
   * @param {number} width @param {number} height (CSS px)
   * @param {import('../../models/Player.js').Player[]} players
   * @param {object} [opts] { version, activeWeapons: Map<slot,string> }
   */
  draw(ctx, width, height, players, opts = {}) {
    const n = players.length;
    const panelH = 96;
    const y = height - panelH / 2 - 6;
    const spacing = Math.min(180, (width - 60) / n);
    const totalW = spacing * n;
    const startX = width / 2 - totalW / 2 + spacing / 2;

    ctx.save();
    ctx.textAlign = 'center';

    players.forEach((p, i) => {
      const cx = startX + i * spacing;
      const alive = !p.tank || p.tank.alive;
      ctx.globalAlpha = alive ? 1 : 0.4;

      // name
      ctx.font = '700 15px "Segoe UI", sans-serif';
      this._strokedText(ctx, p.name, cx, y - 40, '#fff');

      // tank icon — real 3/4 garage art if loaded, else the vector icon
      const sprite = opts.compositor && opts.compositor.get(p.color);
      if (sprite) {
        const iw = 88;
        const ih = iw * (sprite.height / sprite.width);
        ctx.drawImage(sprite, cx - iw / 2, y - 4 - ih / 2, iw, ih);
      } else {
        this._icon(ctx, cx, y - 4, 0.46, p.color);
      }

      // score
      ctx.font = '800 26px "Segoe UI", sans-serif';
      this._strokedText(ctx, String(p.score), cx + 40, y - 2, '#fff', 4);

      // health bar (live tanks only)
      if (p.tank && p.tank.alive && p.tank.maxHp) {
        const frac = Math.max(0, p.tank.hp / p.tank.maxHp);
        const bw = 58;
        const bh = 6;
        const bx = cx - bw / 2;
        const by = y + 16;
        ctx.globalAlpha = alive ? 1 : 0.4;
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(bx, by, bw, bh);
        ctx.fillStyle = frac > 0.5 ? '#4caf50' : frac > 0.25 ? '#e0b341' : '#d23b3b';
        ctx.fillRect(bx, by, bw * frac, bh);
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.strokeRect(bx, by, bw, bh);
      }

      // weapon (human only)
      const weapon = opts.activeWeapons && opts.activeWeapons.get(p.slot);
      if (weapon) {
        ctx.font = '600 12px "Segoe UI", sans-serif';
        this._strokedText(ctx, weapon, cx, y + 34, '#ffe08a', 3);
      }
      // held / active ability (human only)
      const ability = opts.abilities && opts.abilities.get(p.slot);
      if (ability) {
        ctx.font = '700 11px "Segoe UI", sans-serif';
        this._strokedText(ctx, ability, cx, y + 48, '#7fe7ff', 3);
      }
      ctx.globalAlpha = 1;
    });
    ctx.restore();

    // version label
    ctx.save();
    ctx.font = 'italic 13px "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.32)';
    ctx.textAlign = 'right';
    ctx.fillText(opts.version || 'v1.0', width - 14, height - 12);
    ctx.restore();
  }

  /** A compact top-down tank icon (barrel pointing up) at a pixel scale. */
  _icon(ctx, cx, cy, scale, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2); // forward (+X) → up
    ctx.scale(scale, scale);

    const halfLen = 40;
    const halfWid = 30;
    const treadThk = 9;
    const inset = halfWid - treadThk / 2;

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    this._round(ctx, -halfLen + 2, -halfWid + 3, halfLen * 2, halfWid * 2, 6);
    ctx.fill();

    for (const side of [-1, 1]) {
      const ty = side * inset - treadThk / 2;
      ctx.fillStyle = color.tread;
      this._round(ctx, -halfLen, ty, halfLen * 2, treadThk, 3);
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      this._round(ctx, -halfLen, ty, halfLen * 2, treadThk, 3);
      ctx.stroke();
    }

    const hl = halfLen * 2 - 10;
    const hw = halfWid * 2 - 12;
    ctx.fillStyle = color.hull;
    this._round(ctx, -hl / 2, -hw / 2, hl, hw, 6);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.8)';
    this._round(ctx, -hl / 2, -hw / 2, hl, hw, 6);
    ctx.stroke();

    // barrel
    ctx.fillStyle = color.barrel;
    this._round(ctx, 0, -4, 34, 8, 3);
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.stroke();

    // turret
    ctx.fillStyle = color.turret;
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  _strokedText(ctx, text, x, y, fill, stroke = 4) {
    ctx.lineWidth = stroke;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineJoin = 'round';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
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
