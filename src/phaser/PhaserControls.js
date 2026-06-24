/**
 * Adapts a player's key bindings (KeyboardEvent.code strings) to Phaser CE Key
 * objects and reports the same {@link ControlIntent} the tanks consume. Fire
 * edge-detection lives in the weapon (it tracks the rising edge), so this only
 * needs the held state.
 */

// Map our binding code strings to Phaser/JS keyCodes.
const CODE_TO_KEYCODE = {
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Space: 32,
  KeyM: 77,
  KeyQ: 81,
  KeyE: 69,
  KeyS: 83,
  KeyD: 68,
  KeyF: 70,
  KeyU: 85,
  KeyH: 72,
  KeyJ: 74,
  KeyK: 75,
  KeyO: 79,
  KeyW: 87,
  KeyI: 73,
  Numpad8: 104,
  Numpad5: 101,
  Numpad4: 100,
  Numpad6: 102,
  Numpad7: 103,
  NumpadAdd: 107,
};

export class PhaserControls {
  /**
   * @param {Phaser.Game} game
   * @param {{forward:string,back:string,left:string,right:string,fire:string}} bindings
   */
  constructor(game, bindings) {
    const kb = game.input.keyboard;
    const key = (code) => kb.addKey(CODE_TO_KEYCODE[code]);
    this.forward = key(bindings.forward);
    this.back = key(bindings.back);
    this.left = key(bindings.left);
    this.right = key(bindings.right);
    this.fire = key(bindings.fire);
    this.ability = bindings.ability ? key(bindings.ability) : null;
    this._abilityPrev = false;
    // Stop arrows / space from scrolling the page.
    kb.addKeyCapture([37, 38, 39, 40, 32]);
  }

  /** @returns {import('../core/input/ControlScheme.js').ControlIntent} */
  read() {
    const abilityDown = this.ability ? this.ability.isDown : false;
    const abilityPressed = abilityDown && !this._abilityPrev; // rising edge
    this._abilityPrev = abilityDown;
    return {
      drive: (this.forward.isDown ? 1 : 0) - (this.back.isDown ? 1 : 0),
      turn: (this.right.isDown ? 1 : 0) - (this.left.isDown ? 1 : 0),
      fire: this.fire.isDown,
      firePressed: false,
      abilityPressed,
    };
  }
}
