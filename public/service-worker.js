// service-worker.js — Decatur Fire PWA

const CACHE_VERSION = "v1.3.0"; // <-- bump this when you deploy changes
const CACHE_NAME = `dfd-checks-${CACHE_VERSION}`;
const HTML_CACHE = `dfd-html-${CACHE_VERSION}`;

const ASSETS = [
  "/",
  "/index.html",
  "/styles.min.css",
  "/app.min.js",
  "/search.html",
  "/search.min.js",
  "/scanner.min.js",
  "/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  // Activate updated SW immediately
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener("activate", (event) => {
  // Delete old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((k) =>
          k !== CACHE_NAME && k !== HTML_CACHE ? caches.delete(k) : null
        )
      )
    )
  );
  // Take control immediately
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls
  if (url.pathname.startsWith("/api")) return;

  // HTML: stale-while-revalidate for faster repeat loads
  const accept = event.request.headers.get("accept") || "";
  if (accept.includes("text/html")) {
    event.respondWith(
      caches.open(HTML_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        const network = fetch(event.request)
          .then((res) => {
            cache.put(event.request, res.clone());
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Cache-first for app assets (JS/CSS/manifest)
  if (ASSETS.includes(url.pathname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Default: network
});
