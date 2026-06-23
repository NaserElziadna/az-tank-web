/**
 * Maps world coordinates (metres) to screen pixels.
 *
 * The arena is rendered to fit the canvas with letterboxing; the camera holds
 * the scale (pixels-per-metre) and offset so renderers can work purely in world
 * units and let the camera place them on screen.
 */
export class Camera {
  constructor() {
    this.scale = 20; // pixels per metre (overwritten by fitToArena)
    this.offsetX = 0;
    this.offsetY = 0;
  }

  /**
   * Fit a world-sized arena into the canvas with uniform scale + centering.
   * @param {number} worldW metres
   * @param {number} worldH metres
   * @param {number} viewW pixels
   * @param {number} viewH pixels
   * @param {number} [padding] pixels of margin around the arena
   */
  fitToArena(worldW, worldH, viewW, viewH, padding = 24) {
    const usableW = viewW - padding * 2;
    const usableH = viewH - padding * 2;
    this.scale = Math.min(usableW / worldW, usableH / worldH);
    this.offsetX = (viewW - worldW * this.scale) / 2;
    this.offsetY = (viewH - worldH * this.scale) / 2;
  }

  worldToScreenX(x) {
    return this.offsetX + x * this.scale;
  }

  worldToScreenY(y) {
    return this.offsetY + y * this.scale;
  }
}
