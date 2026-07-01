import { EventBus } from '../core/events/EventBus.js';
import { Router } from './Router.js';
import { MenuScreen } from '../ui/MenuScreen.js';
import { SetupScreen } from '../ui/SetupScreen.js';
import { OnlineScreen } from '../ui/OnlineScreen.js';
import { LockerScreen } from '../ui/LockerScreen.js';
import { PhaserGame } from '../phaser/PhaserGame.js';
import { PhaserOnlineGame } from '../phaser/PhaserOnlineGame.js';
import { PhaserAudio } from '../phaser/PhaserAudio.js';
import { isTouchDevice } from '../phaser/TouchControls.js';
import { VoiceChat } from '../net/VoiceChat.js';
import { ControllerType, Difficulty } from '../models/enums.js';
import { el, clear } from '../ui/dom.js';
import { log } from '../core/log/Logger.js';
import { settings } from '../game/services/SettingsService.js';
import { profile } from '../game/services/ProfileService.js';
import { SettingsPanel } from '../ui/SettingsPanel.js';
import { BalanceTelemetry } from '../game/telemetry/BalanceTelemetry.js';
import { InstallManager } from './InstallManager.js';
import { shareOrCopy } from '../ui/share.js';
import { AdService } from '../services/AdService.js';

const alog = log.scope('app');

const VERSION = 'v2.0';

/**
 * Top-level application for the original-libraries build.
 *
 * Navigation is hash-routed (see {@link Router}): #/ menu, #/play local setup,
 * #/online entry, #/room/CODE a specific room (shareable link), #/lethal duel.
 * Menu/setup/online screens are plain DOM; the in-game experience is a Phaser CE
 * game running the box2dweb simulation. The app owns audio and screen rendering.
 */
export class App {
  /** @param {HTMLElement} mount */
  constructor(mount) {
    this.mount = mount;
    this.bus = new EventBus();
    this.audio = new PhaserAudio(this.bus);
    this.telemetry = new BalanceTelemetry(this.bus); // balance analytics for local play
    this.install = new InstallManager(); // deferred PWA install prompt
    // Ads (portal builds); mute game audio while an ad plays, then restore the
    // user's sound preference. A dev build has no provider, so these are no-ops.
    this.ads = new AdService({
      onAdStart: () => this.audio.setEnabled(false),
      onAdFinish: () => this.audio.setEnabled(settings.get('soundEnabled') !== false),
    });
    /** @type {PhaserGame|null} */
    this.phaser = null;
    // Apply audio-preference changes live (the Settings panel writes the flags).
    settings.onChange((key, value) => {
      if (key === 'soundEnabled') this.audio.setEnabled(value);
      else if (key === 'volume') this.audio.setVolume(value);
    });
    // Mobile browsers gate WebAudio behind a first user gesture — unlock on the
    // first tap/key so SFX aren't silent for the whole first session.
    const unlock = () => {
      this.audio.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    // Daily streak: register this session once at boot (a missed day is forgiven).
    this._daily = profile.touchDaily();
    this.router = new Router((r) => this._route(r));
    this.router.start();
  }

  /** Floating transient toast (rewards, streaks). Auto-dismisses. */
  _toast(text, ms = 3200) {
    const t = el('div.toast', { text });
    this.mount.appendChild(t);
    requestAnimationFrame(() => t.classList.add('toast--in'));
    setTimeout(() => {
      t.classList.remove('toast--in');
      setTimeout(() => t.remove(), 350);
    }, ms);
  }

  /**
   * Grant coins + XP for a finished match and return a node summarising it for
   * the match-over panel. Guarded so a match is only ever rewarded once.
   * @param {{won:boolean, online:boolean}} ctx
   */
  _rewardNode({ won, online }) {
    if (this._rewardClaimed) return null;
    this._rewardClaimed = true;
    // Online (likely-human opponents) pays more than solo-vs-bots; a win pays
    // more than a loss — but you always earn something so play is never punished.
    const coins = won ? (online ? 60 : 35) : online ? 20 : 12;
    const xp = won ? 30 : 15;
    profile.addCoins(coins);
    const { leveledUp, level } = profile.addXp(xp);
    if (leveledUp) this._toast(`⬆ Level ${level}!`);
    return el('p.overlay__reward', { text: `+${coins} 🪙   +${xp} XP${leveledUp ? `   ·   Level ${level}!` : ''}` });
  }

  /** Overlay the settings panel on top of whatever screen is showing. */
  showSettings() {
    if (this._settingsPanel) return;
    const panel = new SettingsPanel({
      onClose: () => {
        panel.root.remove();
        this._settingsPanel = null;
      },
    });
    this._settingsPanel = panel;
    this.mount.appendChild(panel.root);
  }

  /** Render the screen for the current route. */
  _route(r) {
    alog.info('route', { path: r.path });
    const seg = r.segments[0];
    if (seg === 'play') return this.showSetup();
    if (seg === 'lethal') return this.startLethalMode();
    if (seg === 'online') return this.showOnline(null);
    if (seg === 'room') return this.showOnline((r.segments[1] || r.query.key || '').toUpperCase() || null);
    if (seg === 'locker') return this.showLocker();
    return this.showMenu();
  }

  _setScreen(node) {
    this._teardownGame();
    if (this.onlineScreen) {
      this.onlineScreen.dispose();
      this.onlineScreen = null;
    }
    // Dispose the outgoing screen's subscriptions (e.g. the locker's profile listener).
    if (this._screenDispose) {
      this._screenDispose();
      this._screenDispose = null;
    }
    // Any open settings overlay belongs to the outgoing screen; clear() detaches
    // its node, so drop the reference too (else it can't be reopened).
    this._settingsPanel = null;
    clear(this.mount);
    this.mount.appendChild(node);
  }

  _teardownGame() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer);
      this._pingTimer = null;
    }
    if (this._hudTimer) {
      clearInterval(this._hudTimer);
      this._hudTimer = null;
    }
    if (this.phaser) {
      this.phaser.destroy();
      this.phaser = null;
    }
    if (this.voice) {
      this.voice.dispose();
      this.voice = null;
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
    this._setScreen(
      new MenuScreen({
        onQuickPlay: () => this.startQuickPlay(),
        onPlay: () => this.router.go('/play'),
        onLethal: () => this.router.go('/lethal'),
        onOnline: () => this.router.go('/online'),
        onLocker: () => this.router.go('/locker'),
        onSettings: () => this.showSettings(),
      }).root,
    );
    // Celebrate a returning player's streak once per session.
    if (this._daily && this._daily.advanced && this._daily.reward > 0 && !this._dailyShown) {
      this._dailyShown = true;
      this._toast(`🔥 Day ${this._daily.count} streak — +${this._daily.reward} 🪙`);
    }
  }

  /** One-tap "just play": drop straight into a local vs-bots match, no setup. */
  startQuickPlay() {
    this.startGame({
      pointsToWin: 5,
      mode: settings.get('mode') || 'classic',
      players: [
        { slot: 0, name: 'You', controller: ControllerType.HUMAN, difficulty: Difficulty.HARD },
        { slot: 1, name: 'Rusty', controller: ControllerType.AI, difficulty: Difficulty.MEDIUM },
        { slot: 2, name: 'Vortex', controller: ControllerType.AI, difficulty: Difficulty.HARD },
      ],
    });
  }

  /**
   * Online lobby. `initialCode` (from a #/room/CODE deep link) pre-fills the join
   * code so a shared link drops the player straight onto the join step.
   * @param {string|null} initialCode
   */
  showOnline(initialCode) {
    // Already live in this exact room (we updated the URL ourselves)? Don't rebuild.
    if (this.onlineNet && this.onlineNet.code && initialCode === this.onlineNet.code) return;
    const screen = new OnlineScreen({
      onBack: () => this.router.go('/'),
      onLaunch: (net, firstRound, meta) => this.startOnlineGame(net, firstRound, meta),
      onRoom: (code) => this.router.replace(`/room/${code}`), // shareable URL, no re-render
      initialCode,
    });
    this._setScreen(screen.root);
    this.onlineScreen = screen; // set AFTER _setScreen so it isn't disposed immediately
  }

  /**
   * @param {import('../net/NetClient.js').NetClient} net
   * @param {object} firstRound the roundStart that triggered launch
   * @param {{isHost:boolean, reviveBots:boolean}} [meta]
   */
  startOnlineGame(net, firstRound, meta = {}) {
    this.onlineIsHost = !!meta.isHost;
    this.onlineReviveBots = meta.reviveBots !== false;
    this.onlineLocalSlot = meta.localSlot ?? null;
    this._rewardClaimed = false;

    this.stage = el('div.game__stage');
    this.matchPanel = el('div.overlay', { hidden: 'hidden' });
    this.pingEl = el('span.topbar__ping', { text: '' });
    this.botToggleEl = el('button.topbar__bots', { text: '', on: { click: () => net.setSettings({ reviveBots: !this.onlineReviveBots }) } });
    this._hudStrip = el('div.hud-strip');

    // Voice chat (opt-in WebRTC). The instance is created AFTER _setScreen below
    // (otherwise _teardownGame would dispose it immediately). Mic button enables
    // then toggles mute; speaker button toggles deafen.
    this.voiceMicEl = el('button.topbar__voice', { text: '🎤', title: 'Enable voice', on: { click: () => this._toggleMic() } });
    this.voiceDeafEl = el('button.topbar__voice', { text: '🔊', title: 'Deafen', on: { click: () => this._toggleDeafen() } });

    const topbar = el('div.topbar', {}, [
      el('button.btn--ghost', { text: '☰ Leave', on: { click: () => this.router.go('/') } }),
      el('span.topbar__spacer'),
      el('button.btn--ghost', { text: '⚙', title: 'Settings', on: { click: () => this.showSettings() } }),
      this.voiceMicEl,
      this.voiceDeafEl,
      this.botToggleEl,
      this.pingEl,
    ]);
    const root = el(this._gameTag(), {}, [el('div.game__stage-wrap', {}, [this.stage]), this._hudStrip, this.matchPanel, topbar, this._rotateHint()]);
    // Tear down the lobby screen FIRST (while onlineNet is still unset, so its
    // teardown can't close the connection we're about to use), THEN claim net.
    this._setScreen(root);
    this.onlineScreen = null; // handed off; its tank is now server-driven
    this.onlineNet = net;
    this.voice = new VoiceChat(net, meta.localSlot); // after _setScreen so teardown can't dispose it
    this._refreshOnlineTopbar();

    alog.info('startOnlineGame', { round: firstRound?.round, isHost: this.onlineIsHost, slot: meta.localSlot });
    this.online = new PhaserOnlineGame(this.stage, { net, version: VERSION, initialRound: firstRound, bus: this.bus, localSlot: meta.localSlot });

    // Keep host/revive state current; re-show the game on a rematch round.
    net.on('roomState', (s) => {
      if (typeof s.reviveBots === 'boolean') this.onlineReviveBots = s.reviveBots;
      this.voice?.setRoster((s.members || []).map((m) => m.slot));
      this._refreshOnlineTopbar();
    });
    // roomState only fires on lobby changes, so also feed the voice roster from
    // snapshots (always flowing) — otherwise enabling voice mid-match finds no
    // peers. Deduped to the set of human slots so it's effectively free.
    net.on('snapshot', (s) => {
      const slots = (s.players || []).filter((p) => p.isHuman).map((p) => p.slot);
      const sig = slots.join(',');
      if (sig !== this._voiceRosterSig) {
        this._voiceRosterSig = sig;
        this.voice?.setRoster(slots);
      }
    });
    net.on('roundStart', () => {
      this._rewardClaimed = false; // a fresh round → the next match-over can reward again
      if (this.matchPanel) {
        this.matchPanel.setAttribute('hidden', 'hidden');
        this.matchPanel.style.display = 'none';
      }
    });
    net.on('matchOver', (m) => {
      alog.info('matchOver', { winnerSlot: m?.winnerSlot, winner: m?.winnerName });
      this._showOnlineMatchOver(m);
    });
    net.on('reconnecting', (e) => this._showOnlineNotice(`Reconnecting…${e?.attempt > 1 ? ` (${e.attempt})` : ''}`, false));
    net.on('reconnected', () => this._hideOnlineNotice());
    net.on('reconnectFailed', () => this._showOnlineNotice('Disconnected from the server.', true));
    net.on('netClose', () => {
      if (this.online && !this.onlineNet?._closing) this._showOnlineNotice('Disconnected from the server.', true);
    });

    // Live ping readout in the topbar.
    if (this._pingTimer) clearInterval(this._pingTimer);
    this._pingTimer = setInterval(() => this._refreshOnlineTopbar(), 1000);
    this._startHudStrip(() => this.online);
  }

  /** Drive the compact mobile score strip from the active game's hudData(). */
  _startHudStrip(getGame) {
    if (this._hudTimer) clearInterval(this._hudTimer);
    const tick = () => {
      const game = getGame();
      if (!game || !game.hudData || !this._hudStrip) return;
      const data = game.hudData();
      // Rebuild only when the displayed values change (cheap, avoids churn).
      const sig = data.map((d) => `${d.slot}:${d.score}:${d.alive ? 1 : 0}`).join('|');
      if (sig === this._hudSig) return;
      this._hudSig = sig;
      clear(this._hudStrip);
      for (const d of data) {
        const chip = el('div.hud-chip' + (d.alive ? '' : '.hud-chip--dead'), {}, [
          el('span.hud-chip__dot', { style: { background: colorOf(d.color) } }),
          el('span.hud-chip__name', { text: shortName(d.name) }),
          el('span.hud-chip__score', { text: String(d.score) }),
        ]);
        this._hudStrip.appendChild(chip);
      }
    };
    this._hudSig = null;
    tick();
    this._hudTimer = setInterval(tick, 300);
  }

  _refreshOnlineTopbar() {
    if (this.botToggleEl) {
      this.botToggleEl.textContent = `♻ Revive ${this.onlineReviveBots ? 'ON' : 'OFF'}`;
      this.botToggleEl.classList.toggle('topbar__bots--off', !this.onlineReviveBots);
      this.botToggleEl.style.display = this.onlineIsHost ? '' : 'none';
    }
    if (this.pingEl) {
      const rtt = this.onlineNet?.rtt;
      this.pingEl.textContent = rtt != null ? `${Math.round(rtt)} ms` : '…';
    }
    this._refreshVoiceUI();
  }

  /** First mic tap enables voice (mic permission); later taps toggle mute. */
  async _toggleMic() {
    alog.info('mic click', { hasVoice: !!this.voice, enabled: this.voice?.enabled });
    const v = this.voice;
    if (!v) return;
    if (!v.enabled) {
      const ok = await v.enable();
      if (!ok) {
        this._showOnlineNotice('Microphone blocked. Use https/localhost and allow the mic.', false);
        setTimeout(() => this._hideOnlineNotice(), 2200);
      }
    } else {
      v.setMuted(!v.muted);
    }
    this._refreshVoiceUI();
  }

  _toggleDeafen() {
    alog.info('deafen click', { hasVoice: !!this.voice, enabled: this.voice?.enabled });
    if (!this.voice) return;
    this.voice.setDeafened(!this.voice.deafened);
    this._refreshVoiceUI();
  }

  _refreshVoiceUI() {
    const v = this.voice;
    if (!v || !this.voiceMicEl) return;
    if (!v.enabled) {
      this.voiceMicEl.textContent = '🎤';
      this.voiceMicEl.title = 'Enable voice chat';
      this.voiceMicEl.className = 'topbar__voice';
    } else if (v.muted) {
      this.voiceMicEl.textContent = '🔇';
      this.voiceMicEl.title = 'Unmute mic';
      this.voiceMicEl.className = 'topbar__voice topbar__voice--muted';
    } else {
      this.voiceMicEl.textContent = '🎙️';
      this.voiceMicEl.title = 'Mute mic';
      this.voiceMicEl.className = 'topbar__voice topbar__voice--on';
    }
    if (this.voiceDeafEl) {
      this.voiceDeafEl.textContent = v.deafened ? '🔈' : '🔊';
      this.voiceDeafEl.title = v.deafened ? 'Undeafen' : 'Deafen';
      this.voiceDeafEl.className = 'topbar__voice' + (v.deafened ? ' topbar__voice--deaf' : '');
    }
  }

  /** Transient overlay for connection state (reconnecting / disconnected). */
  _showOnlineNotice(text, withMenu) {
    if (!this.matchPanel || !this.online) return;
    clear(this.matchPanel);
    const kids = [el('div.overlay__big', { text })];
    if (withMenu) kids.push(el('button.btn', { text: '☰ Menu', on: { click: () => this.router.go('/') } }));
    this.matchPanel.appendChild(el('div', { style: { display: 'grid', gap: '18px', justifyItems: 'center', pointerEvents: 'auto' } }, kids));
    this.matchPanel.removeAttribute('hidden');
    this.matchPanel.style.display = 'grid';
  }

  /** Game-screen tag; on touch devices add `.game--touch` so CSS reserves a
   *  bottom band for the on-screen controls (keeps the HUD + arena unobscured). */
  _gameTag() {
    return 'div.screen.game' + (isTouchDevice() ? '.game--touch' : '');
  }

  /** Portrait-phone nudge shown over the game (CSS decides when it's visible). */
  _rotateHint() {
    return el('div.rotate-hint', {}, [el('div.rotate-hint__icon', { text: '📱' }), el('div.rotate-hint__text', { text: 'Rotate your device to landscape for the best view' })]);
  }

  _hideOnlineNotice() {
    if (!this.matchPanel) return;
    this.matchPanel.setAttribute('hidden', 'hidden');
    this.matchPanel.style.display = 'none';
  }

  _showOnlineMatchOver(m) {
    this.ads.interstitial('matchOver'); // frequency-capped; no-op without a provider
    const notEnough = m && m.reason === 'notEnoughPlayers';
    const wonLocally = m && m.winnerSlot != null && m.winnerSlot === this.onlineLocalSlot;
    const name = m && (m.winnerName || (m.winnerSlot != null ? `Player ${m.winnerSlot + 1}` : null));
    const headline = notEnough ? 'Not enough players' : wonLocally ? '🏆 You win the match!' : name ? `${name} wins the match!` : 'Match over';
    const nearMiss = notEnough ? null : this._nearMissLine(m && m.standings, m && m.pointsToWin, this.onlineLocalSlot);
    clear(this.matchPanel);
    const actions = [];
    if (this.onlineIsHost) actions.push(el('button.btn.btn--primary', { text: '↻ One more', on: { click: () => this.onlineNet?.startMatch() } }));
    actions.push(el('button.btn.btn--secondary', { text: '☰ Menu', on: { click: () => this.router.go('/') } }));
    // Invite link is the growth lever — offer it right at the high-emotion moment.
    const shareBtn = el('button.btn.btn--secondary', { text: '🔗 Invite a friend' });
    shareBtn.addEventListener('click', () => shareOrCopy({ title: 'AZ Tank', text: 'Join my tank battle!', url: location.href, button: shareBtn }));
    actions.push(shareBtn);
    const installCtl = this.install.control();
    // Reward the match (skipped when it ended early for lack of players).
    const rewardNode = notEnough ? null : this._rewardNode({ won: wonLocally, online: true });
    this.matchPanel.appendChild(
      el('div', { style: { display: 'grid', gap: '18px', justifyItems: 'center', pointerEvents: 'auto' } }, [
        el('div.overlay__big', { text: headline }),
        rewardNode,
        nearMiss ? el('p.overlay__nearmiss', { text: nearMiss }) : null,
        notEnough ? el('p', { text: 'Waiting for more players to join…', style: { color: 'var(--text-dim)' } }) : null,
        this.onlineIsHost ? null : el('p', { text: 'Waiting for the host to start a rematch…', style: { color: 'var(--text-dim)' } }),
        el('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', justifyContent: 'center' } }, actions),
        installCtl,
      ]),
    );
    this.matchPanel.removeAttribute('hidden');
    this.matchPanel.style.display = 'grid';
  }

  /**
   * "Down to the wire" beat when the runner-up finished within a point of the
   * target — near-misses are what drive "one more game". `standings` is
   * [{slot,name,score}]; returns null when it wasn't close (or data is missing).
   * @param {{slot:number,name:string,score:number}[]|null|undefined} standings
   * @param {number|null|undefined} pointsToWin
   * @param {number|null} localSlot slot of the local player (null for hotseat)
   */
  _nearMissLine(standings, pointsToWin, localSlot) {
    if (!pointsToWin || !Array.isArray(standings) || standings.length < 2) return null;
    const sorted = [...standings].sort((a, b) => b.score - a.score);
    const runnerUp = sorted[1];
    if (pointsToWin - runnerUp.score > 1) return null; // wasn't close
    return localSlot != null && runnerUp.slot === localSlot
      ? '🔥 So close — you were one point from the win!'
      : `🔥 Down to the wire — ${runnerUp.name} was one point away!`;
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
        onBack: () => this.router.go('/'),
        onStart: (cfg) => this.startGame(cfg),
      }).root,
    );
  }

  /** Cosmetics locker (unlock ladder): buy + equip colours/trails with coins. */
  showLocker() {
    const locker = new LockerScreen({ onBack: () => this.router.go('/') });
    this._setScreen(locker.root);
    this._screenDispose = () => locker.dispose();
  }

  startGame(cfg) {
    this._rewardClaimed = false;
    // Build the in-game screen: a Phaser stage + top bar + match-over panel.
    this.stage = el('div.game__stage');
    this.matchPanel = el('div.overlay', { hidden: 'hidden' });
    this._hudStrip = el('div.hud-strip');
    const topbar = el('div.topbar', {}, [
      el('button.btn--ghost', { text: '☰ Menu', on: { click: () => this.router.go('/') } }),
      el('button.btn--ghost', { text: '⚙', title: 'Settings', on: { click: () => this.showSettings() } }),
    ]);
    const root = el(this._gameTag(), {}, [el('div.game__stage-wrap', {}, [this.stage]), this._hudStrip, this.matchPanel, topbar, this._rotateHint()]);
    this._setScreen(root);

    // Phaser reads the parent size on construction — the screen is now laid out.
    this.phaser = new PhaserGame(this.stage, {
      bus: this.bus,
      setup: cfg,
      version: VERSION,
      onMatchOver: (winner) => this._showMatchOver(winner, cfg),
    });
    this._startHudStrip(() => this.phaser);
  }

  _showMatchOver(winner, cfg) {
    this.ads.interstitial('matchOver'); // frequency-capped; no-op without a provider
    const match = this.phaser && this.phaser.match;
    const standings = match ? match.players.map((p) => ({ slot: p.slot, name: p.name, score: p.score })) : null;
    const pointsToWin = (match && match.pointsToWin) || (cfg && cfg.pointsToWin) || 0;
    const nearMiss = this._nearMissLine(standings, pointsToWin, null); // hotseat: no single "you"
    const shareBtn = el('button.btn.btn--secondary', { text: '🔗 Share' });
    shareBtn.addEventListener('click', () => shareOrCopy({ title: 'AZ Tank', text: 'Play AZ Tank — bounce-shot tank battles!', url: location.origin || location.href, button: shareBtn }));
    const installCtl = this.install.control();
    const humanWon = !!(winner && winner.isHuman);
    const rewardNode = this._rewardNode({ won: humanWon, online: false });
    clear(this.matchPanel);
    this.matchPanel.appendChild(
      el('div', { style: { display: 'grid', gap: '18px', justifyItems: 'center', pointerEvents: 'auto' } }, [
        el('div.overlay__big', { text: winner ? `🏆 ${winner.name} wins the match!` : 'Match over' }),
        rewardNode,
        nearMiss ? el('p.overlay__nearmiss', { text: nearMiss }) : null,
        el('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', justifyContent: 'center' } }, [
          el('button.btn.btn--primary', { text: '↻ One more', on: { click: () => this._playAgain() } }),
          el('button.btn.btn--secondary', { text: '☰ Menu', on: { click: () => this.router.go('/') } }),
          shareBtn,
        ]),
        installCtl,
      ]),
    );
    this.matchPanel.removeAttribute('hidden');
    this.matchPanel.style.display = 'grid';
  }

  _playAgain() {
    this._rewardClaimed = false;
    this.matchPanel.setAttribute('hidden', 'hidden');
    this.matchPanel.style.display = 'none';
    if (this.phaser) this.phaser.restart();
  }
}

/** A palette entry ({base,…}) or a plain colour string → CSS colour. */
function colorOf(c) {
  if (!c) return '#fff';
  return typeof c === 'string' ? c : c.base || c.accent || '#fff';
}
function shortName(n) {
  return (n || '').length > 8 ? `${n.slice(0, 8)}…` : n || '';
}
