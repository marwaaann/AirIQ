/* AirIQ service worker. Registered only in production builds (components/pwa/ServiceWorkerRegistrar.tsx).
 *
 * - App shell and static assets: precached on install, then cache-first (hashed, immutable files).
 * - Page navigations: network-first with a timeout, then the cached page, then /offline.
 * - GET /api/* (air, history, forecast, weather, grid, stations, geocode): network-first with a
 *   short timeout; on failure the last successful response is served WITH
 *   X-AirIQ-Stale: 1 and X-AirIQ-Cached-At so the UI labels it as not live.
 * - /api/assistant (POST, streaming) and anything cross-origin are never touched.
 * - Caches are versioned by the build (/sw.js?v=<build>); old versions are deleted on activate.
 * - notificationclick focuses an AirIQ window and navigates it to the alert's city.
 *
 * The decisions live in sw-core.js (pure, unit-tested).
 */

/* eslint-disable no-restricted-globals */
self.module = { exports: {} };
const VERSION_PARAM = new URL(self.location.href).searchParams.get("v") || "dev";
importScripts(`/sw-core.js?v=${encodeURIComponent(VERSION_PARAM)}`);
const core = self.module.exports;

const VERSION = core.versionFromScriptUrl(self.location.href);
const NAMES = core.cacheNames(VERSION);
const ORIGIN = self.location.origin;

/* ------------------------------------------------------------------ helpers */

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve({ res: null, copy: null, outcome: "timeout" }), ms))]);
}

/**
 * fetch → { res, copy, outcome }. `copy` is cloned immediately so the page can consume `res`.
 * `bypassHttpCache`: API data must come from the server, not the browser's HTTP
 * cache. Otherwise a response kept there (the API sends stale-while-revalidate
 * for CDNs) would look like a live answer while offline and never get the stale label.
 */
function fetchOutcome(request, cacheable, bypassHttpCache = false) {
  return fetch(request, bypassHttpCache ? { cache: "no-store" } : undefined).then(
    (res) => {
      const outcome = core.outcomeOfStatus(res.status);
      return { res, copy: outcome === "ok" && cacheable(res) ? res.clone() : null, outcome };
    },
    () => ({ res: null, copy: null, outcome: "failed" }),
  );
}

async function putStamped(cacheName, key, copy) {
  const body = await copy.blob();
  const headers = core.headersForCache([...copy.headers], new Date().toISOString());
  const cache = await caches.open(cacheName);
  await cache.put(key, new Response(body, { status: copy.status, statusText: copy.statusText, headers }));
  return cache;
}

async function staleResponse(cached) {
  const body = await cached.blob();
  return new Response(body, { status: cached.status, statusText: cached.statusText, headers: core.headersForStale([...cached.headers]) });
}

async function cacheAssets(urls) {
  const cache = await caches.open(NAMES.static);
  await Promise.all(
    urls.map(async (u) => {
      try {
        const abs = new URL(u, ORIGIN);
        if (abs.origin !== ORIGIN || !abs.pathname.startsWith("/_next/static/")) return;
        if (await cache.match(abs.href)) return;
        const res = await fetch(abs.href);
        if (res.ok) await cache.put(abs.href, res);
      } catch {
        // A missing asset only means that page is less complete offline.
      }
    }),
  );
}

/** Store a page's HTML under its exact URL and its path, plus the static assets it references. */
async function cachePage(url, response) {
  const html = await response.clone().text();
  const pages = await caches.open(NAMES.pages);
  for (const key of core.pageCacheKeys(url)) await pages.put(key, response.clone());
  const keys = await pages.keys();
  const n = core.pruneCount(keys.length, core.MAX_PAGE_ENTRIES);
  await Promise.all(
    keys
      .slice(0, n)
      .filter((k) => !core.PRECACHE_PAGES.some((p) => core.pageCacheKey(k.url) === new URL(p, ORIGIN).href))
      .map((k) => pages.delete(k)),
  );
  await cacheAssets(core.extractAssetUrls(html));
}

async function matchPage(pages, url) {
  for (const key of core.pageCacheKeys(url)) {
    const hit = await pages.match(key);
    if (hit) return hit;
  }
  return undefined;
}

async function fetchAndCachePage(url) {
  try {
    const res = await fetch(url, { credentials: "same-origin", cache: "no-store" });
    if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) await cachePage(url, res);
  } catch {
    // Offline: nothing to store.
  }
}

/* ------------------------------------------------------------------ lifecycle */

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(core.PRECACHE_PAGES.map((p) => fetchAndCachePage(new URL(p, ORIGIN).href)));
      const statics = await caches.open(NAMES.static);
      await Promise.all(
        core.PRECACHE_ASSETS.map(async (p) => {
          try {
            const res = await fetch(p, { cache: "no-store" });
            if (res.ok) await statics.put(new URL(p, ORIGIN).href, res);
          } catch {
            // optional asset
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const old = core.cachesToDelete(await caches.keys(), VERSION);
      await Promise.all(old.map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object" || event.origin !== ORIGIN) return;
  if (msg.type === "CACHE_URLS" && Array.isArray(msg.urls)) event.waitUntil(cacheAssets(msg.urls.filter((u) => typeof u === "string").slice(0, 300)));
  if (msg.type === "CACHE_PAGE" && typeof msg.url === "string") {
    const u = new URL(msg.url, ORIGIN);
    if (u.origin === ORIGIN) event.waitUntil(fetchAndCachePage(u.href));
  }
});

/* ------------------------------------------------------------------ fetch */

/** Exact cached copy, or for map data the newest copy of the same route (see apiFallbackPolicy). */
async function findCachedApi(url) {
  const cache = await caches.open(NAMES.api);
  const exact = await cache.match(url, { ignoreVary: true });
  if (exact || core.apiFallbackPolicy(url) !== "latest-same-path") return exact;
  const path = new URL(url).pathname;
  const keys = (await cache.keys()).filter((k) => new URL(k.url).pathname === path);
  // keys() is in insertion order; put() of an existing URL re-inserts it, so the last is the newest.
  return keys.length ? cache.match(keys[keys.length - 1], { ignoreVary: true }) : undefined;
}

async function handleApi(event) {
  const request = event.request;
  const network = fetchOutcome(request, () => true, true);
  event.waitUntil(
    network.then(async ({ copy }) => {
      if (!copy) return;
      const cache = await putStamped(NAMES.api, request, copy);
      const keys = await cache.keys();
      const n = core.pruneCount(keys.length, core.MAX_API_ENTRIES);
      await Promise.all(keys.slice(0, n).map((k) => cache.delete(k)));
    }),
  );
  let result = await withTimeout(network, core.API_TIMEOUT_MS);
  const cached = await findCachedApi(request.url);
  let decision = core.apiDecision(result.outcome, Boolean(cached));
  if (decision === "wait") {
    result = await network;
    decision = core.apiDecision(result.outcome, Boolean(cached));
  }
  if (decision === "cache" && cached) return staleResponse(cached);
  return result.res || Response.error();
}

async function handleNavigation(event) {
  const request = event.request;
  const network = fetchOutcome(request, (res) => res.type === "basic" && (res.headers.get("content-type") || "").includes("text/html"));
  event.waitUntil(network.then(({ copy }) => (copy ? cachePage(request.url, copy) : undefined)));
  let result = await withTimeout(network, core.NAV_TIMEOUT_MS);
  if (result.outcome === "ok" || result.outcome === "client-error") return result.res;
  const pages = await caches.open(NAMES.pages);
  const cached = await matchPage(pages, request.url);
  if (cached) return cached;
  if (result.outcome === "timeout") {
    result = await network;
    if (result.res) return result.res;
  } else if (result.res) {
    return result.res;
  }
  const offline = await pages.match(core.pageCacheKey(new URL("/offline", ORIGIN).href));
  return offline || Response.error();
}

async function handleStatic(request) {
  const cache = await caches.open(NAMES.static);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  try {
    const res = await fetch(request);
    if (res.ok) await cache.put(request.url, res.clone());
    return res;
  } catch {
    return Response.error();
  }
}

async function handleAsset(event) {
  const cache = await caches.open(NAMES.static);
  const hit = await cache.match(event.request.url);
  const refresh = fetch(event.request).then(
    async (res) => {
      if (res.ok) await cache.put(event.request.url, res.clone());
      return res;
    },
    () => null,
  );
  event.waitUntil(refresh);
  return hit || (await refresh) || Response.error();
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const kind = core.classifyRequest(
    { method: req.method, url: req.url, mode: req.mode, rsc: req.headers.has("RSC") || req.headers.has("Next-Router-Prefetch") },
    ORIGIN,
  );
  if (kind === "api") event.respondWith(handleApi(event));
  else if (kind === "navigate") event.respondWith(handleNavigation(event));
  else if (kind === "static") event.respondWith(handleStatic(req));
  else if (kind === "asset") event.respondWith(handleAsset(event));
  // "network-only": not intercepted (assistant, POST, cross-origin, RSC payloads).
});

/* ------------------------------------------------------------------ notifications */

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = core.notificationTarget(event.notification.data, ORIGIN);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const ours = windows.filter((c) => {
        try {
          return new URL(c.url).origin === ORIGIN;
        } catch {
          return false;
        }
      });
      const win = ours.find((c) => c.focused) || ours[0];
      if (win) {
        await win.focus();
        if (win.url !== target) {
          try {
            await win.navigate(target);
          } catch {
            // navigate() only works on windows this worker controls; ask the page instead.
            win.postMessage({ type: "NAVIGATE", url: target });
          }
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
