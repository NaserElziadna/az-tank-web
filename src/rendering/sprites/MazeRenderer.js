import { Palette } from '../Palette.js';
import { C } from '../../constants/GameConstants.js';

const TILE = C.MAZE.TILE_SIZE;

/**
 * Renders the arena: a light floor with the original's faint checkerboard tiles,
 * and light-grey rounded wall slabs with a soft drop shadow — the clean,
 * recognisable top-down maze look. Walls are the same axis-aligned rectangles
 * the physics uses, drawn with rounded corners so the merged runs read as
 * continuous bars.
 */
export class MazeRenderer {
  /**
   * @param {CanvasRenderingContext2D} ctx world transform
   * @param {import('../../maze/Maze.js').Maze} maze
   */
  draw(ctx, maze) {
    // Floor base.
    ctx.fillStyle = Palette.arenaBg;
    ctx.fillRect(0, 0, maze.worldWidth, maze.worldHeight);

    // Faint checkerboard per tile (matches the original's floor).
    for (let x = 0; x < maze.width; x++) {
      for (let y = 0; y < maze.height; y++) {
        if (!maze.present(x, y)) continue;
        ctx.fillStyle = (x + y) % 2 === 0 ? Palette.floorA : Palette.floorB;
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }

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

    // Wall body pass — a single top-light → bottom-shade gradient across the
    // whole arena gives the slabs consistent depth (one gradient, cheap).
    const wg = ctx.createLinearGradient(0, 0, 0, maze.worldHeight);
    wg.addColorStop(0, '#9aa0a8');
    wg.addColorStop(1, '#7e828a');
    ctx.fillStyle = wg;
    ctx.beginPath();
    for (const w of maze.walls) this._slabPath(ctx, w, r);
    ctx.fill();

    // Thin, low-opacity top edge only — flat clean walls, not puffy 3D bars.
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = Palette.wallHi;
    for (const w of maze.walls) {
      ctx.fillRect(w.minX + 0.16, w.minY + 0.08, w.maxX - w.minX - 0.32, 0.12);
    }
    ctx.restore();
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
