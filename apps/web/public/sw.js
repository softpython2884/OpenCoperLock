/*
 * OpenCoperLock service worker — deliberately minimal.
 *
 * It exists to make the app installable and to serve an offline fallback for page
 * navigations. It NEVER caches API responses or file contents: those are private and
 * potentially large, and stale copies would be both confusing and a data-leak risk. Only
 * same-origin GET navigations get a cached app-shell fallback when the network is down.
 */
const CACHE = 'ocl-shell-v1';
const SHELL = '/';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch the cross-origin API

  // App-shell strategy for page navigations only.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(CACHE).then((c) => c.put(SHELL, res.clone())).catch(() => {});
          return res;
        })
        .catch(() => caches.match(SHELL).then((r) => r || Response.error())),
    );
  }
});
