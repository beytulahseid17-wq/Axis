// Axis PWA Service Worker — v3
// Strategy: Network-first for app shell (fast updates), Cache-first for offline projects

var CACHE_VERSION = "axis-v3";
var APP_SHELL_CACHE = CACHE_VERSION + "-shell";
var PROJECT_CACHE_PREFIX = CACHE_VERSION + "-project-";

var SHELL_ASSETS = [
  "./", "./index.html", "./style.css", "./app.js",
  "./config.js", "./manifest.json", "./icon-192.png", "./icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js",
  "https://cdn.jsdelivr.net/npm/idb@8/build/umd.js",
  "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;600&display=swap"
];

// ── Install: cache shell assets ────────────────────────────────────────────
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(function (cache) {
      return cache.addAll(SHELL_ASSETS.filter(function (url) {
        // Skip cross-origin font files on install (they load fine at runtime)
        return !url.includes("fonts.gstatic");
      }));
    })
  );
  self.skipWaiting();
});

// ── Activate: delete old caches ─────────────────────────────────────────────
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.startsWith("axis-") && !key.startsWith(CACHE_VERSION);
      }).map(function (key) { return caches.delete(key); }));
    })
  );
  self.clients.claim();
});

// ── Fetch strategy ──────────────────────────────────────────────────────────
self.addEventListener("fetch", function (event) {
  var url = new URL(event.request.url);

  // Never intercept Supabase API calls — always hit the network
  if (url.hostname.includes("supabase.co")) return;

  // Cross-origin fonts/icons — cache-first (they never change)
  if (url.hostname.includes("fonts.gstatic") || url.hostname.includes("unsplash")) {
    event.respondWith(cacheFirst(event.request, APP_SHELL_CACHE));
    return;
  }

  // App shell — network-first so updates always propagate
  event.respondWith(networkFirstWithShellFallback(event.request));
});

function networkFirstWithShellFallback(request) {
  return fetch(request).then(function (response) {
    if (response && response.ok) {
      var clone = response.clone();
      caches.open(APP_SHELL_CACHE).then(function (cache) { cache.put(request, clone); });
    }
    return response;
  }).catch(function () {
    return caches.match(request).then(function (cached) {
      return cached || caches.match("./index.html");
    });
  });
}

function cacheFirst(request, cacheName) {
  return caches.match(request).then(function (cached) {
    if (cached) return cached;
    return fetch(request).then(function (response) {
      if (response && response.ok) {
        var clone = response.clone();
        caches.open(cacheName).then(function (c) { c.put(request, clone); });
      }
      return response;
    });
  });
}

// ── Sync message from app ───────────────────────────────────────────────────
self.addEventListener("message", function (event) {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();

  if (event.data && event.data.type === "CACHE_PROJECT") {
    // The app posts this to tell the SW to cache specific URLs for a project
    var projectId = event.data.projectId;
    var urls = event.data.urls || [];
    var cacheName = PROJECT_CACHE_PREFIX + projectId;
    caches.open(cacheName).then(function (cache) {
      return cache.addAll(urls);
    }).then(function () {
      if (event.ports[0]) event.ports[0].postMessage({ success: true });
    }).catch(function (err) {
      if (event.ports[0]) event.ports[0].postMessage({ success: false, error: err.message });
    });
  }

  if (event.data && event.data.type === "UNCACHE_PROJECT") {
    var cacheName = PROJECT_CACHE_PREFIX + event.data.projectId;
    caches.delete(cacheName).then(function () {
      if (event.ports[0]) event.ports[0].postMessage({ success: true });
    });
  }
});

// ── Background sync (if supported) ─────────────────────────────────────────
self.addEventListener("sync", function (event) {
  if (event.tag === "axis-sync") {
    event.waitUntil(
      self.clients.matchAll().then(function (clients) {
        clients.forEach(function (client) {
          client.postMessage({ type: "TRIGGER_SYNC" });
        });
      })
    );
  }
});
