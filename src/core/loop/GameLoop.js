/**
 * Fixed-timestep game loop with decoupled rendering.
 *
 * Simulation advances in fixed `step` increments (default 1/60s) so physics,
 * bullet bouncing and AI are deterministic regardless of display refresh rate;
 * rendering receives an interpolation alpha for smooth visuals between steps.
 */
export class GameLoop {
  /**
   * @param {object} opts
   * @param {(dt: number) => void} opts.update fixed-step simulation tick
   * @param {(alpha: number) => void} opts.render called once per animation frame
   * @param {number} [opts.step] seconds per simulation step
   * @param {number} [opts.maxSubSteps] cap to avoid the "spiral of death"
   */
  constructor({ update, render, step = 1 / 60, maxSubSteps = 5 }) {
    this._update = update;
    this._render = render;
    this._step = step;
    this._maxSubSteps = maxSubSteps;

    this._accumulator = 0;
    this._lastTime = 0;
    this._rafId = 0;
    this._running = false;
    this._tick = this._tick.bind(this);
  }

  get step() {
    return this._step;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._lastTime = performance.now();
    this._accumulator = 0;
    this._rafId = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = 0;
  }

  get running() {
    return this._running;
  }

  /** @param {number} now */
  _tick(now) {
    if (!this._running) return;
    this._rafId = requestAnimationFrame(this._tick);

    let frameTime = (now - this._lastTime) / 1000;
    this._lastTime = now;
    // Clamp huge gaps (tab switch / breakpoint) to keep the sim stable.
    if (frameTime > 0.25) frameTime = 0.25;

    this._accumulator += frameTime;

    let steps = 0;
    while (this._accumulator >= this._step && steps < this._maxSubSteps) {
      this._update(this._step);
      this._accumulator -= this._step;
      steps++;
    }
    // If we hit the substep cap, drop the backlog instead of compounding it.
    if (steps === this._maxSubSteps) this._accumulator = 0;

    const alpha = this._accumulator / this._step;
    this._render(alpha);
  }
}
