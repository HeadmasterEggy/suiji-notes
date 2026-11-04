// App shell cache so 随记 opens offline. Supabase API calls always go to the network.
const CACHE = "suiji-v20";
const SHELL = ["./", "index.html", "style.css", "app.js", "graph.js", "mdmeta.js", "config.js", "manifest.webmanifest", "icon.svg", "icon-180.png", "icon-512.png",
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== "suiji-files-2").map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const own = url.origin === location.origin;
  if (own && url.pathname.includes("/__files/")) return;   // app-managed document cache, never fetched
  if (!own && url.hostname !== "cdn.jsdelivr.net") return;
  // Own files: network first (picks up new deploys), cache when offline. CDN: cache first.
  e.respondWith(own
    ? fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
        .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("index.html")))
    : caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })));
});
