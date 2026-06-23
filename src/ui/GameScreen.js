import { el, clear } from './dom.js';

/**
 * In-game screen: the canvas stage plus a DOM overlay for crisp text
 * (countdown, round result, match winner) and a top-bar menu button. The canvas
 * is owned here; the app attaches the {@link GameRenderer} to it. Overlay state
 * is pushed in each frame by the app from the controller's phase.
 */
export class GameScreen {
  /** @param {{onMenu:()=>void, onPlayAgain:()=>void}} handlers */
  constructor({ onMenu, onPlayAgain }) {
    this.onMenu = onMenu;
    this.onPlayAgain = onPlayAgain;

    this.canvas = el('canvas#game-canvas');
    this.overlayBig = el('div.overlay__big');
    this.overlaySub = el('div.overlay__sub');
    this.overlay = el('div.overlay', {}, [el('div', {}, [this.overlayBig, this.overlaySub])]);
    this.matchPanel = el('div.overlay', { hidden: 'hidden' });

    this.stage = el('div.game__stage', {}, [
      this.canvas,
      this.overlay,
      this.matchPanel,
      el('div.topbar', {}, [el('button.btn--ghost', { text: '☰ Menu', on: { click: onMenu } }), el('span')]),
    ]);
    this.root = el('div.screen.game', {}, [this.stage]);

    this._lastBig = null;
  }

  /** @param {string} big @param {string} [sub] */
  setOverlay(big, sub = '') {
    if (big !== this._lastBig) {
      // Re-trigger a subtle pop when the headline changes.
      this.overlayBig.style.animation = 'none';
      void this.overlayBig.offsetWidth;
      this.overlayBig.style.animation = '';
      this._lastBig = big;
    }
    this.overlayBig.textContent = big;
    this.overlaySub.textContent = sub;
    this.overlay.style.display = big || sub ? 'grid' : 'none';
  }

  clearOverlay() {
    this.setOverlay('', '');
  }

  /** @param {string} title @param {string} sub */
  showMatchOver(title, sub) {
    this.clearOverlay();
    clear(this.matchPanel);
    this.matchPanel.appendChild(
      el('div', { style: { display: 'grid', gap: '18px', justifyItems: 'center', pointerEvents: 'auto' } }, [
        el('div.overlay__big', { text: title }),
        el('div.overlay__sub', { text: sub }),
        el('div', { style: { display: 'flex', gap: '14px', marginTop: '8px' } }, [
          el('button.btn', { text: '↻ Play Again', on: { click: this.onPlayAgain } }),
          el('button.btn.btn--secondary', { text: '☰ Menu', on: { click: this.onMenu } }),
        ]),
      ]),
    );
    this.matchPanel.removeAttribute('hidden');
    this.matchPanel.style.display = 'grid';
  }

  hideMatchOver() {
    this.matchPanel.setAttribute('hidden', 'hidden');
    this.matchPanel.style.display = 'none';
  }
}
