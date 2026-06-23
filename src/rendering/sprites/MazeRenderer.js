import { Palette } from '../Palette.js';

/**
 * Renders the arena: a light floor and dark, rounded wall slabs with a soft
 * drop shadow — the clean, recognisable top-down maze look. Walls are the same
 * axis-aligned rectangles the physics uses, drawn with rounded corners so the
 * merged runs read as continuous bars.
 */
export class MazeRenderer {
  /**
   * @param {CanvasRenderingContext2D} ctx world transform
   * @param {import('../../maze/Maze.js').Maze} maze
   */
  draw(ctx, maze) {
    // Floor.
    ctx.fillStyle = Palette.arenaBg;
    ctx.fillRect(0, 0, maze.worldWidth, maze.worldHeight);

    // Subtle inner vignette so the play-field has depth.
    ctx.save();
    ctx.fillStyle = Palette.arenaShadow;
    ctx.fillRect(0, 0, maze.worldWidth, 0.5);
    ctx.fillRect(0, 0, 0.5, maze.worldHeight);
    ctx.restore();

    const r = 0.42;

    // Shadow pass (single path → one fill).
    ctx.save();
    ctx.translate(0.18, 0.26);
    ctx.fillStyle = Palette.wallShadow;
    ctx.beginPath();
    for (const w of maze.walls) this._slabPath(ctx, w, r);
    ctx.fill();
    ctx.restore();

    // Wall body pass.
    ctx.fillStyle = Palette.wall;
    ctx.beginPath();
    for (const w of maze.walls) this._slabPath(ctx, w, r);
    ctx.fill();

    // Top highlight strip.
    ctx.fillStyle = Palette.wallHi;
    for (const w of maze.walls) {
      const hh = (w.maxY - w.minY) * 0.32;
      ctx.fillRect(w.minX + 0.12, w.minY + 0.1, w.maxX - w.minX - 0.24, Math.min(hh, 0.3));
    }
  }

  _slabPath(ctx, w, r) {
    const x = w.minX;
    const y = w.minY;
    const ww = w.maxX - w.minX;
    const hh = w.maxY - w.minY;
    const rr = Math.min(r, ww / 2, hh / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + ww, y, x + ww, y + hh, rr);
    ctx.arcTo(x + ww, y + hh, x, y + hh, rr);
    ctx.arcTo(x, y + hh, x, y, rr);
    ctx.arcTo(x, y, x + ww, y, rr);
    ctx.closePath();
  }
}
