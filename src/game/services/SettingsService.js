/**
 * Persists user preferences (sound, last match setup) to localStorage.
 *
 * A small facade over storage with safe fallbacks so the game still runs in
 * private-mode browsers where storage may throw.
 */
const KEY = 'az-tank:settings:v1';

const DEFAULTS = {
  soundEnabled: true,
  volume: 0.5,
  pointsToWin: 0, // 0 = endless
  lastSetup: null,
};

export class SettingsService {
  constructor() {
    this._data = { ...DEFAULTS, ...this._load() };
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
  }

  all() {
    return { ...this._data };
  }
}
