import { el } from './dom.js';

/**
 * Title screen. Pure presentation — it just surfaces "Play" and "How to play"
 * and reports the choice back via callbacks; the app owns navigation.
 */
export class MenuScreen {
  /** @param {{onPlay: ()=>void}} handlers */
  constructor({ onPlay }) {
    this.root = el('div.screen.menu', {}, [
      el('div.menu__logo', {}, [
        el('span.tank', { text: 'AZ TANK' }),
        el('span.trouble', { text: 'BATTLE' }),
      ]),
      el('p.menu__tagline', {
        text: 'Last tank rolling wins. Bounce your shots off the walls — and watch your own ricochets.',
      }),
      el('div.menu__actions', {}, [
        el('button.btn', { text: '▶  Play', on: { click: onPlay } }),
        el('button.btn.btn--ghost', { text: 'How to play', on: { click: () => this._toggleHelp() } }),
      ]),
      this._help(),
    ]);
  }

  _help() {
    this.helpBox = el(
      'div.menu__help',
      { hidden: 'hidden', style: { maxWidth: '560px', color: 'var(--text-dim)', lineHeight: '1.7', marginTop: '6px' } },
      [
        el('p', { text: 'Drive through the maze and be the last tank standing each round.' }),
        el('p', { text: 'Bullets bounce off walls and live for several seconds — line up bank shots, but a ricochet can kill you too.' }),
        el('p', { text: 'Grab crates for special weapons (shotgun, gatling, homing missile, mines, laser) and upgrades (shield, speed, aimer).' }),
        el('p', { text: 'Add 1–3 AI opponents or share the keyboard with friends.' }),
      ],
    );
    return this.helpBox;
  }

  _toggleHelp() {
    if (this.helpBox.hasAttribute('hidden')) this.helpBox.removeAttribute('hidden');
    else this.helpBox.setAttribute('hidden', 'hidden');
  }
}
