/**
 * Pure decision logic for the AirIQ service worker (public/sw.js).
 *
 * Plain CommonJS so that:
 *  - sw.js loads it with importScripts() after defining `self.module`, and
 *  - the unit tests import it directly (lib/__tests__/sw-core.test.ts).
 * No browser or Node APIs are used here, only plain values.
 */

const CACHE_PREFIX = "airiq-";
const STALE_HEADER = "x-airiq-stale";
const CACHED_AT_HEADER = "x-airiq-cached-at";
/** Network-first timeout for /api/* before falling back to a cached copy. */
const API_TIMEOUT_MS = 5000;
/** Network-first timeout for page navigations. */
const NAV_TIMEOUT_MS = 6000;
/** Cached API responses kept (oldest dropped first). Map viewports make many unique URLs. */
const MAX_API_ENTRIES = 200;
/** API routes the worker may cache (GET only). The assistant is never cached. */
const CACHEABLE_API = ["/api/air", "/api/history", "/api/forecast", "/api/weather", "/api/grid", "/api/stations", "/api/geocode"];
/** Precached on install so navigation and the offline page work without a prior visit. */
const PRECACHE_PAGES = ["/", "/offline"];
const PRECACHE_ASSETS = ["/manifest.webmanifest", "/pwa-icon/192", "/pwa-icon/512", "/pwa-icon/maskable", "/favicon.ico"];

/**
 * Cache version from the worker's own URL (/sw.js?v=<build>). A new build
 * registers a new URL, so the browser installs a new worker.
 * @param {string} scriptUrl
 * @returns {string}
 */
function versionFromScriptUrl(scriptUrl) {
  try {
    const v = new URL(scriptUrl).searchParams.get("v");
    return v && /^[A-Za-z0-9._-]{1,64}$/.test(v) ? v : "dev";
  } catch {
    return "dev";
  }
}

/**
 * @param {string} version
 * @returns {{ static: string, pages: string, api: string }}
 */
function cacheNames(version) {
  return { static: `${CACHE_PREFIX}static-${version}`, pages: `${CACHE_PREFIX}pages-${version}`, api: `${CACHE_PREFIX}api-${version}` };
}

/**
 * AirIQ caches that do not belong to `version` (deleted on activate, so a
 * deploy never leaves old assets or old-shaped API bodies behind). Caches
 * not starting with "airiq-" are left alone.
 * @param {readonly string[]} existing
 * @param {string} version
 * @returns {string[]}
 */
function cachesToDelete(existing, version) {
  const keep = Object.values(cacheNames(version));
  return existing.filter((n) => n.startsWith(CACHE_PREFIX) && !keep.includes(n));
}

/**
 * How the worker handles a request.
 * @param {{ method: string, url: string, mode?: string, rsc?: boolean }} req  `rsc`: has an RSC / router-prefetch header
 * @param {string} origin  the worker's origin
 * @returns {"api" | "static" | "navigate" | "asset" | "network-only"}
 */
function classifyRequest(req, origin) {
  let u;
  try {
    u = new URL(req.url);
  } catch {
    return "network-only";
  }
  if (req.method !== "GET" || u.origin !== origin) return "network-only";
  if (u.pathname === "/api/assistant" || u.pathname.startsWith("/api/assistant/")) return "network-only";
  if (u.pathname.startsWith("/api/")) return CACHEABLE_API.includes(u.pathname) ? "api" : "network-only";
  // React Server Component payloads: on failure Next falls back to a full navigation, which the worker handles.
  if (req.rsc || u.searchParams.has("_rsc")) return "network-only";
  if (u.pathname.startsWith("/_next/static/")) return "static";
  if (req.mode === "navigate") return "navigate";
  if (PRECACHE_ASSETS.includes(u.pathname)) return "asset";
  return "network-only";
}

/**
 * Network-first decision for /api/* once the network outcome is known.
 *  - "ok" (2xx) or "client-error" (4xx: a real answer, e.g. bad input) → use the network response
 *  - "failed" (offline / DNS / reset), "server-error" (5xx) or "timeout" → cached copy if there is one
 *  - "timeout" without a cached copy → keep waiting for the network
 *  - otherwise → the network result (an error the UI shows as an error)
 * @param {"ok" | "client-error" | "server-error" | "failed" | "timeout"} outcome
 * @param {boolean} hasCached
 * @returns {"network" | "cache" | "wait"}
 */
function apiDecision(outcome, hasCached) {
  if (outcome === "ok" || outcome === "client-error") return "network";
  if (hasCached) return "cache";
  return outcome === "timeout" ? "wait" : "network";
}

/** @param {number} status */
function outcomeOfStatus(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 400 && status < 500) return "client-error";
  return "server-error";
}

/**
 * Headers for the copy stored in the cache: the original headers plus the
 * fetch time. Any stale flag is removed (the stored copy itself is not "stale").
 * @param {ReadonlyArray<[string, string]>} entries
 * @param {string} nowIso
 * @returns {Array<[string, string]>}
 */
function headersForCache(entries, nowIso) {
  const out = entries.filter(([k]) => {
    const n = k.toLowerCase();
    return n !== STALE_HEADER && n !== CACHED_AT_HEADER;
  });
  out.push([CACHED_AT_HEADER, nowIso]);
  return out;
}

/**
 * Headers for a cached copy served as a fallback: X-AirIQ-Stale: 1 and the
 * original fetch time. Without a recorded time, X-AirIQ-Cached-At is omitted
 * (the client then says "saved data" without a time).
 * @param {ReadonlyArray<[string, string]>} entries
 * @returns {Array<[string, string]>}
 */
function headersForStale(entries) {
  const out = entries.filter(([k]) => k.toLowerCase() !== STALE_HEADER);
  out.push([STALE_HEADER, "1"]);
  return out;
}

/**
 * Same-origin static assets referenced by a page's HTML, so a cached page also has its scripts, styles and fonts.
 * @param {string} html
 * @returns {string[]}
 */
function extractAssetUrls(html) {
  const found = new Set();
  const re = /\/_next\/static\/[A-Za-z0-9_\-./~%]+?\.(?:js|css|woff2?|ttf|png|svg|ico)/g;
  let m;
  while ((m = re.exec(html)) !== null) found.add(m[0]);
  return [...found];
}

/**
 * Which cached copy may stand in for an API request with no exact match.
 * Map data (grid, stations) may use the most recent copy for another viewport:
 * every cell and station carries its own coordinates, so it is still drawn in
 * the right place (and labelled stale). Everything else needs the exact URL,
 * so one city's data is never shown for another.
 * @param {string} url
 * @returns {"exact" | "latest-same-path"}
 */
function apiFallbackPolicy(url) {
  try {
    const p = new URL(url).pathname;
    return p === "/api/grid" || p === "/api/stations" ? "latest-same-path" : "exact";
  } catch {
    return "exact";
  }
}

/**
 * How many of the oldest entries to delete to stay within `max`.
 * @param {number} count
 * @param {number} max
 */
function pruneCount(count, max) {
  return Math.max(0, count - max);
}

/**
 * Path-only cache key for a navigation (the fallback for query variants never visited).
 * @param {string} url
 */
function pageCacheKey(url) {
  const u = new URL(url);
  return `${u.origin}${u.pathname}`;
}

/**
 * Keys a page is stored under and looked up by, best first: the exact URL
 * (its server render matches its query, e.g. ?tab=forecast, so it hydrates
 * cleanly), then the path alone (another query of the same page; React then
 * re-renders that part on the client).
 * @param {string} url
 * @returns {string[]}
 */
function pageCacheKeys(url) {
  const u = new URL(url);
  u.hash = "";
  const exact = u.href;
  const path = pageCacheKey(url);
  return exact === path ? [path] : [exact, path];
}

/** Cached pages kept (oldest dropped first). */
const MAX_PAGE_ENTRIES = 60;

/**
 * Where a notification click should go: a same-origin path from the
 * notification's data, or "/" for anything else (never an external URL).
 * @param {unknown} data
 * @param {string} origin
 * @returns {string}
 */
function notificationTarget(data, origin) {
  const raw = data && typeof data === "object" && "url" in data ? /** @type {{url: unknown}} */ (data).url : null;
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return `${origin}/`;
  try {
    const u = new URL(raw, origin);
    return u.origin === origin ? u.href : `${origin}/`;
  } catch {
    return `${origin}/`;
  }
}

module.exports = {
  CACHE_PREFIX,
  STALE_HEADER,
  CACHED_AT_HEADER,
  API_TIMEOUT_MS,
  NAV_TIMEOUT_MS,
  MAX_API_ENTRIES,
  CACHEABLE_API,
  PRECACHE_PAGES,
  PRECACHE_ASSETS,
  versionFromScriptUrl,
  cacheNames,
  cachesToDelete,
  classifyRequest,
  apiDecision,
  outcomeOfStatus,
  headersForCache,
  headersForStale,
  extractAssetUrls,
  pruneCount,
  apiFallbackPolicy,
  pageCacheKey,
  pageCacheKeys,
  MAX_PAGE_ENTRIES,
  notificationTarget,
};
