import { EventBus } from '../core/events/EventBus.js';
import { GameLoop } from '../core/loop/GameLoop.js';
import { InputManager } from '../core/input/InputManager.js';
import { ControlScheme } from '../core/input/ControlScheme.js';
import { schemeForSlot } from '../core/input/ControlSchemes.js';
import { GameController } from '../game/GameController.js';
import { GameRenderer } from '../rendering/GameRenderer.js';
import { AudioService } from '../game/services/AudioService.js';
import { SettingsService } from '../game/services/SettingsService.js';
import { Player } from '../models/Player.js';
import { ControllerType, RoundPhase } from '../models/enums.js';
import { colorForSlot } from '../rendering/Palette.js';
import { MenuScreen } from '../ui/MenuScreen.js';
import { SetupScreen } from '../ui/SetupScreen.js';
import { GameScreen } from '../ui/GameScreen.js';
import { clear } from '../ui/dom.js';
import { C } from '../constants/GameConstants.js';

const VERSION = 'v1.0';

/**
 * Top-level application: owns the cross-cutting services (events, input, audio,
 * settings), the game controller and renderer, the fixed-step loop, and screen
 * navigation (menu → setup → game). It translates setup choices into Player
 * models + controllers and feeds overlay state from the controller each frame.
 */
export class App {
  /** @param {HTMLElement} mount */
  constructor(mount) {
    this.mount = mount;
    this.bus = new EventBus();
    this.input = new InputManager(window);
    this.input.attach();
    this.audio = new AudioService();
    this.audio.bind(this.bus);
    this.settings = new SettingsService();
    this.audio.enabled = this.settings.get('soundEnabled');
    this.audio.setVolume(this.settings.get('volume'));

    this.controller = new GameController(this.bus);

    /** @type {GameScreen|null} */
    this.gameScreen = null;
    /** @type {GameRenderer|null} */
    this.renderer = null;
    this._lastSetup = null;

    this.loop = new GameLoop({
      step: C.STEP,
      update: (dt) => this._update(dt),
      render: (alpha) => this._render(alpha),
    });

    this._onResize = this._onResize.bind(this);
    window.addEventListener('resize', this._onResize);

    this.showMenu();
  }

  // ── navigation ────────────────────────────────────────────────────────────
  _setScreen(screen) {
    clear(this.mount);
    this.mount.appendChild(screen.root);
    this.current = screen;
  }

  showMenu() {
    this.loop.stop();
    this.input.enabled = false;
    this._setScreen(new MenuScreen({ onPlay: () => this.showSetup() }));
  }

  showSetup() {
    this.audio.resume(); // first user gesture — unlock audio
    this.loop.stop();
    this._setScreen(
      new SetupScreen({
        initial: this._lastSetup,
        onBack: () => this.showMenu(),
        onStart: (cfg) => this.startGame(cfg),
      }),
    );
  }

  // ── game lifecycle ─────────────────────────────────────────────────────────
  startGame(cfg) {
    this._lastSetup = null; // setup screen rebuilds from scratch next time

    // Build players + controllers from the setup config.
    const players = [];
    const humanControllers = new Map();
    cfg.players.forEach((pc) => {
      const color = colorForSlot(pc.slot);
      let controls = null;
      if (pc.controller === ControllerType.HUMAN) {
        controls = new ControlScheme(this.input, schemeForSlot(pc.slot));
        humanControllers.set(pc.slot, { think: () => controls.read() });
      }
      players.push(
        new Player({
          slot: pc.slot,
          name: pc.name,
          controller: pc.controller,
          color,
          controls,
          difficulty: pc.difficulty,
        }),
      );
    });

    this.controller.configure(players, { pointsToWin: cfg.pointsToWin, humanControllers });

    this.gameScreen = new GameScreen({
      onMenu: () => this.showMenu(),
      onPlayAgain: () => this._playAgain(),
    });
    this._setScreen(this.gameScreen);

    this.renderer = new GameRenderer(this.gameScreen.canvas, this.bus, VERSION);
    this.input.enabled = true;
    this.input.reset();
    this._onResize();

    this.controller.start();
    this._matchOverShown = false;
    this.loop.start();
  }

  _playAgain() {
    if (!this.gameScreen) return;
    this.gameScreen.hideMatchOver();
    this.input.reset();
    this.controller.start();
    this._matchOverShown = false;
    this.loop.start();
  }

  // ── loop ────────────────────────────────────────────────────────────────
  _update(dt) {
    this.controller.update(dt);
    if (this.renderer) this.renderer.update(dt);
    this.input.clearPressed();

    if (this.controller.matchOver && !this._matchOverShown) this._showMatchOver();
  }

  _render(alpha) {
    if (!this.renderer || !this.gameScreen) return;
    this.renderer.render(this.controller, alpha);
    this._updateOverlay();
  }

  _updateOverlay() {
    const c = this.controller;
    if (c.matchOver) return; // match panel handles it
    if (c.phase === RoundPhase.COUNTDOWN) {
      if (c.showGo) this.gameScreen.setOverlay('GO!');
      else this.gameScreen.setOverlay(String(c.countdownValue), `Round ${c.roundNumber}`);
    } else if (c.phase === RoundPhase.ENDING) {
      const r = c.roundResult;
      if (r && r.winnerSlot != null) {
        const winner = c.players.find((p) => p.slot === r.winnerSlot);
        this.gameScreen.setOverlay(`${winner ? winner.name : 'Tank'} wins!`, this._scoreLine());
      } else {
        this.gameScreen.setOverlay('Draw!', this._scoreLine());
      }
    } else {
      this.gameScreen.clearOverlay();
    }
  }

  _scoreLine() {
    return this.controller.players.map((p) => `${p.name} ${p.score}`).join('   ·   ');
  }

  _showMatchOver() {
    this._matchOverShown = true;
    this.loop.stop();
    const w = this.controller.matchWinner;
    this.gameScreen.showMatchOver(w ? `${w.name} wins the match!` : 'Match over', this._scoreLine());
  }

  _onResize() {
    if (!this.renderer || !this.gameScreen) return;
    const stage = this.gameScreen.stage;
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w > 0 && h > 0) this.renderer.resize(w, h);
  }
}
