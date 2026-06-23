/**
 * Phaser CE's main build references `PIXI` and `p2` as pre-existing globals,
 * which don't exist when a bundler (Vite/Rollup) loads Phaser as a module —
 * hence "PIXI is not defined". The fix (the same one Phaser's webpack guide
 * uses via expose-loader) is to load the standalone PIXI/p2 custom builds and
 * publish them on the global object *before* the split Phaser build evaluates.
 *
 * This module has no exports — it is imported purely for that side effect, and
 * must be imported before `phaser-split` (see phaserLib.js). ES module
 * evaluation order guarantees this module's body runs first.
 */
import PIXImod from 'phaser-ce/build/custom/pixi.js';
import p2mod from 'phaser-ce/build/custom/p2.js';

const PIXI = (PIXImod && PIXImod.default) || PIXImod;
const p2 = (p2mod && p2mod.default) || p2mod;

const g = typeof globalThis !== 'undefined' ? globalThis : window;
g.PIXI = PIXI;
g.p2 = p2;
