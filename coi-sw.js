// OpenZH 11268104f: cross-origin isolation headers, and the site without internet.
const CACHE = "openzh-11268104f";
const FILES = ["/","/dist/bridge-worker.js","/dist/engine.js","/dist/main.js","/dist/torrent-client.js","/engine/GeneralsXZH.js","/engine/GeneralsXZH.wasm","/favicon.png","/icons/apple-touch-icon.png","/icons/icon-192.png","/icons/icon-512.png","/icons/icon-maskable-512.png","/manifest.webmanifest","/shell.css"];

function isolated(response) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// Navigations are stored without their query or fragment: one launcher page.
function keyOf(request) {
  const url = new URL(request.url);
  return request.mode === "navigate" ? url.origin + url.pathname : request;
}

async function store(key, response) {
  const cache = await caches.open(CACHE);
  const old = await cache.match(key);
  const etag = response.headers.get("etag");
  if (old && etag && old.headers.get("etag") === etag) return;
  await cache.put(key, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(FILES.map((path) =>
        fetch(path, { cache: "no-cache" }).then((response) => response.ok && cache.put(path, isolated(response))),
      )))
      // Storing is a bonus: the headers must work even if a file could not be fetched.
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("openzh-") && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  const sameOrigin = new URL(request.url).origin === self.location.origin;
  const cacheable = request.method === "GET" && sameOrigin && !request.headers.has("range");
  event.respondWith(
    fetch(request, { cache: "no-cache" }).then(
      (response) => {
        const answer = isolated(response);
        if (cacheable && response.ok) event.waitUntil(store(keyOf(request), answer.clone()).catch(() => undefined));
        return answer;
      },
      async (error) => {
        if (!cacheable) throw error;
        const cached =
          (await caches.match(keyOf(request), { ignoreSearch: true })) ||
          (request.mode === "navigate" ? await caches.match("/") : undefined);
        if (cached) return cached;
        throw error;
      },
    ),
  );
});
