import { EventBus } from '../core/events/EventBus.js';
import { MenuScreen } from '../ui/MenuScreen.js';
import { SetupScreen } from '../ui/SetupScreen.js';
import { OnlineScreen } from '../ui/OnlineScreen.js';
import { PhaserGame } from '../phaser/PhaserGame.js';
import { PhaserOnlineGame } from '../phaser/PhaserOnlineGame.js';
import { PhaserAudio } from '../phaser/PhaserAudio.js';
import { ControllerType, Difficulty } from '../models/enums.js';
import { el, clear } from '../ui/dom.js';
import { log } from '../core/log/Logger.js';

const alog = log.scope('app');

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
    if (this.onlineScreen) {
      this.onlineScreen.dispose();
      this.onlineScreen = null;
    }
    clear(this.mount);
    this.mount.appendChild(node);
  }

  _teardownGame() {
    if (this.phaser) {
      this.phaser.destroy();
      this.phaser = null;
    }
    if (this.online) {
      this.online.destroy();
      this.online = null;
    }
    if (this.onlineNet) {
      this.onlineNet.close();
      this.onlineNet = null;
    }
  }

  showMenu() {
    this._setScreen(new MenuScreen({ onPlay: () => this.showSetup(), onLethal: () => this.startLethalMode(), onOnline: () => this.showOnline() }).root);
  }

  /** Online lobby: create/join a room, then launch the networked game on match start. */
  showOnline() {
    const screen = new OnlineScreen({ onBack: () => this.showMenu(), onLaunch: (net, firstRound) => this.startOnlineGame(net, firstRound) });
    this._setScreen(screen.root);
    this.onlineScreen = screen; // set AFTER _setScreen so it isn't disposed immediately
  }

  /** @param {import('../net/NetClient.js').NetClient} net @param {object} firstRound the roundStart that triggered launch */
  startOnlineGame(net, firstRound) {
    this.stage = el('div.game__stage');
    this.matchPanel = el('div.overlay', { hidden: 'hidden' });
    const topbar = el('div.topbar', {}, [el('button.btn--ghost', { text: '☰ Leave', on: { click: () => this.showMenu() } }), el('span')]);
    const root = el('div.screen.game', {}, [el('div.game__stage-wrap', { style: { position: 'absolute', inset: '0' } }, [this.stage]), this.matchPanel, topbar]);
    // Tear down the lobby screen FIRST (while onlineNet is still unset, so its
    // teardown can't close the connection we're about to use), THEN claim net.
    this._setScreen(root);
    this.onlineScreen = null; // handed off; its tank is now server-driven
    this.onlineNet = net;

    alog.info('startOnlineGame', { round: firstRound?.round });
    this.online = new PhaserOnlineGame(this.stage, { net, version: VERSION, initialRound: firstRound });
    net.on('matchOver', (m) => {
      alog.info('matchOver', { winnerSlot: m?.winnerSlot });
      this._showOnlineMatchOver(m);
    });
  }

  _showOnlineMatchOver(m) {
    const name = m && m.winnerSlot != null ? `Player ${m.winnerSlot + 1}` : null;
    clear(this.matchPanel);
    this.matchPanel.appendChild(
      el('div', { style: { display: 'grid', gap: '18px', justifyItems: 'center', pointerEvents: 'auto' } }, [
        el('div.overlay__big', { text: name ? `${name} wins the match!` : 'Match over' }),
        el('div', { style: { display: 'flex', gap: '14px' } }, [el('button.btn', { text: '☰ Menu', on: { click: () => this.showMenu() } })]),
      ]),
    );
    this.matchPanel.removeAttribute('hidden');
    this.matchPanel.style.display = 'grid';
  }

  /** Boss mode: a 1-v-1 duel (first to 5) against one lethal tank. */
  startLethalMode() {
    this.startGame({
      pointsToWin: 5,
      players: [
        { slot: 0, name: 'You', controller: ControllerType.HUMAN, difficulty: Difficulty.HARD },
        { slot: 1, name: 'LETHAL', controller: ControllerType.AI, difficulty: Difficulty.LETHAL, lethal: true },
      ],
    });
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
