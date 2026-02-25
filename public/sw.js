const CACHE = "pibtypes-v2";
const ASSETS = ["/", "/index.html", "/styles.css", "/app.js", "/data/index.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener("fetch", (e) => {
  e.respondWith(caches.match(e.request).then(c => c || fetch(e.request)));
});