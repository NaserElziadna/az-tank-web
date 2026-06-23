/**
 * Loads the game's image assets from `public/assets/…` at startup and exposes
 * them as ready-to-draw HTMLImageElements.
 *
 * Assets are optional: each load failure is tolerated and recorded, and the
 * renderer falls back to vector drawing for anything missing. Place your asset
 * files under `public/assets/` (see ASSETS.md) to enable the sprite look; with
 * no files present the game still runs on the built-in vector art.
 */

const BASE = 'assets';

// The tank is composited from these layered parts (silhouette + shade overlay).
const TANK_PARTS = ['base', 'leftTread', 'rightTread', 'turret', 'barrel'];

/** Build the manifest of {key: url} to attempt to load. */
function manifest(res = 320) {
  const m = {};
  for (const part of TANK_PARTS) {
    m[`tank.${part}`] = `${BASE}/tankIcon/${part}-${res}.png`;
    m[`tank.${part}.shade`] = `${BASE}/tankIcon/${part}Shade-${res}.png`;
  }
  m['game.gold'] = `${BASE}/game/gold.png`;
  m['game.diamond'] = `${BASE}/game/diamond.png`;
  m['game.diamondGlow'] = `${BASE}/game/diamondGlow.png`;
  m['game.diamondRays'] = `${BASE}/game/diamondRays.png`;
  m['game.sparkle'] = `${BASE}/game/sparkle.png`;
  m['game.celebration'] = `${BASE}/game/celebration.png`;
  m['game.sheet'] = `${BASE}/game/game.png`;
  m['menu.background'] = `${BASE}/menu/background.png`;
  m['playerPanel'] = `${BASE}/playerPanel/playerPanel.png`;
  return m;
}

export class AssetStore {
  constructor() {
    /** @type {Map<string, HTMLImageElement>} */
    this._images = new Map();
    this.loaded = false;
    /** keys that failed to load (missing files) */
    this.missing = new Set();
  }

  get(key) {
    return this._images.get(key) || null;
  }

  has(key) {
    return this._images.has(key);
  }

  /** True once at least the tank parts loaded (so sprite rendering is viable). */
  get tanksReady() {
    return TANK_PARTS.every((p) => this._images.has(`tank.${p}`) && this._images.has(`tank.${p}.shade`));
  }

  /**
   * Load everything in the manifest. Resolves when all loads settle (success or
   * failure), so a missing file never blocks startup.
   * @returns {Promise<AssetStore>}
   */
  load(res = 320) {
    const entries = Object.entries(manifest(res));
    return Promise.all(
      entries.map(
        ([key, url]) =>
          new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
              this._images.set(key, img);
              resolve();
            };
            img.onerror = () => {
              this.missing.add(key);
              resolve();
            };
            img.src = url;
          }),
      ),
    ).then(() => {
      this.loaded = true;
      return this;
    });
  }
}
