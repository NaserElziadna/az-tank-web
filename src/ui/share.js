import { log } from '../core/log/Logger.js';

const slog = log.scope('share');

/**
 * Share a link via the native share sheet ({@link navigator.share}) when it's
 * available (mobile, some desktops), otherwise copy it to the clipboard. Either
 * way the button flashes confirmation feedback. The room link is the game's #1
 * growth lever, so this is deliberately one tap.
 *
 * @param {{title?:string, text?:string, url?:string, button?:HTMLElement, copiedLabel?:string}} opts
 */
export async function shareOrCopy({ title = 'AZ Tank', text = '', url = location.href, button = null, copiedLabel = '✓ Link copied!' } = {}) {
  const flash = (label) => {
    if (!button) return;
    const prev = button.textContent;
    button.textContent = label;
    setTimeout(() => (button.textContent = prev), 1600);
  };
  // Native share sheet first (best on mobile). A user-cancelled share is not an
  // error — swallow AbortError and don't fall back to the clipboard for it.
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      slog.info('shared via native sheet');
      return true;
    } catch (err) {
      if (err && err.name === 'AbortError') return false;
      slog.info('native share unavailable, copying', { message: err?.message });
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    flash(copiedLabel);
    return true;
  } catch {
    // Last resort: a transient prompt so the user can copy manually.
    try {
      window.prompt('Copy this link:', url);
    } catch {
      /* ignore */
    }
    return false;
  }
}
