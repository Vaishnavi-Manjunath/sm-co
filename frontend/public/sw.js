// Sri Murugan & Co — service worker (offline app shell).
// NOTE: CACHE is stamped automatically at build time by scripts/stamp-sw.mjs
// (from the content-hashed asset filenames) — do NOT hand-edit the value below.
// 'smco-dev' is only used by the local dev server.
// Two surfaces now: '/' = public homepage, '/app/' = the staff app. The nav handler
// is path-aware so each keeps the right offline shell.
const CACHE = 'smco-dev';
const SHELL = ['/', '/index.html', '/app/', '/app/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (e) => {
  // addAll fails the whole install if any URL 404s — add resiliently instead.
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                          // never touch POST/PUT/etc.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;           // only same-origin
  if (url.pathname.startsWith('/api/')) return;              // never cache API / auth / live data

  // The right offline shell for this surface (staff app vs homepage).
  const shell = url.pathname.startsWith('/app') ? '/app/index.html' : '/index.html';

  // Page navigations: network-first (so new deploys load), fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(shell, copy));
        return res;
      }).catch(() => caches.match(shell))
    );
    return;
  }

  // Static assets (hashed JS/CSS/images): cache-first, then fetch + cache.
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
