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
import { RoundPhase } from '../models/enums.js';

const HUD_HEIGHT = 104;

/**
 * Renders a {@link B2Match} onto the Phaser canvas's 2D context, reusing the
 * project's vector sprite renderers. Phaser owns the canvas, loop, scaling and
 * input; this just paints the frame (camera-fit world layers + screen-space HUD
 * + countdown/result overlay) and runs the particle effects layer.
 */
export class PhaserRenderer {
  /** @param {Phaser.Game} game @param {import('../core/events/EventBus.js').EventBus} bus @param {string} version */
  constructor(game, bus, version = 'v1.0') {
    this.game = game;
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
      this.colR.draw(ctx, round.collectibles, alpha);
      this.colR.drawMines(ctx, round.mines);
      for (const tank of round.tanks) {
        if (!tank.alive) continue;
        this.tankR.draw(ctx, this._tankView(tank, round, alpha), 1);
      }
      this.projR.draw(ctx, round.projectiles, round.beams, alpha);
      this.effects.render(ctx);
      for (const tank of round.tanks) {
        if (!tank.alive) continue;
        const x = lerp(tank.prevPosition.x, tank.position.x, alpha);
        const y = lerp(tank.prevPosition.y, tank.position.y, alpha);
        this.tankR.drawName(ctx, { x, y }, tank.player.name);
      }
      ctx.restore();

      // HUD (screen space).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const activeWeapons = new Map();
      for (const p of match.players) {
        if (p.isHuman && p.tank && p.tank.alive) {
          const wpn = p.tank.activeWeapon;
          activeWeapons.set(p.slot, `${weaponName(wpn.type)} ${wpn.hudLabel()}`.trim());
        }
      }
      this.hud.draw(ctx, w, h, match.players, { version: this.version, activeWeapons });
    }

    this._overlay(ctx, match, w, h);
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
