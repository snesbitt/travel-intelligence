/* Travel Intelligence service worker — v1 (2026-07-19)
 * Network-first with cache fallback for same-origin GETs, so the
 * installed PWA opens offline (last-seen pages + engine) instead of a
 * browser error page. /api/ requests are NEVER cached — live fares and
 * the watcher must stay live or fail honestly. Bump CACHE to invalidate. */
const CACHE = "ti-v2026-07-19";
const ASSETS = ["/", "/index.html", "/style.css", "/app.js", "/manifest.json", "/about.html", "/guide.html", "/roadmap.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((hit) => hit || caches.match("/index.html")))
  );
});
