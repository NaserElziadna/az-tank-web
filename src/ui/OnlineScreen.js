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
  constructor({ onBack, onLaunch }) {
    this.onBack = onBack;
    this.onLaunch = onLaunch;
    this.net = new NetClient();
    this.code = null;
    this.localSlot = null;
    this.isHost = false;
    this.members = [];
    this.fillBots = true;
    this.difficulty = 'hard';
    this.pointsToWin = 5;
    this._launched = false;

    this.root = el('div.screen.menu', {}, []);
    this._renderEntry();
  }

  // ── screens ────────────────────────────────────────────────────────────────
  _renderEntry(error) {
    clear(this.root);
    const nameInput = el('input.online__input', { type: 'text', maxlength: '12', placeholder: 'Your name', value: savedName() });
    const codeInput = el('input.online__input.online__input--code', { type: 'text', maxlength: '4', placeholder: 'CODE' });
    codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));

    this.root.appendChild(
      el('div.online', {}, [
        el('div.menu__logo', {}, [el('span.tank', { text: 'AZ TANK' }), el('span.trouble', { text: 'ONLINE' })]),
        el('p.menu__tagline', { text: 'Play with friends. Create a room and share the code — empty seats fill with bots.' }),
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
    const seats = [];
    for (let i = 0; i < 4; i++) {
      const m = this.members.find((x) => x.slot === i);
      const seatLabel = m ? `${m.name}${m.isHost ? '  ★' : ''}` : this.fillBots ? 'Bot (AI)' : 'Open';
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
        el('p.menu__tagline', { text: this.fillBots ? 'Share this code with friends. Empty seats play as bots.' : 'Share this code with friends. Empty seats stay open.' }),
        el('div.online__seats', {}, seats),
        this._botToggle(),
        this._optionRow('Bot skill', [['easy', 'Easy'], ['medium', 'Medium'], ['hard', 'Hard'], ['lethal', 'Lethal']], this.difficulty, (v) => this.net.setSettings({ difficulty: v })),
        this._optionRow('First to', [[3, '3'], [5, '5'], [10, '10']], this.pointsToWin, (v) => this.net.setSettings({ pointsToWin: v }), this.started),
        el('div.menu__actions', {}, [
          this.isHost
            ? el('button.btn', { text: '▶  Start Match', on: { click: () => this.net.startMatch() } })
            : el('p.online__waiting', { text: 'Waiting for the host to start…' }),
          el('button.btn.btn--ghost', { text: '← Leave', on: { click: () => this._leave() } }),
        ]),
      ]),
    );
  }

  /** Host-only toggle for filling empty seats with AI bots. */
  _botToggle() {
    const label = `Fill empty seats with bots:  ${this.fillBots ? 'ON' : 'OFF'}`;
    if (!this.isHost) return el('p.online__hint', { text: this.fillBots ? 'Empty seats are bots.' : 'Empty seats stay open.' });
    return el('button', { class: `online__toggle ${this.fillBots ? 'online__toggle--on' : 'online__toggle--off'}`, text: label, on: { click: () => this.net.setFillBots(!this.fillBots) } });
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
    this.net.on('joinResult', (m) => {
      if (!m.ok) return this._renderEntry(m.reason || 'Could not join the room.');
      this.code = m.code;
      this.localSlot = m.slot;
      this.isHost = m.isHost;
      this._renderLobby();
    });
    this.net.on('roomState', (m) => {
      this.members = m.members || [];
      if (typeof m.fillBots === 'boolean') this.fillBots = m.fillBots;
      if (m.difficulty) this.difficulty = m.difficulty;
      if (m.pointsToWin) this.pointsToWin = m.pointsToWin;
      if (typeof m.started === 'boolean') this.started = m.started;
      const me = this.members.find((x) => x.slot === this.localSlot);
      if (me) this.isHost = me.isHost;
      if (this.code && !this._launched) this._renderLobby();
    });
    this.net.on('roundStart', (m) => {
      if (this._launched) return;
      this._launched = true;
      // Hand the first round + host/fill state to the game so it inits deterministically.
      this.onLaunch(this.net, m, { isHost: this.isHost, fillBots: this.fillBots });
    });
    this.net.on('netClose', () => {
      if (!this._launched) this._renderEntry('Disconnected from the server.');
    });
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
