/**
 * Persists user preferences (sound, feel, last match setup) to localStorage.
 *
 * A small facade over storage with safe fallbacks so the game still runs in
 * private-mode browsers where storage may throw. Exposed as a module singleton
 * ({@link settings}) so any subsystem (audio, renderer, effects) can read the
 * current preference cheaply (values are cached in memory) without threading it
 * through every constructor. A tiny change subscription lets UI react live.
 */
const KEY = 'az-tank:settings:v1';

/** True when the OS asks for reduced motion — a sensible default for low-FX. */
function prefersReducedMotion() {
  try {
    return typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

const DEFAULTS = {
  soundEnabled: true,
  volume: 0.5,
  reduceMotion: false, // low-FX: no screen shake, no hit-pause, fewer particles
  pointsToWin: 0, // 0 = endless
  mode: 'classic', // last selected game mode (see GameMode ids)
  lastSetup: null,
};

export class SettingsService {
  constructor() {
    this._data = { ...DEFAULTS, ...this._load() };
    // Adopt the OS reduced-motion preference the first time we run, so notched /
    // accessibility users get the calmer experience without digging into a menu.
    if (this._load().reduceMotion == null && prefersReducedMotion()) this._data.reduceMotion = true;
    this._listeners = new Set();
  }

  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  }

  _save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this._data));
    } catch {
      /* storage unavailable — ignore */
    }
  }

  get(key) {
    return this._data[key];
  }

  set(key, value) {
    this._data[key] = value;
    this._save();
    this._emit(key, value);
  }

  all() {
    return { ...this._data };
  }

  /** Subscribe to changes; returns an unsubscribe fn. Called as (key, value). */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit(key, value) {
    for (const fn of this._listeners) {
      try {
        fn(key, value);
      } catch {
        /* a listener must never break set() */
      }
    }
  }
}

/** Process-wide settings. Import this everywhere instead of constructing one. */
export const settings = new SettingsService();
