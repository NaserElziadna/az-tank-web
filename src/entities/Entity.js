import { Vector2 } from '../core/math/Vector2.js';

let _nextId = 1;

/**
 * Base class for everything that lives in the round simulation.
 *
 * Entities carry a transform (position + rotation), a previous transform for
 * render interpolation, and a liveness flag. The round simulation owns the
 * authoritative update; renderers read the interpolated transform. Subclasses
 * (tanks, projectiles, crates, traps, collectibles) add their own behaviour.
 */
export class Entity {
  constructor() {
    this.id = _nextId++;
    this.position = new Vector2();
    this.rotation = 0;

    // Snapshot of the previous step, used to interpolate during render.
    this.prevPosition = new Vector2();
    this.prevRotation = 0;

    this.alive = true;
    /** Marked for removal at the end of the step. */
    this.dead = false;
  }

  /** Copy current transform into the "previous" snapshot (call before each step). */
  savePrevious() {
    this.prevPosition.copy(this.position);
    this.prevRotation = this.rotation;
  }

  /**
   * Advance the entity by one fixed step.
   * @param {number} _dt seconds
   * @param {import('../game/round/RoundSimulation.js').RoundSimulation} _sim
   */
  update(_dt, _sim) {}

  /** Request removal from the simulation. */
  destroy() {
    this.dead = true;
    this.alive = false;
  }
}
