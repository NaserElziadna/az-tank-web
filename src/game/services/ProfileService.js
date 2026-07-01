import { cosmetic, starterUnlocks, DEFAULT_EQUIPPED } from '../cosmetics/catalog.js';

/**
 * Account-light player profile: XP/level, coins, unlocked cosmetics and the
 * equipped loadout, plus a daily streak. Phase-1 is localStorage-only (per
 * device, editable — fine for a friendly cosmetic-only game); a signed backend
 * comes later only if cross-device sync matters.
 *
 * Everything here is LOOKS + soft currency — never a gameplay stat.
 */
const KEY = 'az-tank:profile:v1';

/** XP needed to advance FROM level L to L+1 (gentle ramp). */
function xpToNext(level) {
  return 100 + (level - 1) * 60;
}
/** Derive level (1-based) + progress from total XP. */
function levelFromXp(totalXp) {
  let level = 1;
  let rem = totalXp;
  while (rem >= xpToNext(level)) {
    rem -= xpToNext(level);
    level++;
  }
  return { level, into: rem, need: xpToNext(level) };
}

/** Local YYYY-MM-DD for the streak (local time, matching the player's day). */
function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

const DEFAULTS = () => ({
  xp: 0,
  coins: 0,
  unlocked: starterUnlocks(),
  equipped: { ...DEFAULT_EQUIPPED },
  streak: { count: 0, lastDay: null, best: 0 },
});

export class ProfileService {
  constructor() {
    this._data = { ...DEFAULTS(), ...this._load() };
    // Repair: ensure starters are always owned and the equipped ids are valid.
    const owned = new Set([...(this._data.unlocked || []), ...starterUnlocks()]);
    this._data.unlocked = [...owned];
    this._data.equipped = { ...DEFAULT_EQUIPPED, ...(this._data.equipped || {}) };
    for (const slot of Object.keys(this._data.equipped)) {
      if (!owned.has(this._data.equipped[slot])) this._data.equipped[slot] = DEFAULT_EQUIPPED[slot];
    }
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
    this._emit();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  _emit() {
    for (const fn of this._listeners) {
      try {
        fn(this);
      } catch {
        /* a listener must never break a mutation */
      }
    }
  }

  // ── read ──────────────────────────────────────────────────────────────────
  get coins() {
    return this._data.coins;
  }
  get xp() {
    return this._data.xp;
  }
  get level() {
    return levelFromXp(this._data.xp).level;
  }
  /** {level, into, need} for a progress bar. */
  get levelProgress() {
    return levelFromXp(this._data.xp);
  }
  get streak() {
    return { ...this._data.streak };
  }
  get unlocked() {
    return [...this._data.unlocked];
  }
  isUnlocked(id) {
    return this._data.unlocked.includes(id);
  }
  equippedId(slot) {
    return this._data.equipped[slot] || DEFAULT_EQUIPPED[slot] || null;
  }
  equippedCosmetic(slot) {
    return cosmetic(this.equippedId(slot));
  }

  // ── mutate ──────────────────────────────────────────────────────────────
  addCoins(n) {
    this._data.coins = Math.max(0, this._data.coins + Math.round(n));
    this._save();
  }

  /** Add XP; returns {leveledUp, level} so the UI can celebrate a level-up. */
  addXp(n) {
    const before = this.level;
    this._data.xp = Math.max(0, this._data.xp + Math.round(n));
    const after = this.level;
    this._save();
    return { leveledUp: after > before, level: after };
  }

  /** Buy/unlock a cosmetic if affordable & not owned. Returns true on success. */
  unlock(id) {
    const item = cosmetic(id);
    if (!item || this.isUnlocked(id)) return false;
    if (this._data.coins < item.cost) return false;
    this._data.coins -= item.cost;
    this._data.unlocked.push(id);
    this._save();
    return true;
  }

  /** Equip an owned cosmetic in its slot. Returns true on success. */
  equip(id) {
    const item = cosmetic(id);
    if (!item || !this.isUnlocked(id)) return false;
    this._data.equipped[item.type] = id;
    this._save();
    return true;
  }

  /**
   * Register a play session for the daily streak. A single missed day is
   * forgiven (streak survives); a longer gap resets it. Returns
   * {count, reward, advanced} — reward coins are 0 unless it's a new day.
   */
  touchDaily(now = new Date()) {
    const today = todayKey(now);
    const s = this._data.streak;
    if (s.lastDay === today) return { count: s.count, reward: 0, advanced: false };
    const gap = s.lastDay ? dayNumber(today) - dayNumber(s.lastDay) : 999;
    if (gap <= 2) s.count = (s.count || 0) + 1; // consecutive, or one forgiven miss
    else s.count = 1; // streak lapsed — start over
    s.lastDay = today;
    s.best = Math.max(s.best || 0, s.count);
    const reward = Math.min(s.count, 7) * 20; // caps at 140/day so it never gates play
    this._data.coins += reward;
    this._save();
    return { count: s.count, reward, advanced: true };
  }
}

/** Process-wide profile. Import this everywhere. */
export const profile = new ProfileService();
