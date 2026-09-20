// Offline shell. Everything the scanner needs — including the 950 KB decoder
// — is precached on install, so after the first load the app never needs the
// network. Bump CACHE when shipping changes.

const CACHE = "dual-qr-v2";

const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./pipeline.js",
  "./dewarp.js",
  "./policy.js",
  "./orientation.js",
  "./decode-worker.js",
  "./selftest.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./vendor/zxing/reader/index.js",
  "./vendor/zxing/share.js",
  "./vendor/zxing/reader/zxing_reader.wasm",
  "./test/fixtures.js",
  "./test/warp.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

// cache.addAll is all-or-nothing and says nothing about which entry failed, so
// each asset is fetched on its own and the failures are named. Installing with
// holes is not an option: the app would look fine until the network went away,
// so a partial precache fails the install and the browser retries next visit.
async function precache() {
  const cache = await caches.open(CACHE);
  const failures = [];

  await Promise.all(
    ASSETS.map(async (asset) => {
      try {
        await cache.add(new Request(asset, { cache: "reload" }));
      } catch (err) {
        failures.push({ asset, message: String(err?.message ?? err) });
      }
    }),
  );

  if (failures.length) {
    await report(failures);
    throw new Error(`precache failed for ${failures.length} of ${ASSETS.length} assets`);
  }
  await self.skipWaiting();
}

async function report(failures) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  for (const client of clients) client.postMessage({ type: "precache-failed", failures });
}

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
            // Keep the worker alive until the write lands, and let a failed
            // write (quota, eviction) stay a cache miss rather than an
            // unhandled rejection.
            event.waitUntil(
              caches
                .open(CACHE)
                .then((cache) => cache.put(req, copy))
                .catch(() => {}),
            );
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
