/**
 * Default keyboard layouts for up to four local players. Bindings use
 * `KeyboardEvent.code` values and are mutually conflict-free, so several humans
 * can share one keyboard. Each entry carries short labels for the setup screen.
 */
export const DEFAULT_SCHEMES = [
  {
    forward: 'ArrowUp',
    back: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight',
    fire: 'KeyM',
    labels: { move: '↑ ↓ ← →', fire: 'M' },
  },
  {
    forward: 'KeyE',
    back: 'KeyD',
    left: 'KeyS',
    right: 'KeyF',
    fire: 'KeyQ',
    labels: { move: 'E S D F', fire: 'Q' },
  },
  {
    forward: 'KeyU',
    back: 'KeyJ',
    left: 'KeyH',
    right: 'KeyK',
    fire: 'KeyO',
    labels: { move: 'U H J K', fire: 'O' },
  },
  {
    forward: 'Numpad8',
    back: 'Numpad5',
    left: 'Numpad4',
    right: 'Numpad6',
    fire: 'NumpadAdd',
    labels: { move: 'Num 8 4 5 6', fire: 'Num +' },
  },
];

/** Bindings for a given 0-based slot (wraps if more players than schemes). */
export function schemeForSlot(slot) {
  return DEFAULT_SCHEMES[slot % DEFAULT_SCHEMES.length];
}
