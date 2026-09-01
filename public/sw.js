/*
 * Service worker for the installed (home-screen) Course Vault.
 *
 * The deliberate non-goal here is offline *content*. Every file in the vault
 * lives in the signed-in user's GitHub repo and is fetched through `/api/*`
 * with their session cookie, so caching those responses would mean writing
 * one account's private files into a cache that survives signing out. This
 * worker therefore caches only what is already public and immutable — the
 * build's static chunks, the Monaco and pdf.js runtimes, the icons — which is
 * what makes the app open instantly instead of re-downloading several MB of
 * editor on every cold start.
 *
 * Bump CACHE_VERSION whenever the rules below change; the activate handler
 * drops every cache that does not match.
 */

const CACHE_VERSION = "v1";
const STATIC_CACHE = `cv-static-${CACHE_VERSION}`;
const OFFLINE_URL = "/offline.html";

// Content-hashed by the build: a given URL can never mean a different byte
// sequence, so it is safe to serve from cache without revalidating.
const IMMUTABLE_PREFIXES = ["/_next/static/", "/icons/"];

// Copied out of node_modules by scripts/sync-monaco.mjs and sync-pdfjs.mjs.
// The filenames are NOT hashed, so a dependency bump would otherwise be
// invisible to an installed client — these use stale-while-revalidate to stay
// fast while still healing themselves on the next launch.
const REVALIDATE_PREFIXES = ["/monaco/", "/pdfjs/"];

const startsWithAny = (path, prefixes) =>
  prefixes.some((prefix) => path.startsWith(prefix));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("cv-") && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const hit = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    // Offline with nothing cached: let the caller's `|| network` surface the
    // real failure rather than swallowing it here.
    .catch(() => undefined);

  if (hit) return hit;
  const response = await network;
  if (response) return response;
  return Response.error();
}

async function navigate(request) {
  try {
    // Authenticated HTML is never written to the cache — see the header note.
    return await fetch(request);
  } catch {
    const cache = await caches.open(STATIC_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    return (
      offline ??
      new Response("You are offline.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      })
    );
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Anything that changes server state, and anything cross-origin, is passed
  // straight through untouched.
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Sessions, OAuth callbacks, the GitHub-backed file APIs, the code runner,
  // the chat stream. None of it may be cached or replayed.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(request));
    return;
  }

  if (startsWithAny(url.pathname, IMMUTABLE_PREFIXES)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (startsWithAny(url.pathname, REVALIDATE_PREFIXES)) {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// Signing out has to leave nothing behind, and a deploy that changes the
// caching rules needs a way to take effect without waiting for eviction.
self.addEventListener("message", (event) => {
  if (event.data === "clear-cache") {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))));
  }
});
