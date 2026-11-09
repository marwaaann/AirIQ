/**
 * Server-side caching.
 *
 * Two layers:
 *  1. Next.js data cache via `fetch(url, { next: { revalidate } })` (persists
 *     across requests in production).
 *  2. A small in-process TTL cache with in-flight de-duplication so that
 *     concurrent identical requests (e.g. the map asking for the same grid
 *     twice) hit the upstream API once, also in `next dev`.
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
const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

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
