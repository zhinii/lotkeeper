const CACHE = "material-pin-shell-v6";
const base = new URL("./", self.location.href);
const shell = [
  base.href,
  new URL("index.html", base).href,
  new URL("manifest.webmanifest", base).href,
  new URL("lotkeeper-icon.svg", base).href,
  new URL("icons/icon-192.png", base).href,
  new URL("icons/icon-512.png", base).href,
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(
        shell.map((url) => cache.add(url).catch(() => undefined)),
      );
      // Vite gives application assets hashed filenames. Read the built HTML so
      // the first install also stores those exact assets for an offline launch.
      try {
        const indexUrl = new URL("index.html", base);
        const indexResponse = await fetch(indexUrl);
        const html = await indexResponse.clone().text();
        await cache.put(indexUrl, indexResponse);
        const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
          .map((match) => new URL(match[1], indexUrl).href)
          .filter((url) => new URL(url).origin === self.location.origin);
        await Promise.all(
          assets.map((url) => cache.add(url).catch(() => undefined)),
        );
      } catch {
        // A later online visit will populate any asset that was unavailable.
      }
    }),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((network) => {
          const copy = network.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return network;
        })
        .catch(async () => (await caches.match(request)) || caches.match(new URL("index.html", base))),
    );
    return;
  }

  if (url.origin === self.location.origin || url.hostname === "unpkg.com") {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((response) => {
            if (response.ok || response.type === "opaque") {
              const copy = response.clone();
              caches.open(CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
          .catch(() => cached);
        return cached || network;
      }),
    );
  }
});
