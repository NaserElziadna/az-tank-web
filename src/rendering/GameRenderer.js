import { Renderer } from './Renderer.js';
import { MazeRenderer } from './sprites/MazeRenderer.js';
import { TankRenderer } from './sprites/TankRenderer.js';
import { ProjectileRenderer } from './sprites/ProjectileRenderer.js';
import { CollectibleRenderer } from './sprites/CollectibleRenderer.js';
import { HudRenderer } from './sprites/HudRenderer.js';
import { EffectsLayer } from './effects/EffectsLayer.js';
import { Palette } from './Palette.js';
import { C } from '../constants/GameConstants.js';
import { rng } from '../core/math/Random.js';

const HUD_HEIGHT = 104;

/**
 * Orchestrates all world + HUD drawing for a frame.
 *
 * Fits the camera to the current maze (letterboxed above the HUD strip), draws
 * every layer back-to-front with render interpolation (so motion is smooth
 * regardless of the fixed simulation rate), applies explosion camera-shake, and
 * paints the bottom player panel. Owns the effects particle layer.
 */
export class GameRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('../core/events/EventBus.js').EventBus} bus
   * @param {string} version
   */
  constructor(canvas, bus, version = 'v1.0') {
    this.renderer = new Renderer(canvas);
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

  resize(w, h) {
    this.renderer.resize(w, h);
  }

  /** Advance time-based visuals on the fixed step. */
  update(dt) {
    this.effects.update(dt);
    this.shake *= Math.pow(0.001, dt); // fast decay
    if (this.shake < 0.05) this.shake = 0;
  }

  /**
   * @param {import('../game/GameController.js').GameController} game
   * @param {number} alpha interpolation 0..1
   */
  render(game, alpha) {
    const r = this.renderer;
    r.clear('#15171c');
    const sim = game.sim;
    if (!sim) return;

    const viewW = r.width;
    const viewH = r.height - HUD_HEIGHT;
    r.camera.fitToArena(sim.maze.worldWidth, sim.maze.worldHeight, viewW, viewH, 26);

    if (this.shake > 0) {
      r.camera.offsetX += (rng.next() - 0.5) * this.shake;
      r.camera.offsetY += (rng.next() - 0.5) * this.shake;
    }

    r.begin();
    const ctx = r.ctx;

    this.maze.draw(ctx, sim.maze);
    this.colR.draw(ctx, sim.collectibles, alpha);
    this.colR.drawMines(ctx, sim.mines);

    // Tanks.
    for (const tank of sim.tanks) {
      if (!tank.alive) continue;
      const view = this._tankView(tank, sim, alpha);
      this.tankR.draw(ctx, view, 1);
    }

    this.projR.draw(ctx, sim.projectiles, sim.beams, alpha);
    this.effects.render(ctx);

    // Tank names on top (so they're never hidden).
    for (const tank of sim.tanks) {
      if (!tank.alive) continue;
      const x = tank.prevPosition.x + (tank.position.x - tank.prevPosition.x) * alpha;
      const y = tank.prevPosition.y + (tank.position.y - tank.prevPosition.y) * alpha;
      this.tankR.drawName(ctx, { x, y }, tank.player.name);
    }

    r.end();

    // HUD (screen space).
    const activeWeapons = new Map();
    for (const p of game.players) {
      if (p.isHuman && p.tank && p.tank.alive) {
        const w = p.tank.activeWeapon;
        activeWeapons.set(p.slot, `${weaponName(w.type)} ${w.hudLabel()}`.trim());
      }
    }
    this.hud.draw(ctx, r.width, r.height, game.players, { version: this.version, activeWeapons });
  }

  _tankView(tank, sim, alpha) {
    const x = tank.prevPosition.x + (tank.position.x - tank.prevPosition.x) * alpha;
    const y = tank.prevPosition.y + (tank.position.y - tank.prevPosition.y) * alpha;
    let rot = tank.prevRotation + shortAngle(tank.rotation - tank.prevRotation) * alpha;

    let aimer = null;
    if (tank.aimer) {
      const muzzle = tank.muzzle(C.TANK.BARREL_LENGTH);
      const trace = sim.physics.tracePath(muzzle.x, muzzle.y, rot, { maxBounces: 3, maxLength: 40, radius: 0.25 });
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

function shortAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function weaponName(type) {
  return (
    {
      normal: '',
      double: 'Double',
      shotgun: 'Shotgun',
      gatling: 'Gatling',
      homing: 'Missile',
      mine: 'Mines',
      laser: 'Laser',
    }[type] || ''
  );
}
