import { el, clear } from './dom.js';
import { NetClient } from '../net/NetClient.js';

/**
 * Online lobby screen. Owns the {@link NetClient} for the session and walks the
 * player through: enter name → create or join a room by 4-letter code → wait in
 * the lobby → (host) start the match. When the match begins (first `roundStart`)
 * it hands the live connection up to the app to launch the networked game.
 */
export class OnlineScreen {
  /** @param {{onBack:()=>void, onLaunch:(net:NetClient)=>void}} handlers */
  constructor({ onBack, onLaunch, onRoom = () => {}, initialCode = null }) {
    this.onBack = onBack;
    this.onLaunch = onLaunch;
    this.onRoom = onRoom;
    this.initialCode = initialCode;
    this.net = new NetClient();
    this.code = null;
    this.localSlot = null;
    this.isHost = false;
    this.members = [];
    this.bots = []; // [{difficulty}] — host-configured AI roster
    this.reviveBots = true;
    this.pointsToWin = 5;
    this.maxHumans = 4;
    this.maxBots = 4;
    this.minToStart = 2;
    this.started = false;
    this._launched = false;

    this.root = el('div.screen.menu', {}, []);
    // A saved session (from a refresh / crash / dropped connection) takes priority
    // over the entry screen — try to slip back into the room we were in.
    if (!this._tryResume()) this._renderEntry();
  }

  /**
   * Reclaim a prior session if one is saved, instead of starting fresh. The
   * server reserves a dropped player's slot for a grace window; within it, a
   * refresh / reopened tab lands the player back in the same seat (mid-match it
   * relaunches straight into the live round). Falls back to entry on failure.
   */
  _tryResume() {
    const s = NetClient.savedSession();
    if (!s) return false;
    // A deep link to a *different* room is an explicit "join this one" — don't let
    // a stale saved session hijack it; fall through to the normal join instead.
    if (this.initialCode && this.initialCode !== s.code) return false;
    this._resuming = true;
    this._renderResuming();
    this._connectThen(() => this.net.sendRejoin(s.code, s.token));
    return true;
  }

  _renderResuming() {
    clear(this.root);
    this.root.appendChild(
      el('div.online', {}, [
        el('div.menu__logo', {}, [el('span.tank', { text: 'AZ TANK' }), el('span.trouble', { text: 'ONLINE' })]),
        el('p.online__waiting', { text: 'Reconnecting to your game…' }),
        el('div.menu__actions', { style: { marginTop: '18px' } }, [el('button.btn.btn--ghost', { text: '← Cancel', on: { click: () => this._leave() } })]),
      ]),
    );
  }

  // ── screens ────────────────────────────────────────────────────────────────
  _renderEntry(error) {
    clear(this.root);
    const nameInput = el('input.online__input', { type: 'text', maxlength: '12', placeholder: 'Your name', value: savedName() });
    const codeInput = el('input.online__input.online__input--code', { type: 'text', maxlength: '4', placeholder: 'CODE', value: this.initialCode || '' });
    codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));

    // Deep link (#/room/CODE) with a remembered name → join straight away.
    if (this.initialCode && !error && savedName() && !this._autoJoined) {
      this._autoJoined = true;
      this._connectThen(() => this.net.joinRoom(this.initialCode, getName(nameInput)));
    }

    this.root.appendChild(
      el('div.online', {}, [
        el('div.menu__logo', {}, [el('span.tank', { text: 'AZ TANK' }), el('span.trouble', { text: 'ONLINE' })]),
        el('p.menu__tagline', { text: 'Play with friends or jump straight in against bots. Up to 4 players per room.' }),
        error ? el('p.online__error', { text: error }) : null,
        el('div.online__row', {}, [nameInput]),
        el('div.online__actions', {}, [
          el('button.btn', { text: '＋ Create Room', on: { click: () => this._connectThen(() => this.net.createRoom(getName(nameInput))) } }),
        ]),
        el('div.online__divider', { text: 'or join with a code' }),
        el('div.online__row', {}, [
          codeInput,
          el('button.btn.btn--secondary', {
            text: 'Join',
            on: {
              click: () => {
                if (codeInput.value.length !== 4) return this._renderEntry('Enter a 4-letter room code.');
                this._connectThen(() => this.net.joinRoom(codeInput.value, getName(nameInput)));
              },
            },
          }),
        ]),
        el('div.menu__actions', { style: { marginTop: '18px' } }, [el('button.btn.btn--ghost', { text: '← Back', on: { click: () => this._leave() } })]),
      ]),
    );
  }

  _renderLobby() {
    clear(this.root);
    // Human seats — one card per real-player slot (filled or open).
    const seats = [];
    for (let i = 0; i < this.maxHumans; i++) {
      const m = this.members.find((x) => x.slot === i);
      const seatLabel = m ? `${m.name}${m.isHost ? '  ★' : ''}` : 'Open';
      seats.push(
        el('div.online__seat' + (m ? '.online__seat--filled' : ''), {}, [
          el('span.online__seat-no', { text: `P${i + 1}` }),
          el('span.online__seat-name', { text: seatLabel }),
        ]),
      );
    }
    this.root.appendChild(
      el('div.online', {}, [
        el('div.menu__logo', {}, [el('span.tank', { text: 'ROOM' }), el('span.trouble', { text: this.code })]),
        el('p.menu__tagline', { text: 'Share this code with friends. Start any time against bots — friends drop into the next round.' }),
        el('button.online__copy', { text: '🔗 Copy invite link', on: { click: (e) => this._copyLink(e.currentTarget) } }),
        el('div.online__section-label', { text: 'Players' }),
        el('div.online__seats', {}, seats),
        this._botConfig(),
        this._reviveRow(),
        this._optionRow('First to', [[3, '3'], [5, '5'], [10, '10']], this.pointsToWin, (v) => this.net.setSettings({ pointsToWin: v }), this.started),
        this._startRow(),
      ]),
    );
  }

  /** Bot roster: a count stepper plus a per-bot skill picker (host-editable). */
  _botConfig() {
    const count = this.bots.length;
    const rows = [];
    // Count stepper.
    const stepper = this.isHost
      ? el('div.online__stepper', {}, [
          el('button.online__step', { text: '−', disabled: count <= 0 ? 'disabled' : null, on: { click: () => this._setBotCount(count - 1) } }),
          el('span.online__step-val', { text: String(count) }),
          el('button.online__step', { text: '+', disabled: count >= this.maxBots ? 'disabled' : null, on: { click: () => this._setBotCount(count + 1) } }),
        ])
      : el('span.online__step-val', { text: String(count) });
    rows.push(el('div.online__option', {}, [el('span.online__option-label', { text: `AI bots (max ${this.maxBots})` }), stepper]));
    // One skill row per bot.
    const skills = [['easy', 'Easy'], ['medium', 'Med'], ['hard', 'Hard'], ['lethal', 'Lethal']];
    this.bots.forEach((b, i) => {
      rows.push(this._optionRow(`Bot ${i + 1}`, skills, b.difficulty, (v) => this._setBotSkill(i, v)));
    });
    return el('div.online__bots', {}, [el('div.online__section-label', { text: 'Bots' }), ...rows]);
  }

  /** Host: grow/shrink the bot roster, defaulting new bots to Hard. */
  _setBotCount(n) {
    if (!this.isHost) return;
    n = Math.max(0, Math.min(this.maxBots, n));
    const next = this.bots.slice(0, n);
    while (next.length < n) next.push({ difficulty: 'hard' });
    this.net.setBots(next);
  }

  /** Host: change one bot's skill. */
  _setBotSkill(i, difficulty) {
    if (!this.isHost) return;
    const next = this.bots.map((b, j) => (j === i ? { difficulty } : { difficulty: b.difficulty }));
    this.net.setBots(next);
  }

  /** Host toggle: revive killed bots while a human is alive. */
  _reviveRow() {
    const label = `Revive bots while a player lives:  ${this.reviveBots ? 'ON' : 'OFF'}`;
    if (!this.isHost) return el('p.online__hint', { text: this.reviveBots ? 'Bots respawn until a player is left standing.' : 'Bots stay down once destroyed.' });
    return el('button', { class: `online__toggle ${this.reviveBots ? 'online__toggle--on' : 'online__toggle--off'}`, text: label, on: { click: () => this.net.setSettings({ reviveBots: !this.reviveBots }) } });
  }

  /** Start button + gating: 2+ players required; late joiners see a wait notice. */
  _startRow() {
    const humans = this.members.length;
    const enough = humans >= this.minToStart;
    let primary;
    if (this.started) {
      primary = el('p.online__waiting', { text: "Match in progress — you'll join the next round." });
    } else if (!this.isHost) {
      primary = el('p.online__waiting', { text: enough ? 'Waiting for the host to start…' : `Waiting for players… (${humans}/${this.minToStart})` });
    } else if (enough) {
      primary = el('button.btn', { text: '▶  Start Match', on: { click: () => this.net.startMatch() } });
    } else {
      primary = el('div', { style: { display: 'grid', gap: '6px', justifyItems: 'center' } }, [
        el('button.btn', { text: '▶  Start Match', disabled: 'disabled' }),
        el('p.online__hint', { text: `Need at least ${this.minToStart} players — share the code above.` }),
      ]);
    }
    return el('div.menu__actions', {}, [primary, el('button.btn.btn--ghost', { text: '← Leave', on: { click: () => this._leave() } })]);
  }

  /**
   * A labelled row of selectable chips. Host can pick; everyone sees the current
   * value highlighted. `disabled` greys it out (e.g. points-to-win after start).
   * @param {[any,string][]} options [value, label] pairs
   */
  _optionRow(label, options, current, onPick, disabled = false) {
    const chips = options.map(([value, text]) => {
      const active = value === current;
      const cls = `online__chip${active ? ' online__chip--active' : ''}`;
      const interactive = this.isHost && !disabled;
      return el('button', { class: cls, text, disabled: interactive ? null : 'disabled', on: interactive ? { click: () => onPick(value) } : {} });
    });
    return el('div.online__option', {}, [el('span.online__option-label', { text: label }), el('div.online__chips', {}, chips)]);
  }

  // ── networking ─────────────────────────────────────────────────────────────
  async _connectThen(action) {
    rememberName(this.root.querySelector('.online__input')?.value);
    if (this._wired) return action();
    try {
      await this.net.connect();
    } catch {
      return this._renderEntry('Could not reach the game server. Is it running?');
    }
    this._wireHandlers();
    action();
  }

  _wireHandlers() {
    this._wired = true;
    this._unsubs = this._unsubs || [];
    const add = (type, fn) => this._unsubs.push(this.net.on(type, fn));
    add('joinResult', (m) => {
      if (!m.ok) return this._renderEntry(m.reason || 'Could not join the room.');
      this.code = m.code;
      this.localSlot = m.slot;
      this.isHost = m.isHost;
      this.onRoom(m.code); // let the app update the URL to a shareable #/room/CODE
      this._renderLobby();
    });
    add('roomState', (m) => {
      this.members = m.members || [];
      if (Array.isArray(m.bots)) this.bots = m.bots;
      if (typeof m.reviveBots === 'boolean') this.reviveBots = m.reviveBots;
      if (m.pointsToWin) this.pointsToWin = m.pointsToWin;
      if (typeof m.maxHumans === 'number') this.maxHumans = m.maxHumans;
      if (typeof m.maxBots === 'number') this.maxBots = m.maxBots;
      if (typeof m.minToStart === 'number') this.minToStart = m.minToStart;
      if (typeof m.started === 'boolean') this.started = m.started;
      const me = this.members.find((x) => x.slot === this.localSlot);
      if (me) this.isHost = me.isHost;
      if (this.code && !this._launched) this._renderLobby();
    });
    add('roundStart', (m) => {
      if (this._launched) return;
      this._launched = true;
      // Hand the first round + host/revive state to the game so it inits deterministically.
      this.onLaunch(this.net, m, { isHost: this.isHost, reviveBots: this.reviveBots, localSlot: this.localSlot });
    });
    // Resume (after a refresh/crash): the server put us back in our reserved slot.
    add('reconnected', (m) => {
      this._resuming = false;
      this.code = m.code;
      this.localSlot = m.slot;
      this.isHost = m.isHost;
      this.onRoom(m.code);
      // If the match is already running, a roundStart follows and launches the
      // game; otherwise drop straight back into the lobby.
      if (!this._launched) this._renderLobby();
    });
    add('reconnectFailed', () => {
      this._resuming = false;
      NetClient.clearSession();
      if (this._launched) return;
      // The old game is gone (or the server blipped). Don't dead-end on an error —
      // drop to the normal entry with a fresh socket so a prefilled code (deep
      // link) auto-joins, and the Join button works.
      this._resetNet();
      this._renderEntry();
    });
    add('netClose', () => {
      if (!this._launched) this._renderEntry('Disconnected from the server.');
    });
  }

  /** Drop the current socket + its handlers and start clean (after a failed resume). */
  _resetNet() {
    for (const off of this._unsubs || []) off?.();
    this._unsubs = [];
    try {
      this.net.close();
    } catch {
      /* ignore */
    }
    this.net = new NetClient();
    this._wired = false;
    this._autoJoined = false;
  }

  _copyLink(btn) {
    const url = window.location.href;
    const done = () => {
      if (btn) {
        const prev = btn.textContent;
        btn.textContent = '✓ Link copied!';
        setTimeout(() => (btn.textContent = prev), 1500);
      }
    };
    try {
      navigator.clipboard.writeText(url).then(done, done);
    } catch {
      done();
    }
  }

  _leave() {
    this.net.close();
    this.onBack();
  }

  /** Called by the app if it tears down this screen without launching. */
  dispose() {
    if (!this._launched) this.net.close();
  }
}

function getName(input) {
  return (input.value || '').trim().slice(0, 12) || 'Player';
}
function savedName() {
  try {
    return localStorage.getItem('aztank.name') || '';
  } catch {
    return '';
  }
}
function rememberName(v) {
  try {
    if (v) localStorage.setItem('aztank.name', v.trim().slice(0, 12));
  } catch {
    /* ignore */
  }
}
