import { Camera } from '../rendering/Camera.js';
import { MazeRenderer } from '../rendering/sprites/MazeRenderer.js';
import { TankRenderer } from '../rendering/sprites/TankRenderer.js';
import { ProjectileRenderer } from '../rendering/sprites/ProjectileRenderer.js';
import { CollectibleRenderer } from '../rendering/sprites/CollectibleRenderer.js';
import { HudRenderer } from '../rendering/sprites/HudRenderer.js';
import { EffectsLayer } from '../rendering/effects/EffectsLayer.js';
import { Palette } from '../rendering/Palette.js';
import { C } from '../constants/GameConstants.js';
import { rng } from '../core/math/Random.js';
import { RoundPhase, CollectibleType } from '../models/enums.js';

const HUD_HEIGHT = 104;

/**
 * Sprite-draw tuning for the asset-based tank. Because I can't run the build,
 * these are exposed for quick adjustment after a first look: if the tank points
 * the wrong way, try rotationOffset of 0, ±π/2, or π; tweak lengthScale if it's
 * sized wrong.
 */
const SPRITE = {
  rotationOffset: Math.PI / 2, // icon art faces "up"; forward is +X
  lengthScale: 1.95, // icon's longer side ≈ TANK.HEIGHT * this (metres); part PNGs
  // carry transparent padding, so this overshoots the 4 m hull to fill the cell
  // like the original. Lower it if tanks look too big.
};

/**
 * Renders a {@link B2Match} onto the Phaser canvas's 2D context, reusing the
 * project's vector sprite renderers. Phaser owns the canvas, loop, scaling and
 * input; this just paints the frame (camera-fit world layers + screen-space HUD
 * + countdown/result overlay) and runs the particle effects layer.
 */
export class PhaserRenderer {
  /**
   * @param {Phaser.Game} game
   * @param {import('../core/events/EventBus.js').EventBus} bus
   * @param {string} version
   * @param {import('./AssetStore.js').AssetStore} [assets]
   * @param {import('./TankIconCompositor.js').TankIconCompositor} [compositor]
   */
  constructor(game, bus, version = 'v1.0', assets = null, compositor = null) {
    this.game = game;
    this.assets = assets;
    this.compositor = compositor;
    this.camera = new Camera();
    this.maze = new MazeRenderer();
    this.tankR = new TankRenderer();
    this.projR = new ProjectileRenderer();
    this.colR = new CollectibleRenderer();
    this.hud = new HudRenderer();
    this.effects = new EffectsLayer(bus);
    this.version = version;
    this.shake = 0;
    bus.on('tank:destroyed', () => (this.shake = Math.max(this.shake, 14)));
    bus.on('mine:detonated', () => (this.shake = Math.max(this.shake, 7)));
  }

  update(dt) {
    this.effects.update(dt);
    this.shake *= Math.pow(0.001, dt);
    if (this.shake < 0.05) this.shake = 0;
  }

  /** @param {import('./B2Match.js').B2Match} match @param {number} alpha */
  render(match, alpha) {
    const ctx = this.game.context;
    const w = this.game.width;
    const h = this.game.height;
    if (!ctx || !w || !h) return;

    // Frame background (Phaser already cleared, but be explicit).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#15171c';
    ctx.fillRect(0, 0, w, h);

    const round = match.sim;
    if (round) {
      this.camera.fitToArena(round.maze.worldWidth, round.maze.worldHeight, w, h - HUD_HEIGHT, 26);
      let ox = this.camera.offsetX;
      let oy = this.camera.offsetY;
      if (this.shake > 0) {
        ox += (rng.next() - 0.5) * this.shake;
        oy += (rng.next() - 0.5) * this.shake;
      }
      const s = this.camera.scale;

      ctx.save();
      ctx.setTransform(s, 0, 0, s, ox, oy);
      this.maze.draw(ctx, round.maze);
      this._drawCollectibles(ctx, round.collectibles, alpha);
      this.colR.drawMines(ctx, round.mines);
      for (const tank of round.tanks) {
        if (!tank.alive) continue;
        // In-game tanks are top-down; the tankIcon PNGs are the 3/4 garage view,
        // so they're wrong here. Render the clean top-down vector tank instead.
        const view = this._tankView(tank, round, alpha);
        this.tankR.draw(ctx, view, view.spawnAnim);
      }
      // Trails: missiles smoke; main bullets leave a faint coloured streak.
      for (const p of round.projectiles) {
        const px = lerp(p.prevPosition.x, p.position.x, alpha);
        const py = lerp(p.prevPosition.y, p.position.y, alpha);
        if (p.kind === 'homing') this.effects.trail(px, py); // smoke from launch, not just after arming
        else if (p.kind === 'bullet' || p.kind === 'double') this.effects.bulletTrail(px, py, p.colorKey);
      }
      // Dust kicked up behind moving tanks (the original's tread effect).
      for (const tank of round.tanks) {
        if (!tank.alive || !tank.velocity || tank.velocity.lengthSq() < 9) continue;
        const tx = lerp(tank.prevPosition.x, tank.position.x, alpha) - Math.cos(tank.rotation) * 1.7;
        const ty = lerp(tank.prevPosition.y, tank.position.y, alpha) - Math.sin(tank.rotation) * 1.7;
        this.effects.dust(tx, ty);
      }
      this.projR.draw(ctx, round.projectiles, round.beams, alpha);
      this.effects.render(ctx);
      for (const tank of round.tanks) {
        if (!tank.alive) continue;
        const x = lerp(tank.prevPosition.x, tank.position.x, alpha);
        const y = lerp(tank.prevPosition.y, tank.position.y, alpha);
        this.tankR.drawHealth(ctx, { x, y }, tank.hp, tank.maxHp);
        this.tankR.drawName(ctx, { x, y }, tank.player.name);
      }
      ctx.restore();

      // Screen-space vignette to frame the arena and add depth.
      this._drawVignette(ctx, w, h);

      // HUD (screen space).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const activeWeapons = new Map();
      for (const p of match.players) {
        if (p.isHuman && p.tank && p.tank.alive) {
          const wpn = p.tank.activeWeapon;
          activeWeapons.set(p.slot, `${weaponName(wpn.type)} ${wpn.hudLabel()}`.trim());
        }
      }
      this.hud.draw(ctx, w, h, match.players, { version: this.version, activeWeapons, compositor: this.compositor });
    }

    this._overlay(ctx, match, w, h);
  }

  /** Cached radial dark-edge vignette (rebuilt only when the canvas resizes). */
  _drawVignette(ctx, w, h) {
    if (!this._vig || this._vig.w !== w || this._vig.h !== h) {
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.34, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,0.4)');
      this._vig = { w, h, grad: g };
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this._vig.grad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  _overlay(ctx, match, w, h) {
    let big = '';
    let sub = '';
    let color = '#fff';
    if (match.matchOver) {
      big = match.matchWinner ? `${match.matchWinner.name} wins!` : 'Match over';
      sub = match.players.map((p) => `${p.name} ${p.score}`).join('   ·   ');
    } else if (match.phase === RoundPhase.COUNTDOWN) {
      if (match.showGo) {
        big = 'GO!';
        color = '#3aa017';
      } else {
        big = String(match.countdownValue);
        color = '#e21d1d';
        sub = `Round ${match.roundNumber}`;
      }
    } else if (match.phase === RoundPhase.ENDING) {
      const r = match.roundResult;
      if (r && r.winnerSlot != null) {
        const wnr = match.players.find((p) => p.slot === r.winnerSlot);
        big = `${wnr ? wnr.name : 'Tank'} wins!`;
      } else big = 'Draw!';
      sub = match.players.map((p) => `${p.name} ${p.score}`).join('   ·   ');
    }
    if (!big && !sub) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (big) {
      const size = Math.min(140, Math.max(48, w * 0.12));
      ctx.font = `900 ${size}px "Segoe UI", sans-serif`;
      ctx.lineWidth = size * 0.08;
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.strokeText(big, w / 2, h / 2 - 10);
      ctx.fillStyle = color;
      ctx.fillText(big, w / 2, h / 2 - 10);
    }
    if (sub) {
      ctx.font = '600 22px "Segoe UI", sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(sub, w / 2, h / 2 + size2(w) + 6);
      ctx.fillStyle = '#fff';
      ctx.fillText(sub, w / 2, h / 2 + size2(w) + 6);
    }
  }

  /** Draw the composited tank sprite. Returns false if no asset (→ vector fallback). */
  _drawTankSprite(ctx, view) {
    if (!this.compositor) return false;
    const canvas = this.compositor.get(view.color);
    if (!canvas) return false;

    // Aimer sight under the tank (world space).
    if (view.aimer && view.aimer.points && view.aimer.points.length > 1) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#ff3b3b';
      ctx.lineWidth = 0.12;
      ctx.setLineDash([0.5, 0.4]);
      ctx.beginPath();
      ctx.moveTo(view.aimer.points[0].x, view.aimer.points[0].y);
      for (let i = 1; i < view.aimer.points.length; i++) ctx.lineTo(view.aimer.points[i].x, view.aimer.points[i].y);
      ctx.stroke();
      ctx.restore();
    }

    const iw = canvas.width;
    const ih = canvas.height;
    const scale = (C.TANK.HEIGHT * SPRITE.lengthScale) / Math.max(iw, ih);
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.rotate(view.rotation + SPRITE.rotationOffset);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(canvas, (-iw * scale) / 2, (-ih * scale) / 2, iw * scale, ih * scale);
    ctx.restore();

    if (view.shield) {
      const r = C.UPGRADES.SHIELD.radius;
      ctx.save();
      ctx.globalAlpha = view.shield.ratio < 0.34 ? 0.4 + 0.4 * Math.abs(Math.sin(performance.now() / 80)) : 0.7;
      ctx.strokeStyle = 'rgba(90,170,255,0.85)';
      ctx.lineWidth = 0.22;
      ctx.beginPath();
      ctx.arc(view.x, view.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    return true;
  }

  /** Gold/diamond use the real sprites when present; crates use vector art. */
  _drawCollectibles(ctx, collectibles, alpha) {
    const gold = this.assets && this.assets.get('game.gold');
    const diamond = this.assets && this.assets.get('game.diamond');
    const vector = [];
    for (const c of collectibles) {
      let img = null;
      let size = 0;
      if (c.category === CollectibleType.GOLD && gold) {
        img = gold;
        size = C.COLLECTIBLE.GOLD_RADIUS * 2;
      } else if (c.category === CollectibleType.DIAMOND && diamond) {
        img = diamond;
        size = C.COLLECTIBLE.DIAMOND_H;
      }
      if (!img) {
        vector.push(c);
        continue;
      }
      const pop = Math.min(1, c.spawnAnim);
      const aspect = img.width / img.height;
      const hgt = size * pop;
      const wid = hgt * aspect;
      ctx.save();
      ctx.translate(c.position.x, c.position.y);
      ctx.rotate(c.rotation || 0);
      ctx.drawImage(img, -wid / 2, -hgt / 2, wid, hgt);
      ctx.restore();
    }
    if (vector.length) this.colR.draw(ctx, vector, alpha);
  }

  _tankView(tank, round, alpha) {
    const x = lerp(tank.prevPosition.x, tank.position.x, alpha);
    const y = lerp(tank.prevPosition.y, tank.position.y, alpha);
    const rot = tank.prevRotation + shortAngle(tank.rotation - tank.prevRotation) * alpha;
    let aimer = null;
    if (tank.aimer) {
      const m = tank.muzzle(C.TANK.BARREL_LENGTH);
      const trace = round.physics.tracePath(m.x, m.y, rot, { maxBounces: 3, maxLength: 40, radius: 0.25 });
      aimer = { points: trace.points };
    }
    return {
      x,
      y,
      rotation: rot,
      color: tank.colorKey,
      lethal: tank.lethal,
      hp: tank.hp,
      maxHp: tank.maxHp,
      spawnAnim: tank.spawnAnim ?? 1,
      treadOffset: tank.treadOffset,
      shield: tank.shield ? { ratio: tank.shield.time / C.UPGRADES.SHIELD.lifetime } : null,
      aimer,
    };
  }

  dispose() {
    this.effects.dispose();
  }
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
function shortAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
function size2(w) {
  return Math.min(140, Math.max(48, w * 0.12)) * 0.6;
}
function weaponName(type) {
  return { normal: '', double: 'Double', shotgun: 'Shotgun', gatling: 'Gatling', homing: 'Missile', mine: 'Mines', laser: 'Laser' }[type] || '';
}

// Keep Palette referenced (used indirectly by the sprite renderers' colours).
void Palette;
