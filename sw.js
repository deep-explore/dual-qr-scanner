// Offline shell. Everything the scanner needs — including the 950 KB decoder
// — is precached on install, so after the first load the app never needs the
// network. Bump CACHE when shipping changes.

const CACHE = "dual-qr-v1";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./pipeline.js",
  "./dewarp.js",
  "./decode-worker.js",
  "./selftest.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./vendor/zxing/reader/index.js",
  "./vendor/zxing/share.js",
  "./vendor/zxing/zxing_reader.wasm",
  "./test/fixtures.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(async () => {
          // Offline and unseen: navigations still get the app shell.
          if (req.mode === "navigate") {
            return (await caches.match("./index.html")) ?? Response.error();
          }
          return Response.error();
        });
    }),
  );
});
