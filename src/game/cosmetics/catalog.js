import { makeTankColor } from '../../rendering/Palette.js';

/**
 * Cosmetic catalog — LOOKS only, never stats (authoritative PvP means any earned
 * advantage is pay/grind-to-win). Two slots: tank `color` and movement `trail`.
 * Items carry a coin `cost` (0 = free starter) forming a fixed unlock ladder;
 * the generous free set means a player is never "naked".
 *
 * ids are namespaced (`color:red`, `trail:ember`) and are what's stored in the
 * profile's `unlocked[]` / `equipped{}`.
 */

/** Tank colours. The first four are the classic free starters. */
const COLORS = [
  { id: 'color:red', name: 'Red', cost: 0, hex: '#e14041' },
  { id: 'color:green', name: 'Green', cost: 0, hex: '#17a01a' },
  { id: 'color:blue', name: 'Blue', cost: 0, hex: '#0a3bdb' },
  { id: 'color:yellow', name: 'Yellow', cost: 0, hex: '#f7ef5c' },
  { id: 'color:orange', name: 'Orange', cost: 300, hex: '#dc771e' },
  { id: 'color:magenta', name: 'Magenta', cost: 300, hex: '#bb169f' },
  { id: 'color:cyan', name: 'Cyan', cost: 500, hex: '#13b6c4' },
  { id: 'color:purple', name: 'Purple', cost: 500, hex: '#7a3cd0' },
  { id: 'color:mint', name: 'Mint', cost: 800, hex: '#2fd07a' },
  { id: 'color:coral', name: 'Coral', cost: 800, hex: '#ff6f61' },
  { id: 'color:slate', name: 'Slate', cost: 1200, hex: '#5b6470' },
  { id: 'color:gold', name: 'Gold', cost: 2000, hex: '#f4c93b' },
].map((c) => ({ ...c, type: 'color', color: makeTankColor(c.name, c.hex) }));

/**
 * Movement trails — a client-side render effect behind your own tank. `rgb` is
 * the particle colour ('rainbow' cycles hue). `none` is the free default.
 */
const TRAILS = [
  { id: 'trail:none', name: 'None', cost: 0, rgb: null },
  { id: 'trail:ember', name: 'Ember', cost: 250, rgb: '255,140,40' },
  { id: 'trail:ice', name: 'Ice', cost: 250, rgb: '120,200,255' },
  { id: 'trail:toxic', name: 'Toxic', cost: 400, rgb: '120,240,90' },
  { id: 'trail:violet', name: 'Violet', cost: 400, rgb: '180,110,255' },
  { id: 'trail:mono', name: 'Mono', cost: 600, rgb: '235,235,235' },
  { id: 'trail:rainbow', name: 'Rainbow', cost: 1500, rgb: 'rainbow' },
].map((t) => ({ ...t, type: 'trail' }));

export const COSMETICS = [...COLORS, ...TRAILS];
const BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));

/** All items of a slot ('color' | 'trail'), in ladder order. */
export function cosmeticsOfType(type) {
  return COSMETICS.filter((c) => c.type === type);
}

/** Look up a cosmetic by id (or null). */
export function cosmetic(id) {
  return BY_ID.get(id) || null;
}

/** The free starter set (cost 0) — unlocked for every player from the start. */
export function starterUnlocks() {
  return COSMETICS.filter((c) => c.cost === 0).map((c) => c.id);
}

/** Sensible default equipped loadout. */
export const DEFAULT_EQUIPPED = { color: 'color:red', trail: 'trail:none' };
