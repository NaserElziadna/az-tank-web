import { Difficulty } from '../models/enums.js';

/**
 * AI personality as a set of 0..1 traits. Every behavioural threshold the
 * controller uses is a linear interpolation between a "dumb" and a "sharp"
 * endpoint driven by one of these traits, so difficulty is fully parameterised
 * (no branching easy/hard code paths).
 *
 *  - cleverness:     pathfinding horizon, bounce-shot depth, dodge foresight
 *  - aggressiveness:  fire willingness / how loose an alignment it shoots at
 *  - boldness:        inverse fear — how close danger must be before it flees
 *  - dexterity:       aim precision and reaction speed (low = shaky + slow)
 *  - greediness:      eagerness to chase weapon crates
 *  - vengefulness:    how strongly it fixates on whoever keeps killing it
 *  - lethal:          boss flag — unlocks the tightest cadence/reaction overrides
 */
export const AI_PROFILES = Object.freeze({
  [Difficulty.EASY]: { cleverness: 0.2, aggressiveness: 0.35, boldness: 0.35, dexterity: 0.28, greediness: 0.4, vengefulness: 0.3 },
  [Difficulty.MEDIUM]: { cleverness: 0.55, aggressiveness: 0.6, boldness: 0.55, dexterity: 0.62, greediness: 0.6, vengefulness: 0.6 },
  [Difficulty.HARD]: { cleverness: 0.9, aggressiveness: 0.85, boldness: 0.75, dexterity: 0.92, greediness: 0.75, vengefulness: 0.85 },
  [Difficulty.LETHAL]: { cleverness: 1.0, aggressiveness: 1.0, boldness: 1.0, dexterity: 1.0, greediness: 0.9, vengefulness: 1.0, lethal: true },
});

/** @param {string} difficulty */
export function profileFor(difficulty) {
  return AI_PROFILES[difficulty] || AI_PROFILES[Difficulty.MEDIUM];
}

/** Linear interpolation used pervasively for trait → threshold mapping. */
export function lerpTrait(min, max, t) {
  return min + (max - min) * t;
}
