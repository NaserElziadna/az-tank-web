import { Camera } from './Camera.js';

/**
 * Thin facade over a 2D canvas context.
 *
 * Owns DPI scaling and the world↔screen transform via a {@link Camera}, and
 * exposes a small set of world-space drawing primitives so sprite renderers
 * never touch raw pixel maths or device-pixel-ratio bookkeeping.
 */
export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    this.camera = new Camera();
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
  }

  /**
   * Size the backing store to CSS pixels × devicePixelRatio for crisp output.
   * @param {number} cssWidth @param {number} cssHeight
   */
  resize(cssWidth, cssHeight) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = cssWidth;
    this.height = cssHeight;
    this.canvas.width = Math.round(cssWidth * this.dpr);
    this.canvas.height = Math.round(cssHeight * this.dpr);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
  }

  /** @param {string} color */
  clear(color) {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (color) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, this.width, this.height);
    } else {
      ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  /**
   * Apply the camera transform so subsequent draws use world (metre) units.
   * All sprite renderers run between {@link begin} and {@link end}.
   */
  begin() {
    const { ctx, camera, dpr } = this;
    ctx.setTransform(
      camera.scale * dpr,
      0,
      0,
      camera.scale * dpr,
      camera.offsetX * dpr,
      camera.offsetY * dpr,
    );
  }

  end() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Lengths given in world metres convert to a pixel line-width. */
  worldLineWidth(metres) {
    return metres;
  }
}
