/*
 * AZ Tank service worker — makes the client installable and fast on repeat
 * loads, while NEVER interfering with realtime traffic.
 *
 * Strategy:
 *  - navigations  → network-first, fall back to the cached app shell (offline).
 *  - static GETs  → stale-while-revalidate (serve cache instantly, refresh bg).
 *  - /ws, /log, cross-origin, non-GET → untouched (pass straight to network).
 *
 * Built asset names are content-hashed, so we don't precache a fixed list; the
 * cache fills as the app loads and self-heals on the next visit.
 */
const CACHE = 'az-tank-v1';
const SHELL = ['/', '/index.html', '/icon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL).catch(() => {})));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // let cross-origin (portal/ads) pass
  if (url.pathname.startsWith('/ws') || url.pathname.startsWith('/log') || url.pathname === '/healthz') return;

  // App-shell navigations: prefer the network so a deploy is seen immediately,
  // but fall back to the cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put('/index.html', res.clone())).catch(() => {});
          return res;
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/'))),
    );
    return;
  }

  // Static assets: serve from cache immediately, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || network;
    }),
  );
});
