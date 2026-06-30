/**
 * Minimal hash router. Hash routing (not History API) so it works on any static
 * host and the server's SPA fallback without extra config, and so a shared link
 * like `…/#/room/ABCD` deep-links straight into a room.
 *
 * Routes used by the app:
 *   #/            → menu (home)
 *   #/play        → local setup
 *   #/online      → online entry (create / join)
 *   #/room/CODE   → a specific room (also accepts ?key=CODE)
 *   #/lethal      → lethal duel
 */
export class Router {
  /** @param {(route:{path:string, segments:string[], query:Record<string,string>}) => void} onRoute */
  constructor(onRoute) {
    this.onRoute = onRoute;
    this._suppress = false;
    window.addEventListener('hashchange', () => {
      if (this._suppress) {
        this._suppress = false;
        return;
      }
      this._fire();
    });
  }

  start() {
    this._fire();
  }

  /** Navigate, triggering a route render. */
  go(path) {
    const target = normalize(path);
    if (currentPath() === target) this._fire(); // same hash → re-render explicitly
    else window.location.hash = target;
  }

  /** Update the URL to reflect state WITHOUT re-rendering (e.g. room created). */
  replace(path) {
    const target = normalize(path);
    if (currentPath() === target) return;
    this._suppress = true;
    window.location.hash = target;
  }

  _fire() {
    this.onRoute(parse());
  }
}

function currentPath() {
  return normalize(window.location.hash.replace(/^#/, ''));
}

function normalize(p) {
  if (!p || p === '/') return '/';
  let s = p.startsWith('/') ? p : `/${p}`;
  if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}

function parse() {
  const raw = window.location.hash.replace(/^#/, '') || '/';
  const [pathPart, queryPart = ''] = raw.split('?');
  const path = normalize(pathPart);
  const segments = path.split('/').filter(Boolean);
  const query = {};
  for (const pair of queryPart.split('&')) {
    if (!pair) continue;
    const [k, v = ''] = pair.split('=');
    query[decodeURIComponent(k)] = decodeURIComponent(v);
  }
  return { path, segments, query };
}
