import { el } from './dom.js';
import { settings } from '../game/services/SettingsService.js';

/**
 * A small modal settings overlay: sound on/off, master volume, and the low-FX /
 * reduce-motion toggle. Writes straight to the {@link settings} singleton; the
 * app subscribes to those changes to apply audio live, and the renderer/effects
 * read the flags directly — so this screen stays pure presentation.
 */
export class SettingsPanel {
  /** @param {{onClose:()=>void}} handlers */
  constructor({ onClose = () => {} } = {}) {
    this.onClose = onClose;
    this.root = el('div.overlay.settings', {}, [
      el('div.settings__card', {}, [
        el('div.settings__title', { text: '⚙  Settings' }),
        this._toggle('Sound', 'soundEnabled'),
        this._volume(),
        this._toggle('Reduce motion / low FX', 'reduceMotion'),
        el('p.settings__hint', { text: 'Low FX turns off screen shake, hit-pause and heavy particles — easier on the eyes and slower devices.' }),
        el('div.settings__actions', {}, [el('button.btn.btn--primary', { text: 'Done', on: { click: () => this.onClose() } })]),
      ]),
    ]);
    // Click on the dimmed backdrop (but not the card) closes.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.onClose();
    });
  }

  /** A labelled ON/OFF button bound to a boolean setting. */
  _toggle(label, key) {
    const btn = el('button.settings__toggle', {});
    const paint = () => {
      const on = settings.get(key) !== false;
      btn.textContent = on ? 'ON' : 'OFF';
      btn.classList.toggle('settings__toggle--on', on);
      btn.classList.toggle('settings__toggle--off', !on);
    };
    btn.addEventListener('click', () => {
      settings.set(key, !(settings.get(key) !== false));
      paint();
    });
    paint();
    return el('div.settings__row', {}, [el('span.settings__label', { text: label }), btn]);
  }

  /** Master-volume slider bound to the `volume` setting (0..1). */
  _volume() {
    const slider = el('input.settings__slider', {
      type: 'range',
      min: '0',
      max: '100',
      value: String(Math.round((Number(settings.get('volume')) || 0) * 100)),
    });
    slider.addEventListener('input', () => settings.set('volume', Number(slider.value) / 100));
    return el('div.settings__row', {}, [el('span.settings__label', { text: 'Volume' }), slider]);
  }
}
