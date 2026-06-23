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
  makeTankColor('Yellow', '#f2c200'),
  makeTankColor('Orange', '#dc771e'),
  makeTankColor('Magenta', '#bb169f'),
];

export const Palette = Object.freeze({
  arenaBg: '#e9e9e9',
  arenaShadow: 'rgba(0,0,0,0.06)',
  wall: '#3a3d44',
  wallHi: '#4c5059',
  wallShadow: 'rgba(0,0,0,0.22)',
  outline: 'rgba(0,0,0,0.82)',

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
