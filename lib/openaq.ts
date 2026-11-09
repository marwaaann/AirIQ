import "server-only";

import { pm25Index } from "@/lib/aqi";
import type { Bounds } from "@/lib/grid";
import { fetchJson } from "@/lib/http";
import {
  OpenAqLatestItemSchema,
  OpenAqLatestResponseSchema,
  OpenAqLocationSchema,
  OpenAqLocationsResponseSchema,
} from "@/lib/schemas";
import type { Station } from "@/types/air";

const OPENAQ_BASE = "https://api.openaq.org/v3";
/** OpenAQ parameter id for PM2.5. */
const PM25_PARAMETER_ID = 2;
/** Cap per viewport to stay well inside OpenAQ's free rate limit (60 req/min). */
const MAX_LOCATIONS = 20;
const CONCURRENCY = 5;
/** Ignore readings older than this. */
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

const isFresh = (iso: string | undefined | null, now: number) => {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && now - t <= MAX_AGE_MS && t <= now + 60 * 60 * 1000;
};

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/**
 * PM2.5 monitoring stations inside `b` via OpenAQ v3:
 *  1. /v3/locations?bbox=…&parameters_id=2 to find stations with a PM2.5 sensor,
 *  2. /v3/locations/{id}/latest for the most recently updated ones.
 * US AQI is computed in-app from the latest hourly PM2.5 value (EPA 2024
 * breakpoints) and labeled as such. Stations without a fresh, numeric PM2.5
 * reading are dropped.
 */
export async function getOpenAqStations(b: Bounds, apiKey: string): Promise<Station[]> {
  const headers = { "X-API-Key": apiKey };
  const bbox = `${b.west},${b.south},${b.east},${b.north}`;
  const locUrl = `${OPENAQ_BASE}/locations?${new URLSearchParams({
    bbox,
    parameters_id: String(PM25_PARAMETER_ID),
    limit: "100",
  })}`;
  const locBody = await fetchJson(locUrl, {
    upstream: "OpenAQ",
    schema: OpenAqLocationsResponseSchema,
    headers,
    cacheKey: `openaq:locations:${bbox}`,
  });

  const now = Date.now();
  const candidates = locBody.results
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
      const latest = await fetchJson(`${OPENAQ_BASE}/locations/${loc.id}/latest`, {
        upstream: "OpenAQ",
        schema: OpenAqLatestResponseSchema,
        headers,
        cacheKey: `openaq:latest:${loc.id}`,
      });
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
