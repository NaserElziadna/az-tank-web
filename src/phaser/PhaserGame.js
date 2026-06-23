import Phaser from 'phaser-ce';
import { Player } from '../models/Player.js';
import { ControllerType } from '../models/enums.js';
import { colorForSlot } from '../rendering/Palette.js';
import { schemeForSlot } from '../core/input/ControlSchemes.js';
import { B2Match } from './B2Match.js';
import { PhaserRenderer } from './PhaserRenderer.js';
import { PhaserControls } from './PhaserControls.js';
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

    const players = [];
    const humanControllers = new Map();
    for (const pc of this.setup.players) {
      const color = colorForSlot(pc.slot);
      let controls = null;
      if (pc.controller === ControllerType.HUMAN) {
        controls = new PhaserControls(game, schemeForSlot(pc.slot));
        humanControllers.set(pc.slot, { think: () => controls.read() });
      }
      players.push(
        new Player({ slot: pc.slot, name: pc.name, controller: pc.controller, color, controls, difficulty: pc.difficulty }),
      );
    }

    this.renderer = new PhaserRenderer(game, this.bus, this.version);
    this.match = new B2Match(this.bus);
    this.match.configure(players, { pointsToWin: this.setup.pointsToWin, humanControllers });
    this.match.start();
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
    if (this.renderer) this.renderer.dispose();
    if (this.game) this.game.destroy(true);
    this.match = null;
    this.renderer = null;
  }
}
