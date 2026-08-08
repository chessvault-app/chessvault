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

self.addEventListener('install', () => self.skipWaiting());

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
