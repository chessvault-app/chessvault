/**
 * Minimal service worker: network-first everywhere, cache as fallback.
 *
 * The app is a thin client over its vault server, so freshness beats
 * offline cleverness — every fetch goes to the network and the cache is
 * only consulted when that fails (flaky mobile connection, brief server
 * restart). /api and the engine binaries are never cached: stale vault
 * data or a half-cached multi-megabyte WASM would be worse than an
 * honest error.
 */
const CACHE = 'vault-shell-v1';

/**
 * Warm the cache with the build's own chunks. The routes are split into
 * chunks fetched on first visit, so offline the shell came up and any
 * page not yet opened in this build drew a blank box. The build writes
 * the list (web/vite.precache.ts) and this reads it; a missing list, or
 * one file failing, must not fail the install, which is why it is not
 * addAll. Not awaited by skipWaiting: the new worker takes over at once
 * and the warm-up finishes behind it.
 */
async function precache() {
  const res = await fetch('/precache.json', { cache: 'no-store' });
  if (!res.ok) return;
  const files = await res.json();
  const cache = await caches.open(CACHE);
  await Promise.all(
    files.map((f) =>
      cache.match(f).then((hit) => hit || cache.add(f).catch(() => undefined)),
    ),
  );
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache().catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/engine/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok && (response.type === 'basic' || response.type === 'default')) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        // SPA navigations can fall back to the cached shell.
        if (request.mode === 'navigate') {
          const shell = await caches.match('/');
          if (shell) return shell;
        }
        throw new Error('offline and uncached');
      }),
  );
});
