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

  /**
   * Zoom-and-follow: center on a focus point at a fixed scale, clamped so the
   * arena always fills the view (no empty space past the walls). Used on mobile
   * so the player's tank is large and readable instead of a tiny full-arena dot.
   */
  follow(focusX, focusY, worldW, worldH, viewW, viewH, scale) {
    this.scale = scale;
    const w = worldW * scale;
    const h = worldH * scale;
    let ox = viewW / 2 - focusX * scale;
    let oy = viewH / 2 - focusY * scale;
    ox = w <= viewW ? (viewW - w) / 2 : Math.min(0, Math.max(viewW - w, ox));
    oy = h <= viewH ? (viewH - h) / 2 : Math.min(0, Math.max(viewH - h, oy));
    this.offsetX = ox;
    this.offsetY = oy;
  }

  worldToScreenX(x) {
    return this.offsetX + x * this.scale;
  }

  worldToScreenY(y) {
    return this.offsetY + y * this.scale;
  }
}
