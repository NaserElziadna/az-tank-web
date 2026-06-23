// Load Phaser CE in a bundler-safe way.
//
// Phaser CE's PIXI, p2 and Phaser builds reference *each other* as globals
// (PIXI.DisplayObject reads `Phaser`; Phaser.Stage reads `PIXI`/`p2`). Under a
// bundler none of those globals exist, so all three must be published on the
// global object before a Phaser.Game boots (boot is async, so setting them here
// — before any Game is constructed — is in time).
import './phaserGlobals.js'; // publishes globalThis.PIXI + globalThis.p2
import PhaserMod from 'phaser-ce/build/custom/phaser-split.js';

const Phaser = (PhaserMod && PhaserMod.default) || PhaserMod;
const g = typeof globalThis !== 'undefined' ? globalThis : window;
g.Phaser = Phaser;

export default Phaser;
