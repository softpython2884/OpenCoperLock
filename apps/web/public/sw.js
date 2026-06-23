/*
 * OpenCoperLock service worker — installable PWA + offline app shell.
 *
 * It NEVER caches API responses or file contents (private + potentially large; stale copies
 * would leak or mislead). It caches only the app shell and Next.js static assets so the app can
 * BOOT offline after it has been opened online at least once. Offline file uploads are queued in
 * IndexedDB by the app itself and flushed on reconnect — not handled here.
 */
const SHELL = 'ocl-shell-v2';
const STATIC = 'ocl-static-v2';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.add('/')).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== STATIC).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch the cross-origin API

  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    url.pathname === '/icon.svg' ||
    url.pathname === '/manifest.webmanifest';

  // Content-hashed static assets: cache-first (safe forever), so the shell boots offline.
  if (isStatic) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req)
            .then((res) => {
              const copy = res.clone();
              caches.open(STATIC).then((c) => c.put(req, copy)).catch(() => {});
              return res;
            })
            .catch(() => cached),
      ),
    );
    return;
  }

  // Page navigations: network-first with a short timeout (so a slow mobile network falls back to
  // the cached page instead of hanging), then the cached page or the app shell.
  if (req.mode === 'navigate') {
    event.respondWith(
      Promise.race([
        fetch(req).then((res) => {
          const copy = res.clone();
          caches.open(SHELL).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
      ]).catch(() =>
        caches
          .match(req)
          .then((r) => r || caches.match('/'))
          .then((r) => r || fetch(req))
          .catch(() => Response.error()),
      ),
    );
  }
});
