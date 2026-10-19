// The service worker of the published site (scripts/publish-pages.mjs).
//
// GitHub Pages cannot set the cross-origin isolation headers threads and
// SharedArrayBuffer need, so the worker adds them to every response. It also
// keeps the site for use without internet (games on a network without
// internet, web/src/lan.ts): the files are stored when the worker installs,
// every online load refreshes them (network first: Pages caches for 10
// minutes, so requests revalidate and a new publish is never mixed with old
// files), and without a network the stored copy answers.

/**
 * @param {string} version  the build, so each publish gets its own cache
 * @param {string[]} files  site paths to store at install ("/" is the launcher)
 */
export function serviceWorker(version, files) {
  return `// OpenZH ${version}: cross-origin isolation headers, and the site without internet.
const CACHE = ${JSON.stringify(`openzh-${version}`)};
const FILES = ${JSON.stringify(files)};

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
`;
}

/** The package's files worth storing: what the launcher and the engine load. */
export function offlineFiles(paths) {
  const skip = new Set(["/CNAME", "/.nojekyll", "/_headers", "/coi-sw.js", "/og.png", "/index.html", "/dist/test-api.js"]);
  return ["/", ...paths.filter((path) => !skip.has(path) && !path.startsWith("/screenshots/")).sort()];
}
