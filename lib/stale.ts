/**
 * Offline / stale-data metadata. The service worker (public/sw.js) stamps
 * responses it serves from its cache with X-AirIQ-Stale: 1 and
 * X-AirIQ-Cached-At: <ISO>. The client fetcher copies these into `_meta` on
 * every API body so each panel can label old data.
 *
 * Pure module (no imports) so it runs under `node --test`.
 */

export const STALE_HEADER = "x-airiq-stale";
export const CACHED_AT_HEADER = "x-airiq-cached-at";

export interface StaleMeta {
  /** True only when the body came from the service worker's offline cache. */
  isStale: boolean;
  /** When that cached copy was fetched (UTC ISO), or null if unknown. */
  cachedAt: string | null;
}

export const FRESH: StaleMeta = { isStale: false, cachedAt: null };

/** Field added to every API body by the client fetcher. */
export interface WithMeta {
  _meta: StaleMeta;
}

interface HeaderReader {
  get(name: string): string | null;
}

/** Read the service worker's stamp. Anything other than exactly "1" is fresh; an unparsable time becomes null. */
export function parseStaleHeaders(headers: HeaderReader): StaleMeta {
  const isStale = headers.get(STALE_HEADER)?.trim() === "1";
  if (!isStale) return FRESH;
  const raw = headers.get(CACHED_AT_HEADER)?.trim() ?? "";
  const ms = Date.parse(raw);
  return { isStale: true, cachedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null };
}

/** `_meta` of an API body (FRESH when absent, e.g. still loading). */
export function staleMetaOf(data: unknown): StaleMeta {
  if (typeof data !== "object" || data === null || !("_meta" in data)) return FRESH;
  const m = (data as { _meta: unknown })._meta;
  if (typeof m !== "object" || m === null) return FRESH;
  const { isStale, cachedAt } = m as Partial<StaleMeta>;
  return isStale === true ? { isStale: true, cachedAt: typeof cachedAt === "string" ? cachedAt : null } : FRESH;
}

/** Combine several sources shown in one panel: stale if any is, with the OLDEST cached time. */
export function combineStale(...metas: StaleMeta[]): StaleMeta {
  const stale = metas.filter((m) => m.isStale);
  if (!stale.length) return FRESH;
  const times = stale.map((m) => (m.cachedAt ? Date.parse(m.cachedAt) : Number.NaN));
  if (times.some((t) => !Number.isFinite(t))) return { isStale: true, cachedAt: null };
  return { isStale: true, cachedAt: new Date(Math.min(...times)).toISOString() };
}

function localDate(ms: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);
}

/**
 * "Offline: showing data from 14:20, not live" in the given IANA time zone
 * (the city's). Adds the date when the copy is from another local day.
 * `offline` false means the network is up but the request failed or timed out.
 */
export function staleBannerText(cachedAt: string | null, timeZone: string, nowMs: number, offline = true): string {
  const prefix = offline ? "Offline" : "Live data unavailable";
  if (!cachedAt || !Number.isFinite(Date.parse(cachedAt))) return `${prefix}: showing saved data, not live`;
  const ms = Date.parse(cachedAt);
  let tz = timeZone;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz }).format(ms);
  } catch {
    tz = "UTC";
  }
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
  const sameDay = localDate(ms, tz) === localDate(nowMs, tz);
  const when = sameDay ? time : `${new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(ms)}, ${time}`;
  return `${prefix}: showing data from ${when}${tz === "UTC" && timeZone !== "UTC" ? " UTC" : ""}, not live`;
}
