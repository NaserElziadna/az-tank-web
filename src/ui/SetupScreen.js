import { el, clear } from './dom.js';
import { colorForSlot } from '../rendering/Palette.js';
import { schemeForSlot } from '../core/input/ControlSchemes.js';
import { ControllerType, Difficulty } from '../models/enums.js';

const MAX_HUMANS = 4;

/**
 * Match setup: pick tank count (2–4), assign each seat to a human or an AI (with
 * difficulty), and choose the points target. Builds a plain config object and
 * hands it to the app on Start. Re-renders its player grid reactively as choices
 * change.
 */
export class SetupScreen {
  /** @param {{onStart:(cfg:object)=>void, onBack:()=>void, initial?:object}} handlers */
  constructor({ onStart, onBack, initial = null }) {
    this.onStart = onStart;

    this.state = initial || {
      count: 2,
      pointsToWin: 5,
      players: this._defaultPlayers(2),
    };

    this.grid = el('div.players');
    this.root = el('div.screen.setup', {}, [
      el('div.setup__title', { text: 'Game Setup' }),
      el('div.setup__row', {}, [
        this._countField(),
        this._pointsField(),
      ]),
      this.grid,
      el('div.setup__row', {}, [
        el('button.btn.btn--secondary', { text: '← Back', on: { click: onBack } }),
        el('button.btn', { text: 'Start Game ▶', on: { click: () => this._start() } }),
      ]),
    ]);

    this._renderPlayers();
  }

  _defaultPlayers(count) {
    const players = [];
    for (let i = 0; i < count; i++) {
      players.push({
        controller: i === 0 ? ControllerType.HUMAN : ControllerType.AI,
        difficulty: 'medium',
        name: i === 0 ? 'You' : `CPU ${i}`,
      });
    }
    return players;
  }

  _countField() {
    const sel = el(
      'select',
      { on: { change: (e) => this._setCount(parseInt(e.target.value, 10)) } },
      [2, 3, 4].map((n) => el('option', { value: n, text: `${n} tanks`, selected: n === this.state.count ? 'selected' : null })),
    );
    return el('label.field', {}, ['Players:', sel]);
  }

  _pointsField() {
    const opts = [
      { v: 3, t: 'First to 3' },
      { v: 5, t: 'First to 5' },
      { v: 10, t: 'First to 10' },
      { v: 0, t: 'Endless' },
    ];
    const sel = el(
      'select',
      { on: { change: (e) => (this.state.pointsToWin = parseInt(e.target.value, 10)) } },
      opts.map((o) => el('option', { value: o.v, text: o.t, selected: o.v === this.state.pointsToWin ? 'selected' : null })),
    );
    return el('label.field', {}, ['Win:', sel]);
  }

  _setCount(count) {
    const players = this.state.players.slice(0, count);
    while (players.length < count) {
      const i = players.length;
      players.push({ controller: ControllerType.AI, difficulty: 'medium', name: `CPU ${i}` });
    }
    this.state.count = count;
    this.state.players = players;
    this._renderPlayers();
  }

  _renderPlayers() {
    clear(this.grid);
    this.state.players.forEach((p, i) => this.grid.appendChild(this._card(p, i)));
  }

  _card(p, slot) {
    const color = colorForSlot(slot);
    const scheme = schemeForSlot(slot);

    const swatch = el('div.player-card__swatch', { style: { background: color.base } }, [
      el('span', { style: { fontSize: '30px' }, text: '🛡' }),
    ]);

    const typeChips = el('div.player-card__type', {}, [
      this._chip('Human', p.controller === ControllerType.HUMAN, () => {
        p.controller = ControllerType.HUMAN;
        this._renderPlayers();
      }),
      this._chip('AI', p.controller === ControllerType.AI, () => {
        p.controller = ControllerType.AI;
        this._renderPlayers();
      }),
    ]);

    const detail =
      p.controller === ControllerType.AI
        ? el('div.player-card__type', {}, [
            this._chip('Easy', p.difficulty === Difficulty.EASY, () => this._setDiff(p, Difficulty.EASY)),
            this._chip('Med', p.difficulty === 'medium', () => this._setDiff(p, 'medium')),
            this._chip('Hard', p.difficulty === Difficulty.HARD, () => this._setDiff(p, Difficulty.HARD)),
          ])
        : el('div.player-card__keys', {}, [
            el('div', { text: `Move: ${scheme.labels.move}` }),
            el('div', { text: `Fire: ${scheme.labels.fire}` }),
          ]);

    const nameInput = el('input', {
      value: p.name,
      maxlength: '12',
      style: {
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid rgba(255,255,255,0.15)',
        color: '#fff',
        textAlign: 'center',
        fontWeight: '700',
        fontSize: '16px',
        width: '120px',
        fontFamily: 'inherit',
      },
      on: { input: (e) => (p.name = e.target.value.slice(0, 12) || `P${slot + 1}`) },
    });

    const humanCount = this.state.players.filter((q) => q.controller === ControllerType.HUMAN).length;
    const card = el('div.player-card', { dataset: { active: 'true' } }, [swatch, nameInput, typeChips, detail]);
    if (p.controller === ControllerType.HUMAN && humanCount > MAX_HUMANS) card.dataset.active = 'false';
    return card;
  }

  _setDiff(p, d) {
    p.difficulty = d;
    this._renderPlayers();
  }

  _chip(label, selected, onClick) {
    return el('button.chip', { text: label, dataset: { selected: selected ? 'true' : 'false' }, on: { click: onClick } });
  }

  _start() {
    this.onStart({
      pointsToWin: this.state.pointsToWin,
      players: this.state.players.map((p, i) => ({
        slot: i,
        name: p.name || `P${i + 1}`,
        controller: p.controller,
        difficulty: p.difficulty,
      })),
    });
  }
}
