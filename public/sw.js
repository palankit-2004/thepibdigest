// public/sw.js
const CACHE = "pibdigest-v3";

// Precache ONLY app shell (NOT data json)
const APP_SHELL = ["/", "/index.html", "/styles.css", "/app.js"];

// Install: cache app shell
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP_SHELL)));
  self.skipWaiting();
});

// Activate: cleanup old caches
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
    )
  );
  self.clients.claim();
});

// Helpers
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const fresh = await fetch(req, { cache: "no-store" });
    cache.put(req, fresh.clone());
    return fresh;
  } catch (err) {
    const cached = await cache.match(req);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(req) {
  const cached = await caches.match(req);
  return cached || fetch(req);
}

// Fetch strategy:
// - Data JSON => network-first (always try latest)
// - App shell/assets => cache-first (fast)
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Only handle same-origin
  if (url.origin !== location.origin) return;

  // Always fetch fresh data
  if (url.pathname.startsWith("/data/") && url.pathname.endsWith(".json")) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // Everything else: cache-first
  e.respondWith(cacheFirst(e.request));
});