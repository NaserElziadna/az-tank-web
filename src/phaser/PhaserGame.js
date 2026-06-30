import Phaser from './phaserLib.js';
import { Player } from '../models/Player.js';
import { ControllerType, Difficulty } from '../models/enums.js';
import { colorForSlot, Palette } from '../rendering/Palette.js';
import { schemeForSlot } from '../core/input/ControlSchemes.js';
import { B2Match } from './B2Match.js';
import { PhaserRenderer } from './PhaserRenderer.js';
import { PhaserControls } from './PhaserControls.js';
import { TouchControls, isTouchDevice } from './TouchControls.js';
import { AssetStore } from './AssetStore.js';
import { TankIconCompositor } from './TankIconCompositor.js';
import { C } from '../constants/GameConstants.js';

/**
 * Boots a Phaser CE game that runs the Box2D match. Phaser owns the canvas,
 * render loop, scaling and keyboard input; the simulation advances on a fixed
 * timestep accumulated from Phaser's frame time, and the {@link PhaserRenderer}
 * paints each frame with interpolation. The whole thing lives inside `parentEl`.
 */
export class PhaserGame {
  /**
   * @param {HTMLElement} parentEl
   * @param {{bus:any, setup:object, onMatchOver?:Function, version?:string}} opts
   */
  constructor(parentEl, { bus, setup, onMatchOver = null, version = 'v1.0' }) {
    this.bus = bus;
    this.setup = setup;
    this.onMatchOver = onMatchOver;
    this.version = version;
    this.parentEl = parentEl;
    this.touch = null;
    this.match = null;
    this.renderer = null;
    this._acc = 0;
    this._alpha = 0;
    this._matchOverFired = false;

    const w = parentEl.clientWidth || 960;
    const h = parentEl.clientHeight || 600;
    const self = this;
    this.game = new Phaser.Game(w, h, Phaser.CANVAS, parentEl, {
      create() {
        self._create();
      },
      update() {
        self._update();
      },
      render() {
        self._render();
      },
    });
  }

  _create() {
    const game = this.game;
    game.scale.scaleMode = Phaser.ScaleManager.RESIZE;
    game.stage.disableVisibilityChange = true;

    // On-screen controls (touch devices) drive the first human player; they're
    // merged with that player's keyboard so either input source works.
    const firstHumanSlot = this.setup.players.find((pc) => pc.controller === ControllerType.HUMAN)?.slot;
    this._touchSlot = firstHumanSlot;
    if (firstHumanSlot != null && isTouchDevice()) {
      this.touch = new TouchControls(this.parentEl);
    }

    const players = [];
    const humanControllers = new Map();
    for (const pc of this.setup.players) {
      // A tank is "lethal" via the boss-mode flag OR by picking Lethal difficulty.
      // Only the dedicated boss wears the dark skin; difficulty-Lethal AIs keep
      // their slot colour (so multiple are distinguishable) + the lethal extras.
      const isLethal = !!pc.lethal || pc.difficulty === Difficulty.LETHAL;
      const color = pc.lethal ? Palette.lethalTank : colorForSlot(pc.slot);
      let controls = null;
      if (pc.controller === ControllerType.HUMAN) {
        controls = new PhaserControls(game, schemeForSlot(pc.slot));
        const usesTouch = pc.slot === firstHumanSlot;
        humanControllers.set(pc.slot, { think: () => this._readHuman(controls, usesTouch) });
      }
      players.push(
        new Player({ slot: pc.slot, name: pc.name, controller: pc.controller, color, controls, difficulty: pc.difficulty, lethal: isLethal }),
      );
    }

    // Optional sprite assets: load asynchronously; the renderer uses vector art
    // until they arrive, then swaps to the composited sprites automatically.
    this.assets = new AssetStore();
    this.assets.load(320);
    this.compositor = new TankIconCompositor(this.assets);
    this.renderer = new PhaserRenderer(game, this.bus, this.version, this.assets, this.compositor, !isTouchDevice());
    this.renderer.focusSlot = firstHumanSlot ?? null; // mobile camera follows the local player
    this.match = new B2Match(this.bus);
    this.match.configure(players, { pointsToWin: this.setup.pointsToWin, humanControllers });
    this.match.start();
  }

  /** Compact scoreboard data for the DOM HUD strip (mobile). */
  hudData() {
    return (this.match ? this.match.players : []).map((p) => ({
      slot: p.slot,
      name: p.name,
      color: p.color,
      score: p.score,
      alive: p.tank ? p.tank.alive : true,
      hp: p.tank ? p.tank.hp : null,
      maxHp: p.tank ? p.tank.maxHp : null,
    }));
  }

  /** Merge keyboard + (optional) on-screen touch intent for one human. */
  _readHuman(controls, usesTouch) {
    const k = controls.read();
    if (!usesTouch || !this.touch) return k;
    const t = this.touch.read(this._touchTankRot()); // always read so the touch ability edge is consumed
    if (!this.touch.active && !t.abilityPressed) return k;
    return {
      drive: t.drive !== 0 ? t.drive : k.drive,
      turn: t.turn !== 0 ? t.turn : k.turn,
      fire: t.fire || k.fire,
      firePressed: false,
      abilityPressed: t.abilityPressed || k.abilityPressed,
    };
  }

  /** Current heading of the touch-driven tank, or undefined if it's not in play. */
  _touchTankRot() {
    const round = this.match && this.match.round;
    if (!round || this._touchSlot == null) return undefined;
    const tank = round.tanks.find((t) => t.slot === this._touchSlot);
    return tank && tank.alive ? tank.rotation : undefined;
  }

  _update() {
    if (!this.match) return;
    let dt = this.game.time.elapsedMS / 1000;
    if (!(dt > 0)) dt = C.STEP;
    if (dt > 0.25) dt = 0.25;
    this._acc += dt;
    let steps = 0;
    while (this._acc >= C.STEP && steps < 5) {
      this.match.update(C.STEP);
      this.renderer.update(C.STEP);
      this._acc -= C.STEP;
      steps++;
    }
    if (steps === 5) this._acc = 0;
    this._alpha = this._acc / C.STEP;

    if (this.match.matchOver && !this._matchOverFired) {
      this._matchOverFired = true;
      if (this.onMatchOver) this.onMatchOver(this.match.matchWinner);
    }
  }

  _render() {
    if (this.match && this.renderer) this.renderer.render(this.match, this._alpha);
  }

  restart() {
    this._matchOverFired = false;
    this._acc = 0;
    if (this.match) this.match.start();
  }

  destroy() {
    if (this.touch) {
      this.touch.dispose();
      this.touch = null;
    }
    if (this.renderer) this.renderer.dispose();
    // Guard: Phaser.Game.destroy() throws if the game never finished booting.
    try {
      if (this.game && this.game.isBooted) this.game.destroy(true);
    } catch (e) {
      /* ignore teardown errors on a half-booted game */
    }
    this.game = null;
    this.match = null;
    this.renderer = null;
  }
}
