/**
 * Composites a tank icon from the original's layered part images, reproducing
 * its exact recipe: each part is a white silhouette tinted to the player's
 * colour (via `destination-atop`), the matching shade PNG is overlaid for 3D
 * form, then an 8-direction dark smear forms the outline. One canvas is cached
 * per colour. Requires the tank part images in the {@link AssetStore}; if any
 * are missing the renderer uses its vector fallback instead.
 */
export class TankIconCompositor {
  /** @param {import('./AssetStore.js').AssetStore} assets */
  constructor(assets) {
    this.assets = assets;
    this._cache = new Map(); // color.base -> HTMLCanvasElement
  }

  /** Back→front draw order with the colour group each part is tinted with. */
  _sequence(color) {
    return [
      ['leftTread', color.tread],
      ['turret', color.base],
      ['base', color.base],
      ['rightTread', color.tread],
      ['barrel', color.base],
    ];
  }

  /** @param {object} color palette entry @returns {HTMLCanvasElement|null} */
  get(color) {
    if (this._cache.has(color.base)) return this._cache.get(color.base);
    if (!this.assets.tanksReady) return null;

    const sample = this.assets.get('tank.base');
    const w = sample.naturalWidth || sample.width;
    const h = sample.naturalHeight || sample.height;

    const comp = makeCanvas(w, h);
    const cc = comp.getContext('2d');
    for (const [part, tint] of this._sequence(color)) {
      const mask = this.assets.get(`tank.${part}`);
      const shade = this.assets.get(`tank.${part}.shade`);
      if (!mask) continue;
      cc.drawImage(this._tint(mask, tint, w, h), 0, 0);
      if (shade) cc.drawImage(shade, 0, 0);
    }

    const final = makeCanvas(w, h);
    const fc = final.getContext('2d');
    // 8-direction outline smear of an 80%-black silhouette of the composite.
    const outline = this._silhouette(comp, w, h);
    const width = 2;
    const diag = width / Math.SQRT2;
    const offsets = [
      [-width, 0], [-diag, -diag], [-diag, diag], [0, width],
      [0, -width], [diag, -diag], [diag, diag], [width, 0],
    ];
    for (const [ox, oy] of offsets) fc.drawImage(outline, ox, oy);
    fc.drawImage(comp, 0, 0);

    this._cache.set(color.base, final);
    return final;
  }

  /** Fill a buffer with `color`, then clip it to the mask's alpha. */
  _tint(mask, color, w, h) {
    const buf = makeCanvas(w, h);
    const ctx = buf.getContext('2d');
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-atop';
    ctx.drawImage(mask, 0, 0);
    return buf;
  }

  _silhouette(src, w, h) {
    const buf = makeCanvas(w, h);
    const ctx = buf.getContext('2d');
    ctx.globalCompositeOperation = 'copy';
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'destination-atop';
    ctx.drawImage(src, 0, 0);
    return buf;
  }
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
