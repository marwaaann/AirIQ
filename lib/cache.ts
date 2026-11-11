/**
 * Server-side caching.
 *
 * Upstream calls use `cache: "no-store"` (see lib/http.ts) plus this small
 * in-process TTL cache with in-flight de-duplication, so concurrent identical
 * requests hit the upstream API once and data is never older than the TTL.
 * Next's persistent fetch cache is deliberately NOT used: it serves a stale
 * copy first after an idle period, which showed hours-old readings.
 * Responses also carry Cache-Control headers for CDNs (cacheHeaders).
 */

/** Default upstream revalidation window (seconds). Spec: 10–15 minutes. */
export const REVALIDATE_SECONDS = 600;
/** Geocoding results change rarely. */
export const GEOCODE_REVALIDATE_SECONDS = 60 * 60 * 24;

interface Entry<T> {
  value: T;
  expires: number;
}

const MAX_ENTRIES = 500;
/**
 * Kept on globalThis so every server bundle shares one cache. Next bundles
 * pages and route handlers separately, so a module-level Map would exist once
 * per bundle: a city page's metadata and /api/air then fetched the same
 * Open-Meteo URL twice (found by counting upstream requests in Phase 8).
 */
const shared = globalThis as typeof globalThis & {
  __airiqCache?: { store: Map<string, Entry<unknown>>; inflight: Map<string, Promise<unknown>> };
};
shared.__airiqCache ??= { store: new Map(), inflight: new Map() };
const store = shared.__airiqCache.store;
const inflight = shared.__airiqCache.inflight;

function prune(): void {
  if (store.size <= MAX_ENTRIES) return;
  const now = Date.now();
  for (const [k, e] of store) {
    if (e.expires <= now) store.delete(k);
  }
  // Still too big: drop oldest insertions (Map preserves insertion order).
  while (store.size > MAX_ENTRIES) {
    const first = store.keys().next();
    if (first.done) break;
    store.delete(first.value);
  }
}

/** Return a cached value or compute it once (concurrent callers share the promise). */
export async function cached<T>(key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expires > Date.now()) return hit.value as T;

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = compute()
    .then((value) => {
      store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
      prune();
      return value;
    })
    .finally(() => {
      inflight.delete(key);
    });
  inflight.set(key, p);
  return p;
}

/** Cache-Control header for route responses. */
export function cacheHeaders(maxAgeSeconds: number = REVALIDATE_SECONDS): HeadersInit {
  return {
    "Cache-Control": `public, s-maxage=${maxAgeSeconds}, stale-while-revalidate=${Math.round(maxAgeSeconds / 2)}`,
  };
}
