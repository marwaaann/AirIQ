import "server-only";

import { pm25Index } from "@/lib/aqi";
import type { Bounds } from "@/lib/grid";
import { fetchJson, UpstreamError } from "@/lib/http";
import { parseHours, parseLocations, pickCurrentSensors } from "@/lib/openaq-parse";
import {
  OpenAqHoursResponseSchema,
  OpenAqLatestItemSchema,
  OpenAqLatestResponseSchema,
  OpenAqLocationSchema,
  OpenAqLocationsResponseSchema,
} from "@/lib/schemas";
import { SlidingLimiter } from "@/lib/sliding-limiter";
import {
  chooseStations,
  isCpcbProvider,
  naqiForStation,
  STATION_NAQI_MAX_STATIONS,
  STATION_NAQI_RADIUS_KM,
  summarizeStationNaqi,
  type StationNaqiStation,
} from "@/lib/station-naqi";
import type { Station } from "@/types/air";
import type { StationNaqiResponse } from "@/types/api";

const OPENAQ_BASE = "https://api.openaq.org/v3";
/** OpenAQ parameter id for PM2.5. */
const PM25_PARAMETER_ID = 2;
/** Cap per viewport to stay well inside OpenAQ's free rate limit (60 req/min). */
const MAX_LOCATIONS = 20;
const CONCURRENCY = 4;
/** Ignore readings older than this (map markers). */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
/** Upstream responses are cached for 10 minutes. */
const OPENAQ_TTL = 600;

/**
 * One limiter for every OpenAQ call in this server process: at most 50
 * requests a minute (the free tier allows 60), and a caller never waits more
 * than 20 s for a slot. Kept on globalThis so all route bundles share it.
 */
const g = globalThis as typeof globalThis & { __airiqOpenAqLimiter?: SlidingLimiter };
g.__airiqOpenAqLimiter ??= new SlidingLimiter({ limit: 50, windowMs: 60_000, maxWaitMs: 20_000 });
const limiter = g.__airiqOpenAqLimiter;

const isFresh = (iso: string | undefined | null, now: number) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t <= MAX_AGE_MS && t <= now + 60 * 60 * 1000;
};

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      // A cancelled request starts no further upstream calls.
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** fetchJson for OpenAQ: the API key header, the shared limiter, a 10-minute cache, and a back-off after HTTP 429. */
async function oaq<S extends Parameters<typeof fetchJson>[1]["schema"]>(url: string, schema: S, apiKey: string, cacheKey: string) {
  try {
    return await fetchJson(url, {
      upstream: "OpenAQ",
      schema,
      headers: { "X-API-Key": apiKey },
      cacheKey,
      revalidate: OPENAQ_TTL,
      // Not tied to one caller's AbortSignal: other requests may be waiting on the same cached call.
      beforeFetch: () => limiter.acquire(),
    });
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 429) limiter.backoff(60_000);
    throw err;
  }
}

/**
 * PM2.5 monitoring stations inside `b` via OpenAQ v3 (map markers when WAQI
 * is not available):
 *  1. /v3/locations?bbox=…&parameters_id=2 to find stations with a PM2.5 sensor,
 *  2. /v3/locations/{id}/latest for the most recently updated ones.
 * US AQI is computed in-app from the latest hourly PM2.5 value (EPA 2024
 * breakpoints) and labeled as such. Stations without a fresh, numeric PM2.5
 * reading are dropped.
 */
export async function getOpenAqStations(b: Bounds, apiKey: string): Promise<Station[]> {
  const bbox = `${b.west},${b.south},${b.east},${b.north}`;
  const locUrl = `${OPENAQ_BASE}/locations?${new URLSearchParams({
    bbox,
    parameters_id: String(PM25_PARAMETER_ID),
    limit: "100",
  })}`;
  const locBody = await oaq(locUrl, OpenAqLocationsResponseSchema, apiKey, `openaq:locations:${bbox}`);

  const now = Date.now();
  const candidates = (locBody as { results: unknown[] }).results
    .map((r) => OpenAqLocationSchema.safeParse(r))
    .filter((p) => p.success)
    .map((p) => p.data)
    .map((loc) => ({
      loc,
      sensor: loc.sensors.find((s) => s.parameter.id === PM25_PARAMETER_ID && /g\/m/.test(s.parameter.units)),
    }))
    .filter(
      (x): x is { loc: typeof x.loc; sensor: NonNullable<typeof x.sensor> } =>
        x.sensor !== undefined &&
        x.loc.coordinates.latitude !== null &&
        x.loc.coordinates.longitude !== null &&
        isFresh(x.loc.datetimeLast?.utc, now),
    )
    .sort((a, b2) => Date.parse(b2.loc.datetimeLast?.utc ?? "") - Date.parse(a.loc.datetimeLast?.utc ?? ""))
    .slice(0, MAX_LOCATIONS);

  const stations = await mapLimit(candidates, CONCURRENCY, async ({ loc, sensor }): Promise<Station | null> => {
    try {
      const latest = (await oaq(`${OPENAQ_BASE}/locations/${loc.id}/latest`, OpenAqLatestResponseSchema, apiKey, `openaq:latest:${loc.id}`)) as {
        results: unknown[];
      };
      const item = latest.results
        .map((r) => OpenAqLatestItemSchema.safeParse(r))
        .find((p) => p.success && p.data.sensorsId === sensor.id);
      if (!item?.success) return null;
      const { value, datetime } = item.data;
      if (!Number.isFinite(value) || value < 0 || !isFresh(datetime.utc, now)) return null;
      const aqi = pm25Index(value);
      if (aqi === null) return null;
      return {
        id: `openaq-${loc.id}`,
        source: "openaq",
        name: loc.name || loc.locality || `OpenAQ location ${loc.id}`,
        latitude: loc.coordinates.latitude as number,
        longitude: loc.coordinates.longitude as number,
        aqi,
        aqiBasis: "pm25-latest",
        dominant: null,
        pm25: value,
        updatedAt: new Date(Date.parse(datetime.utc)).toISOString(),
        url: `https://explore.openaq.org/locations/${loc.id}`,
      };
    } catch {
      // One station failing should not hide the others.
      return null;
    }
  });
  return stations.filter((s): s is Station => s !== null);
}

/* ------------------------------------------------------------------------- */
/* Station-based India NAQI (Phase 9b)                                        */
/* ------------------------------------------------------------------------- */

/**
 * Station-based India NAQI around a point from OpenAQ concentrations:
 *  1. /v3/locations?coordinates=lat,lon&radius=15000 (one request);
 *  2. the 15 nearest stations that reported in the last 3 hours with a PM2.5
 *     or PM10 sensor, CPCB-sourced stations first (lib/station-naqi.ts);
 *  3. per station: /locations/{id}/latest (every gas's latest hour) and
 *     /sensors/{id}/hours for PM2.5 and PM10 (the last 24 hours), so at most
 *     1 + 15 × 3 = 46 requests per city, each cached 10 minutes and passed
 *     through the shared 50-per-minute limiter;
 *  4. NAQI per station (lib/station-naqi.ts) and the median across stations.
 * A cancelled request (`signal`) starts no further upstream calls.
 */
export async function getOpenAqStationNaqi(lat: number, lon: number, apiKey: string, signal?: AbortSignal): Promise<StationNaqiResponse> {
  const coords = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const radius = String(STATION_NAQI_RADIUS_KM * 1000);
  const body = await oaq(
    `${OPENAQ_BASE}/locations?${new URLSearchParams({ coordinates: coords, radius, limit: "100" })}`,
    OpenAqLocationsResponseSchema,
    apiKey,
    `openaq:near:${coords}:${radius}`,
  );
  const now = Date.now();
  const all = parseLocations(body, lat, lon);
  const chosen = chooseStations(all, now, STATION_NAQI_MAX_STATIONS);
  const byId = new Map(all.map((l) => [l.id, l]));
  // Hour-aligned start so the hours cache key is stable within the hour.
  const from = new Date(Math.floor((now - 25 * 3600_000) / 3600_000) * 3600_000).toISOString();

  const stations = await mapLimit(
    chosen,
    CONCURRENCY,
    async (c): Promise<StationNaqiStation> => {
      const loc = byId.get(c.id)!;
      const baseStation = {
        id: `openaq-${c.id}`,
        name: c.name,
        provider: c.provider,
        cpcb: isCpcbProvider(c.provider),
        latitude: c.latitude,
        longitude: c.longitude,
        distanceKm: c.distanceKm,
        url: loc.url,
      };
      try {
        const latestBody = await oaq(`${OPENAQ_BASE}/locations/${c.id}/latest`, OpenAqLatestResponseSchema, apiKey, `openaq:latest:${c.id}`);
        // Newest sensor per parameter (CPCB locations also list legacy sensors last seen years ago).
        const picked = pickCurrentSensors(loc.sensors, latestBody, baseStation.cpcb);
        const pmHours = [];
        for (const s of picked.pm) {
          const hb = await oaq(
            `${OPENAQ_BASE}/sensors/${s.id}/hours?${new URLSearchParams({ datetime_from: from, limit: "48" })}`,
            OpenAqHoursResponseSchema,
            apiKey,
            `openaq:hours:${s.id}:${from}`,
          );
          pmHours.push(parseHours(hb, s));
        }
        return { ...baseStation, ...naqiForStation(pmHours, picked.gases, now), skipped: picked.skipped };
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        const msg = err instanceof Error ? err.message : "request failed";
        return { ...baseStation, value: null, dominant: null, status: "insufficient", reason: `OpenAQ: ${msg}`, observedAt: null, concentrations: {}, skipped: [], fetchFailed: true };
      }
    },
    signal,
  );

  const summary = summarizeStationNaqi(stations, now);
  return {
    ...summary,
    source: "openaq",
    radiusKm: STATION_NAQI_RADIUS_KM,
    stations: [...stations].sort((a, b) => a.distanceKm - b.distanceKm),
    fetchedAt: new Date().toISOString(),
  };
}
