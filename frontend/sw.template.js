/* Resonance service worker.
 * Built by the `serviceWorker` plugin in vite.config.ts, which replaces the
 * __BUILD_ID__ and __PRECACHE__ placeholders with the build's asset list.
 *
 * Strategy
 *   App shell (index.html, JS/CSS, icons)  precached → app opens offline
 *   /assets/* (hashed, immutable)           cache-first
 *   Page navigations                        network-first (3s) → cached shell
 *   /uploads/images/* (cover art)           stale-while-revalidate, capped
 *   Library/playlist/favorites/history API  network-first → last cached copy
 *   Audio streams, auth, uploads, writes    network only (never cached)
 */
const BUILD_ID = '__BUILD_ID__';
const PRECACHE = __PRECACHE__;

const SHELL_CACHE = `resonance-shell-${BUILD_ID}`;
const IMAGE_CACHE = 'resonance-images-v1';
const API_CACHE = 'resonance-api-v1';
const MAX_IMAGES = 600;
const NAV_TIMEOUT_MS = 3000;

// Read-only endpoints whose last response is useful offline
const CACHEABLE_API = [
  /^\/api\/playlists(\/[^/]+)?$/,
  /^\/api\/favorites(\/ids)?$/,
  /^\/api\/history$/,
  /^\/api\/tracks$/,
  /^\/api\/tracks\/albums$/,
  /^\/api\/users\/[^/]+\/preferences$/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(PRECACHE)));
  // No skipWaiting here: an update waits until the user clicks "Reload" (see utils/pwa.ts)
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          // Old shells, plus the Google Fonts cache from before Inter was self-hosted
          .filter((k) => (k.startsWith('resonance-shell-') && k !== SHELL_CACHE) || k === 'resonance-fonts-v1')
          .map((k) => caches.delete(k))
      );
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  // Sent on logout so the next account never sees the previous one's cached data
  if (event.data?.type === 'CLEAR_API_CACHE') event.waitUntil(caches.delete(API_CACHE));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigationHandler(event));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }
  if (url.pathname.startsWith('/uploads/images/')) {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE, MAX_IMAGES));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    if (CACHEABLE_API.some((re) => re.test(url.pathname))) {
      event.respondWith(networkFirst(request, API_CACHE));
    }
    // Everything else under /api (streams, auth, search, health) goes straight to the network
    return;
  }
  if (PRECACHE.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
  }
});

async function navigationHandler(event) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    const response = await withTimeout(fetch(event.request), NAV_TIMEOUT_MS);
    return response;
  } catch {
    // Offline or slow network: serve the cached app shell; the client router handles the path
    return (await cache.match('/index.html')) ?? Response.error();
  }
}

async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then(async (response) => {
      // Opaque cross-origin responses (fonts) have status 0 but are still cacheable
      if (response.ok || response.type === 'opaque') {
        await cache.put(request, response.clone());
        if (maxEntries) trimCache(cache, maxEntries);
      }
      return response;
    })
    .catch(() => cached);
  return cached ?? network;
}

async function trimCache(cache, maxEntries) {
  const keys = await cache.keys();
  // Cache keys are in insertion order: drop the oldest
  for (let i = 0; i < keys.length - maxEntries; i++) await cache.delete(keys[i]);
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); }
    );
  });
}
