/**
 * Colour palette.
 *
 * Tank colours use the original's saturated in-game set (the confetti palette);
 * slots are assigned red/green/blue/yellow first to match the classic line-up,
 * then orange/magenta. Each tank colour carries a `base` (hull/turret), a darker
 * `tread`, and a light `hi` highlight so the vector-drawn tank reads as 3D.
 */

function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255;
  let g = (n >> 8) & 255;
  let b = n & 255;
  if (amount >= 0) {
    r += (255 - r) * amount;
    g += (255 - g) * amount;
    b += (255 - b) * amount;
  } else {
    r *= 1 + amount;
    g *= 1 + amount;
    b *= 1 + amount;
  }
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}

function makeTankColor(name, hex) {
  return {
    name,
    base: hex,
    hull: hex,
    turret: shade(hex, -0.08),
    tread: shade(hex, -0.45),
    treadHi: shade(hex, -0.25),
    hi: shade(hex, 0.35),
    barrel: '#2b2b2b',
    swatch: hex,
  };
}

export const TANK_COLORS = [
  makeTankColor('Red', '#e14041'),
  makeTankColor('Green', '#17a01a'),
  makeTankColor('Blue', '#0a3bdb'),
  makeTankColor('Yellow', '#f7ef5c'),
  makeTankColor('Orange', '#dc771e'),
  makeTankColor('Magenta', '#bb169f'),
];

/** Boss tank colour — dark gunmetal armour with hot-red accents/bullets. */
export const LETHAL_TANK = {
  name: 'Lethal',
  base: '#d11f24', // projectile/HUD tint reads as menacing red
  hull: '#2c2d31',
  turret: '#202125',
  tread: '#161619',
  treadHi: '#34353a',
  hi: '#4a4b52',
  barrel: '#15151a',
  swatch: '#2c2d31',
  accent: '#ff2a2a', // glow + spikes
};

export const Palette = Object.freeze({
  // The arena reads light-on-light: near-white floor, mid/light-grey bevelled
  // walls with a soft drop shadow (matching the reference release).
  lethalTank: LETHAL_TANK,
  arenaBg: '#edeef0',
  floorA: '#ececed',
  floorB: '#e3e4e7',
  arenaShadow: 'rgba(0,0,0,0.05)',
  wall: '#8b8f97',
  wallHi: '#cdd1d8',
  wallShadow: 'rgba(0,0,0,0.16)',
  outline: 'rgba(0,0,0,0.8)',

  crate: '#b07a3c',
  crateLight: '#d9a861',
  crateDark: '#7c5326',
  crateBand: '#5a3c1c',

  gold: '#f4c93b',
  goldDark: '#c79320',
  diamond: '#2fd07a',
  diamondLight: '#a8f5cf',

  shield: 'rgba(90,170,255,0.85)',
  mine: '#444',
  mineArmed: '#d23b3b',
  laser: '#ff3b3b',

  hudText: '#ffffff',
  hudStroke: 'rgba(0,0,0,0.65)',
});

/** Pick the colour for a 0-based player slot. */
export function colorForSlot(slot) {
  return TANK_COLORS[slot % TANK_COLORS.length];
}
