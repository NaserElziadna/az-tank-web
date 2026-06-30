/**
 * Server-side controller for a human player connected over the network.
 *
 * Implements the same `think(dt, sim) → intent` contract the local AI/keyboard
 * controllers use, so the authoritative B2Match treats a remote human exactly
 * like any other tank. The client streams held input; we translate the `ability`
 * held-bool into a one-shot rising edge here so a single press fires once
 * regardless of input/sim rates or duplicate packets.
 */
export class NetController {
  constructor() {
    this._drive = 0;
    this._turn = 0;
    this._fire = false;
    this._abilityHeld = false;
    this._abilityEdge = false; // pending one-shot, consumed by think()
  }

  /** @param {{drive?:number,turn?:number,fire?:boolean,ability?:boolean}} input */
  setInput(input) {
    this._drive = clampAxis(input.drive);
    this._turn = clampAxis(input.turn);
    this._fire = !!input.fire;
    const ability = !!input.ability;
    if (ability && !this._abilityHeld) this._abilityEdge = true; // rising edge
    this._abilityHeld = ability;
  }

  /** Called once per simulation step by the round. */
  think() {
    const abilityPressed = this._abilityEdge;
    this._abilityEdge = false;
    return { drive: this._drive, turn: this._turn, fire: this._fire, firePressed: false, abilityPressed };
  }

  /** Stop driving (used when a player disconnects but their tank lingers). */
  neutral() {
    this._drive = 0;
    this._turn = 0;
    this._fire = false;
    this._abilityHeld = false;
    this._abilityEdge = false;
  }
}

function clampAxis(v) {
  if (v > 0) return 1;
  if (v < 0) return -1;
  return 0;
}
