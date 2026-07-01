import { el } from './dom.js';

/**
 * Title screen. Pure presentation — it just surfaces "Play" and "How to play"
 * and reports the choice back via callbacks; the app owns navigation.
 */
export class MenuScreen {
  /** @param {{onQuickPlay?:()=>void, onPlay: ()=>void, onLethal?: ()=>void, onOnline?: ()=>void, onLocker?: ()=>void, onSettings?: ()=>void}} handlers */
  constructor({ onQuickPlay, onPlay, onLethal, onOnline, onLocker, onSettings }) {
    this.root = el('div.screen.menu', {}, [
      onSettings ? el('button.menu__gear', { text: '⚙', title: 'Settings', 'aria-label': 'Settings', on: { click: onSettings } }) : null,
      el('div.menu__logo', {}, [
        el('span.tank', { text: 'AZ TANK' }),
        el('span.trouble', { text: 'BATTLE' }),
      ]),
      el('p.menu__tagline', {
        text: 'Last tank rolling wins. Bounce your shots off the walls — and watch your own ricochets.',
      }),
      el('div.menu__actions', {}, [
        // "Just play" — the fastest path to gameplay: an instant local vs-bots
        // match, no setup screen (the top retention lever is killing dead time).
        onQuickPlay ? el('button.btn.btn--primary', { text: '⚡  Quick Play (vs bots)', on: { click: onQuickPlay } }) : null,
        el('button.btn', { text: '▶  Play (setup)', on: { click: onPlay } }),
        onOnline ? el('button.btn.btn--online', { text: '🌐  Play Online', on: { click: onOnline } }) : null,
        el('button.btn.btn--lethal', { text: '☠  Lethal Mode', on: { click: onLethal || onPlay } }),
        onLocker ? el('button.btn.btn--secondary', { text: '🎨  Locker', on: { click: onLocker } }) : null,
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
        el('p', { text: '☠ Lethal Mode: a 1-v-1 duel against one relentless, faster, dead-eye tank. First to 5 wins.' }),
      ],
    );
    return this.helpBox;
  }

  _toggleHelp() {
    if (this.helpBox.hasAttribute('hidden')) this.helpBox.removeAttribute('hidden');
    else this.helpBox.setAttribute('hidden', 'hidden');
  }
}
