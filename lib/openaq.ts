import "server-only";

import { pm25Index } from "@/lib/aqi";
import type { Bounds } from "@/lib/grid";
import { fetchJson } from "@/lib/http";
import { haversineKm, type StationNaqi } from "@/lib/headline-source";
import {
  OpenAqHourItemSchema,
  OpenAqHoursResponseSchema,
  OpenAqLatestItemSchema,
  OpenAqLatestResponseSchema,
  OpenAqLocationSchema,
  OpenAqLocationsResponseSchema,
} from "@/lib/schemas";
import { naqiFromSensorHours, type SensorHours } from "@/lib/station-naqi";
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

/* ------------------------------------------------------------------------- */
/* Station-based India NAQI (Phase 9)                                         */
/* ------------------------------------------------------------------------- */

const NAQI_PARAMETERS = new Set(["pm25", "pm10", "no2", "so2", "o3", "co", "nh3"]);
const FRESH_MS = 3 * 60 * 60 * 1000;

/**
 * NAQI from the nearest fresh OpenAQ station within `radiusKm` that has PM2.5
 * or PM10, computed from its own hourly concentrations (last 26 h). Returns
 * null when no station qualifies or CPCB's minimum-data rules are not met.
 */
export async function getOpenAqStationNaqi(lat: number, lon: number, apiKey: string, radiusKm = 15): Promise<StationNaqi | null> {
  const headers = { "X-API-Key": apiKey };
  const coords = `${lat.toFixed(4)},${lon.toFixed(4)}`;
  const radius = String(Math.round(Math.min(25, radiusKm) * 1000));
  const body = await fetchJson(`${OPENAQ_BASE}/locations?${new URLSearchParams({ coordinates: coords, radius, limit: "25" })}`, {
    upstream: "OpenAQ",
    schema: OpenAqLocationsResponseSchema,
    headers,
    cacheKey: `openaq:near:${coords}:${radius}`,
  });
  const now = Date.now();
  const candidates = body.results
    .map((r) => OpenAqLocationSchema.safeParse(r))
    .filter((p) => p.success)
    .map((p) => p.data)
    .filter((l) => l.coordinates.latitude !== null && l.coordinates.longitude !== null)
    .filter((l) => {
      const t = Date.parse(l.datetimeLast?.utc ?? "");
      return Number.isFinite(t) && now - t <= FRESH_MS;
    })
    .filter((l) => l.sensors.some((s) => s.parameter.name === "pm25" || s.parameter.name === "pm10"))
    .map((l) => ({ l, d: haversineKm(lat, lon, l.coordinates.latitude as number, l.coordinates.longitude as number) }))
    .filter((x) => x.d <= radiusKm)
    .sort((a, b) => a.d - b.d)
    .slice(0, 2);

  const from = new Date(now - 26 * 60 * 60 * 1000).toISOString();
  for (const { l, d } of candidates) {
    const sensors = l.sensors.filter((s) => NAQI_PARAMETERS.has(s.parameter.name));
    const hours = await mapLimit(sensors, CONCURRENCY, async (s): Promise<SensorHours | null> => {
      try {
        const res = await fetchJson(`${OPENAQ_BASE}/sensors/${s.id}/hours?${new URLSearchParams({ datetime_from: from, limit: "48" })}`, {
          upstream: "OpenAQ",
          schema: OpenAqHoursResponseSchema,
          headers,
          cacheKey: `openaq:hours:${s.id}:${from.slice(0, 13)}`,
        });
        const items = res.results
          .map((r) => OpenAqHourItemSchema.safeParse(r))
          .filter((p) => p.success)
          .map((p) => ({ time: p.data.period.datetimeTo.utc, value: p.data.value }));
        return { parameter: s.parameter.name, units: s.parameter.units, hours: items };
      } catch {
        return null;
      }
    });
    const { result, observedAt } = naqiFromSensorHours(hours.filter((h): h is SensorHours => h !== null));
    if (result.status === "ok" && result.aqi !== null && observedAt && now - Date.parse(observedAt) <= FRESH_MS) {
      return { value: result.aqi, stationName: l.name || l.locality || `OpenAQ location ${l.id}`, distanceKm: d, observedAt };
    }
  }
  return null;
}
