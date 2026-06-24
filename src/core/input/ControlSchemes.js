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
    ability: 'Space',
    labels: { move: '↑ ↓ ← →', fire: 'M', ability: 'Space' },
  },
  {
    forward: 'KeyE',
    back: 'KeyD',
    left: 'KeyS',
    right: 'KeyF',
    fire: 'KeyQ',
    ability: 'KeyW',
    labels: { move: 'E S D F', fire: 'Q', ability: 'W' },
  },
  {
    forward: 'KeyU',
    back: 'KeyJ',
    left: 'KeyH',
    right: 'KeyK',
    fire: 'KeyO',
    ability: 'KeyI',
    labels: { move: 'U H J K', fire: 'O', ability: 'I' },
  },
  {
    forward: 'Numpad8',
    back: 'Numpad5',
    left: 'Numpad4',
    right: 'Numpad6',
    fire: 'NumpadAdd',
    ability: 'Numpad7',
    labels: { move: 'Num 8 4 5 6', fire: 'Num +', ability: 'Num 7' },
  },
];

/** Bindings for a given 0-based slot (wraps if more players than schemes). */
export function schemeForSlot(slot) {
  return DEFAULT_SCHEMES[slot % DEFAULT_SCHEMES.length];
}
