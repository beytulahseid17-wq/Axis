var CACHE_NAME = "axis-cache-v2";
var CACHE_FILES = [
  "./", "./index.html", "./style.css", "./app.js", "./config.js",
  "./manifest.json", "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(CACHE_FILES); })
  );
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.filter(function (n) { return n !== CACHE_NAME; }).map(function (n) { return caches.delete(n); }));
    })
  );
  self.clients.claim();
});

// Network-first for our own app files, so updates show up immediately without
// a hard refresh. Falls back to cache only when offline. Supabase calls always
// go straight to network — never cached.
self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  if (event.request.url.indexOf("supabase.co") !== -1) return;

  event.respondWith(
    fetch(event.request)
      .then(function (response) {
        if (response && response.ok) {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, clone); });
        }
        return response;
      })
      .catch(function () {
        return caches.match(event.request).then(function (cached) {
          return cached || caches.match("./index.html");
        });
      })
  );
});
