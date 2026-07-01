import { el } from '../ui/dom.js';
import { log } from '../core/log/Logger.js';

const ilog = log.scope('pwa');

/**
 * Captures the deferred `beforeinstallprompt` event so we can offer "Install
 * app" at a good moment (after a match — ~6× the accept rate of prompting on
 * load) instead of letting the browser's mini-infobar fire immediately. On iOS,
 * where there is no install API, it surfaces a coached "Add to Home Screen"
 * hint instead.
 */
export class InstallManager {
  constructor() {
    this._deferred = null;
    this.installed = false;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault(); // suppress the auto mini-infobar; we prompt on our terms
      this._deferred = e;
      ilog.info('install available');
    });
    window.addEventListener('appinstalled', () => {
      this.installed = true;
      this._deferred = null;
      ilog.info('app installed');
    });
  }

  get isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }
  get isStandalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
  }
  get canPrompt() {
    return !!this._deferred && !this.installed;
  }

  async prompt() {
    if (!this._deferred) return false;
    this._deferred.prompt();
    try {
      const { outcome } = await this._deferred.userChoice;
      ilog.info('install choice', { outcome });
      this._deferred = null;
      return outcome === 'accepted';
    } catch {
      this._deferred = null;
      return false;
    }
  }

  /**
   * A ready-to-drop control for a match-over panel: an install button when the
   * browser supports it, an iOS "Add to Home Screen" hint on iOS, else null.
   */
  control() {
    if (this.isStandalone || this.installed) return null;
    if (this.canPrompt) {
      const btn = el('button.btn.btn--ghost', { text: '📲 Install app' });
      btn.addEventListener('click', async () => {
        const ok = await this.prompt();
        if (ok) btn.remove();
      });
      return btn;
    }
    if (this.isIOS) {
      return el('p.install-hint', { text: 'Add to Home Screen: tap Share ⬆ then “Add to Home Screen”.' });
    }
    return null;
  }
}
