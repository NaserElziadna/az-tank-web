import { EventBus } from '../core/events/EventBus.js';
import { MenuScreen } from '../ui/MenuScreen.js';
import { SetupScreen } from '../ui/SetupScreen.js';
import { PhaserGame } from '../phaser/PhaserGame.js';
import { PhaserAudio } from '../phaser/PhaserAudio.js';
import { el, clear } from '../ui/dom.js';

const VERSION = 'v2.0';

/**
 * Top-level application for the original-libraries build.
 *
 * The menu and setup screens are plain DOM (mirroring the original's
 * jQuery-driven lobby); the in-game experience is a Phaser CE game running the
 * box2dweb simulation. The app owns navigation and the howler-backed audio.
 */
export class App {
  /** @param {HTMLElement} mount */
  constructor(mount) {
    this.mount = mount;
    this.bus = new EventBus();
    this.audio = new PhaserAudio(this.bus);
    /** @type {PhaserGame|null} */
    this.phaser = null;
    this.showMenu();
  }

  _setScreen(node) {
    this._teardownGame();
    clear(this.mount);
    this.mount.appendChild(node);
  }

  _teardownGame() {
    if (this.phaser) {
      this.phaser.destroy();
      this.phaser = null;
    }
  }

  showMenu() {
    this._setScreen(new MenuScreen({ onPlay: () => this.showSetup() }).root);
  }

  showSetup() {
    this._setScreen(
      new SetupScreen({
        onBack: () => this.showMenu(),
        onStart: (cfg) => this.startGame(cfg),
      }).root,
    );
  }

  startGame(cfg) {
    // Build the in-game screen: a Phaser stage + top bar + match-over panel.
    this.stage = el('div.game__stage');
    this.matchPanel = el('div.overlay', { hidden: 'hidden' });
    const topbar = el('div.topbar', {}, [
      el('button.btn--ghost', { text: '☰ Menu', on: { click: () => this.showMenu() } }),
      el('span'),
    ]);
    const root = el('div.screen.game', {}, [el('div.game__stage-wrap', { style: { position: 'absolute', inset: '0' } }, [this.stage]), this.matchPanel, topbar]);
    this._setScreen(root);

    // Phaser reads the parent size on construction — the screen is now laid out.
    this.phaser = new PhaserGame(this.stage, {
      bus: this.bus,
      setup: cfg,
      version: VERSION,
      onMatchOver: (winner) => this._showMatchOver(winner, cfg),
    });
  }

  _showMatchOver(winner, cfg) {
    clear(this.matchPanel);
    this.matchPanel.appendChild(
      el('div', { style: { display: 'grid', gap: '18px', justifyItems: 'center', pointerEvents: 'auto' } }, [
        el('div.overlay__big', { text: winner ? `${winner.name} wins the match!` : 'Match over' }),
        el('div', { style: { display: 'flex', gap: '14px' } }, [
          el('button.btn', { text: '↻ Play Again', on: { click: () => this._playAgain() } }),
          el('button.btn.btn--secondary', { text: '☰ Menu', on: { click: () => this.showMenu() } }),
        ]),
      ]),
    );
    this.matchPanel.removeAttribute('hidden');
    this.matchPanel.style.display = 'grid';
  }

  _playAgain() {
    this.matchPanel.setAttribute('hidden', 'hidden');
    this.matchPanel.style.display = 'none';
    if (this.phaser) this.phaser.restart();
  }
}
