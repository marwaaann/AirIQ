import "server-only";

import { computeUsAqiAt, trailingMean, type HourlyConcentrations } from "@/lib/aqi";
import { GEOCODE_REVALIDATE_SECONDS, REVALIDATE_SECONDS } from "@/lib/cache";
import { fetchJson, UpstreamError } from "@/lib/http";
import {
  AQ_VARIABLES,
  EU_SUB_INDEX_VARIABLES,
  SUB_INDEX_POLLUTANTS,
  US_SUB_INDEX_VARIABLES,
  AqMultiResponseSchema,
  AqResponseSchema,
  GeocodeResponseSchema,
  WEATHER_HOURLY_EXTRA,
  WEATHER_VARIABLES,
  WeatherResponseSchema,
  SunResponseSchema,
  type AqResponse,
} from "@/lib/schemas";
import type {
  AirQuality,
  AirSeries,
  GeoLocation,
  GridCell,
  HourlyPoint,
  Pollutant,
  PollutantValues,
  SubIndexValues,
  WeatherPoint,
  WeatherSeries,
} from "@/types/air";
import type { AirResponse, EpaCrossCheck } from "@/types/api";

const AQ_BASE = "https://air-quality-api.open-meteo.com/v1/air-quality";
const WEATHER_BASE = "https://api.open-meteo.com/v1/forecast";
const GEOCODE_BASE = "https://geocoding-api.open-meteo.com/v1/search";

export const MAX_PAST_DAYS = 92;
export const MAX_FORECAST_DAYS = 5;

/** Round coordinates to ~1 km so cache keys are shared between nearby requests. */
const coord = (v: number) => Number(v.toFixed(3));

/**
 * Open-Meteo returns local wall-clock times ("2026-11-10T00:30") when
 * `timezone=auto`. Convert to a real UTC ISO string using the offset.
 */
export function localToUtcIso(local: string, utcOffsetSeconds: number): string {
  const ms = Date.parse(`${local.length === 16 ? `${local}:00` : local}Z`);
  if (Number.isNaN(ms)) return local;
  return new Date(ms - utcOffsetSeconds * 1000).toISOString();
}

const at = (arr: readonly (number | null)[] | undefined, i: number): number | null => {
  const v = arr?.[i];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
};

function pollutantsAt(h: NonNullable<AqResponse["hourly"]>, i: number): PollutantValues {
  return {
    pm2_5: at(h.pm2_5, i),
    pm10: at(h.pm10, i),
    nitrogen_dioxide: at(h.nitrogen_dioxide, i),
    sulphur_dioxide: at(h.sulphur_dioxide, i),
    ozone: at(h.ozone, i),
    carbon_monoxide: at(h.carbon_monoxide, i),
  };
}

type AqHourly = NonNullable<AqResponse["hourly"]>;

/** Hourly sub-indices at index i, if the series was requested with them. */
function hourlySubIndices(h: AqHourly, i: number, scale: "us" | "eu"): SubIndexValues | undefined {
  const raw: Partial<Record<Pollutant, number | null>> =
    scale === "us"
      ? {
          pm2_5: at(h.us_aqi_pm2_5, i),
          pm10: at(h.us_aqi_pm10, i),
          nitrogen_dioxide: at(h.us_aqi_nitrogen_dioxide, i),
          sulphur_dioxide: at(h.us_aqi_sulphur_dioxide, i),
          ozone: at(h.us_aqi_ozone, i),
          carbon_monoxide: at(h.us_aqi_carbon_monoxide, i),
        }
      : {
          pm2_5: at(h.european_aqi_pm2_5, i),
          pm10: at(h.european_aqi_pm10, i),
          nitrogen_dioxide: at(h.european_aqi_nitrogen_dioxide, i),
          sulphur_dioxide: at(h.european_aqi_sulphur_dioxide, i),
          ozone: at(h.european_aqi_ozone, i),
        };
  const out: SubIndexValues = {};
  let any = false;
  for (const [k, v] of Object.entries(raw) as [Pollutant, number | null][]) {
    if (v !== null) {
      out[k] = v;
      any = true;
    }
  }
  return any ? out : undefined;
}

function toSeries(r: AqResponse): AirSeries {
  const h = r.hourly;
  const points: HourlyPoint[] = h
    ? h.time.map((t, i) => {
        const p: HourlyPoint = {
          time: localToUtcIso(t, r.utc_offset_seconds),
          usAqi: at(h.us_aqi, i),
          euAqi: at(h.european_aqi, i),
          pollutants: pollutantsAt(h, i),
        };
        const us = hourlySubIndices(h, i, "us");
        const eu = hourlySubIndices(h, i, "eu");
        if (us) p.usSubIndices = us;
        if (eu) p.euSubIndices = eu;
        return p;
      })
    : [];
  return {
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
    utcOffsetSeconds: r.utc_offset_seconds,
    points,
  };
}

function hourlyConcentrations(points: readonly HourlyPoint[]): HourlyConcentrations {
  const col = (p: Pollutant) => points.map((x) => x.pollutants[p]);
  return {
    pm2_5: col("pm2_5"),
    pm10: col("pm10"),
    ozone: col("ozone"),
    carbon_monoxide: col("carbon_monoxide"),
    nitrogen_dioxide: col("nitrogen_dioxide"),
    sulphur_dioxide: col("sulphur_dioxide"),
  };
}

type AqCurrent = NonNullable<AqResponse["current"]>;

function subIndices(c: AqCurrent, scale: "us" | "eu"): SubIndexValues {
  const raw: Partial<Record<Pollutant, number | null | undefined>> =
    scale === "us"
      ? {
          pm2_5: c.us_aqi_pm2_5,
          pm10: c.us_aqi_pm10,
          nitrogen_dioxide: c.us_aqi_nitrogen_dioxide,
          sulphur_dioxide: c.us_aqi_sulphur_dioxide,
          ozone: c.us_aqi_ozone,
          carbon_monoxide: c.us_aqi_carbon_monoxide,
        }
      : {
          // The European index has no CO component.
          pm2_5: c.european_aqi_pm2_5,
          pm10: c.european_aqi_pm10,
          nitrogen_dioxide: c.european_aqi_nitrogen_dioxide,
          sulphur_dioxide: c.european_aqi_sulphur_dioxide,
          ozone: c.european_aqi_ozone,
        };
  const out: SubIndexValues = {};
  for (const p of SUB_INDEX_POLLUTANTS) {
    const v = raw[p];
    if (typeof v === "number" && Number.isFinite(v)) out[p] = v;
  }
  return out;
}

function dominantOf(sub: SubIndexValues): Pollutant | null {
  let best: Pollutant | null = null;
  let max = -Infinity;
  for (const [k, v] of Object.entries(sub) as [Pollutant, number][]) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return best;
}

/** Index of the last hourly point at or before `isoTime`. */
function indexAtOrBefore(points: readonly HourlyPoint[], isoTime: string): number {
  const target = Date.parse(isoTime);
  let idx = -1;
  for (let i = 0; i < points.length; i++) {
    if (Date.parse(points[i].time) <= target) idx = i;
    else break;
  }
  return idx;
}

/* ------------------------------------------------------------------------- */
/* Geocoding                                                                  */
/* ------------------------------------------------------------------------- */

export async function geocode(query: string, count = 8, language = "en"): Promise<GeoLocation[]> {
  const url = `${GEOCODE_BASE}?${new URLSearchParams({
    name: query,
    count: String(count),
    language,
    format: "json",
  })}`;
  const data = await fetchJson(url, {
    upstream: "Open-Meteo Geocoding",
    schema: GeocodeResponseSchema,
    revalidate: GEOCODE_REVALIDATE_SECONDS,
  });
  return (data.results ?? []).map((r) => ({
    name: r.name,
    latitude: r.latitude,
    longitude: r.longitude,
    country: r.country,
    countryCode: r.country_code,
    admin1: r.admin1,
    timezone: r.timezone,
    population: r.population,
  }));
}

/* ------------------------------------------------------------------------- */
/* Air quality                                                                */
/* ------------------------------------------------------------------------- */

/** Current conditions + last 24 h + in-app EPA cross-check. */
export async function getCurrentAir(lat: number, lon: number): Promise<AirResponse> {
  const params = new URLSearchParams({
    latitude: String(coord(lat)),
    longitude: String(coord(lon)),
    current: [...AQ_VARIABLES, "uv_index", ...US_SUB_INDEX_VARIABLES, ...EU_SUB_INDEX_VARIABLES].join(","),
    hourly: AQ_VARIABLES.join(","),
    past_days: "2",
    forecast_days: "1",
    timezone: "auto",
  });
  const r = await fetchJson(`${AQ_BASE}?${params}`, {
    upstream: "Open-Meteo Air Quality",
    schema: AqResponseSchema,
  });
  if (!r.current) throw new UpstreamError("Open-Meteo Air Quality", "Open-Meteo Air Quality: no current data for this location");

  const c = r.current;
  const current: AirQuality = {
    source: "open-meteo",
    latitude: r.latitude,
    longitude: r.longitude,
    time: localToUtcIso(c.time, r.utc_offset_seconds),
    timezone: r.timezone,
    utcOffsetSeconds: r.utc_offset_seconds,
    usAqi: c.us_aqi ?? null,
    euAqi: c.european_aqi ?? null,
    uvIndex: c.uv_index ?? null,
    pollutants: {
      pm2_5: c.pm2_5 ?? null,
      pm10: c.pm10 ?? null,
      nitrogen_dioxide: c.nitrogen_dioxide ?? null,
      sulphur_dioxide: c.sulphur_dioxide ?? null,
      ozone: c.ozone ?? null,
      carbon_monoxide: c.carbon_monoxide ?? null,
    },
    usSubIndices: subIndices(c, "us"),
    euSubIndices: subIndices(c, "eu"),
    dominantUs: null,
    dominantEu: null,
  };
  current.dominantUs = dominantOf(current.usSubIndices);
  current.dominantEu = dominantOf(current.euSubIndices);

  const series = toSeries(r);
  const nowIdx = indexAtOrBefore(series.points, current.time);
  let epa: EpaCrossCheck = { aqi2024: null, aqi2012: null, dominant: null, subIndices: {}, pm25Mean24h: null };
  if (nowIdx >= 0) {
    const h = hourlyConcentrations(series.points);
    const r24 = computeUsAqiAt(h, nowIdx, { pm25Edition: "2024" });
    const r12 = computeUsAqiAt(h, nowIdx, { pm25Edition: "2012" });
    epa = {
      aqi2024: r24.aqi,
      aqi2012: r12.aqi,
      dominant: r24.dominant,
      subIndices: r24.subIndices,
      pm25Mean24h: trailingMean(h.pm2_5, nowIdx, 24),
    };
  }
  current.dominantUs ??= epa.dominant;

  const recent: AirSeries = {
    ...series,
    points: nowIdx >= 0 ? series.points.slice(Math.max(0, nowIdx - 23), nowIdx + 1) : [],
  };

  return { current, epa, recent, fetchedAt: new Date().toISOString() };
}

/** Hourly series for history (`pastDays`) and/or forecast (`forecastDays`). */
export async function getAirSeries(
  lat: number,
  lon: number,
  pastDays: number,
  forecastDays: number,
  revalidate: number = REVALIDATE_SECONDS,
): Promise<AirSeries> {
  const params = new URLSearchParams({
    latitude: String(coord(lat)),
    longitude: String(coord(lon)),
    // Overall indices, concentrations and per-pollutant sub-indices on both scales.
    hourly: [...AQ_VARIABLES, ...US_SUB_INDEX_VARIABLES, ...EU_SUB_INDEX_VARIABLES].join(","),
    past_days: String(Math.min(Math.max(0, Math.round(pastDays)), MAX_PAST_DAYS)),
    // forecast_days=1 means "today only"; it's the minimum Open-Meteo accepts.
    forecast_days: String(Math.min(Math.max(1, Math.round(forecastDays)), MAX_FORECAST_DAYS)),
    timezone: "auto",
  });
  const r = await fetchJson(`${AQ_BASE}?${params}`, {
    upstream: "Open-Meteo Air Quality",
    schema: AqResponseSchema,
    revalidate,
  });
  return toSeries(r);
}

/** Most points accepted in one batched grid request. */
export const MAX_GRID_BATCH = 64;

/** Sub-index variables needed to color the map layers on both scales. */
const GRID_SUB_INDEX_VARIABLES = [
  "us_aqi_pm2_5",
  "us_aqi_pm10",
  "us_aqi_nitrogen_dioxide",
  "us_aqi_ozone",
  "us_aqi_sulphur_dioxide",
  "us_aqi_carbon_monoxide",
  "european_aqi_pm2_5",
  "european_aqi_pm10",
  "european_aqi_nitrogen_dioxide",
  "european_aqi_ozone",
  "european_aqi_sulphur_dioxide",
] as const;

/**
 * Current readings for up to 64 points in ONE multi-location request
 * (comma-separated latitude/longitude lists; Open-Meteo returns an array in
 * the same order). Any upstream failure is thrown, so callers never get a
 * partially filled grid.
 */
export async function getAirGrid(points: readonly { lat: number; lon: number }[]): Promise<GridCell[]> {
  if (points.length === 0) return [];
  if (points.length > MAX_GRID_BATCH) {
    throw new UpstreamError("Open-Meteo Air Quality", `grid too large (${points.length} > ${MAX_GRID_BATCH} points)`, 400);
  }
  const params = new URLSearchParams({
    latitude: points.map((p) => String(p.lat)).join(","),
    longitude: points.map((p) => String(p.lon)).join(","),
    current: [...AQ_VARIABLES, ...GRID_SUB_INDEX_VARIABLES].join(","),
    timezone: "GMT",
  });
  const data = await fetchJson(`${AQ_BASE}?${params}`, {
    upstream: "Open-Meteo Air Quality",
    schema: AqMultiResponseSchema,
  });
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length !== points.length) {
    throw new UpstreamError(
      "Open-Meteo Air Quality",
      `Open-Meteo Air Quality: expected ${points.length} locations, got ${arr.length}`,
    );
  }
  const cells: GridCell[] = [];
  arr.forEach((r, i) => {
    const c = r.current;
    const req = points[i];
    if (!c) return; // No reading for this point: leave a gap rather than invent one.
    cells.push({
      // Report the requested (snapped) position so the grid stays regular;
      // Open-Meteo picks its nearest model cell internally.
      latitude: req.lat,
      longitude: req.lon,
      time: localToUtcIso(c.time, 0),
      usAqi: c.us_aqi ?? null,
      euAqi: c.european_aqi ?? null,
      pollutants: {
        pm2_5: c.pm2_5 ?? null,
        pm10: c.pm10 ?? null,
        nitrogen_dioxide: c.nitrogen_dioxide ?? null,
        sulphur_dioxide: c.sulphur_dioxide ?? null,
        ozone: c.ozone ?? null,
        carbon_monoxide: c.carbon_monoxide ?? null,
      },
      usSubIndices: subIndices(c, "us"),
      euSubIndices: subIndices(c, "eu"),
    });
  });
  return cells;
}

/* ------------------------------------------------------------------------- */
/* Weather                                                                    */
/* ------------------------------------------------------------------------- */

export async function getWeather(
  lat: number,
  lon: number,
  pastDays: number,
  forecastDays: number,
  revalidate: number = REVALIDATE_SECONDS,
): Promise<WeatherSeries> {
  const params = new URLSearchParams({
    latitude: String(coord(lat)),
    longitude: String(coord(lon)),
    current: WEATHER_VARIABLES.join(","),
    hourly: [...WEATHER_VARIABLES, ...WEATHER_HOURLY_EXTRA].join(","),
    past_days: String(Math.min(Math.max(0, Math.round(pastDays)), MAX_PAST_DAYS)),
    forecast_days: String(Math.min(Math.max(1, Math.round(forecastDays)), 16)),
    wind_speed_unit: "kmh",
    timezone: "auto",
  });
  const r = await fetchJson(`${WEATHER_BASE}?${params}`, {
    upstream: "Open-Meteo Weather",
    schema: WeatherResponseSchema,
    revalidate,
  });

  const h = r.hourly;
  const points: WeatherPoint[] = h
    ? h.time.map((t, i) => ({
        time: localToUtcIso(t, r.utc_offset_seconds),
        temperature: at(h.temperature_2m, i),
        humidity: at(h.relative_humidity_2m, i),
        windSpeed: at(h.wind_speed_10m, i),
        windDirection: at(h.wind_direction_10m, i),
        pressure: at(h.surface_pressure, i),
        precipitation: at(h.precipitation, i),
        boundaryLayerHeight: at(h.boundary_layer_height, i),
      }))
    : [];
  const c = r.current;
  return {
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
    utcOffsetSeconds: r.utc_offset_seconds,
    current: c
      ? {
          time: localToUtcIso(c.time, r.utc_offset_seconds),
          temperature: c.temperature_2m ?? null,
          humidity: c.relative_humidity_2m ?? null,
          windSpeed: c.wind_speed_10m ?? null,
          windDirection: c.wind_direction_10m ?? null,
          pressure: c.surface_pressure ?? null,
          precipitation: c.precipitation ?? null,
          boundaryLayerHeight: null,
        }
      : null,
    points,
  };
}

/* ------------------------------------------------------------------------- */
/* Sunrise / sunset                                                           */
/* ------------------------------------------------------------------------- */

/** Daily sunrise/sunset (UTC ISO) for the next `days` local days. */
export async function getSunTimes(lat: number, lon: number, days = 3): Promise<{ sunrise: string; sunset: string }[]> {
  const params = new URLSearchParams({
    latitude: String(coord(lat)),
    longitude: String(coord(lon)),
    daily: "sunrise,sunset",
    forecast_days: String(days),
    timezone: "auto",
  });
  const r = await fetchJson(`${WEATHER_BASE}?${params}`, {
    upstream: "Open-Meteo Weather",
    schema: SunResponseSchema,
    revalidate: 6 * 60 * 60,
  });
  const out: { sunrise: string; sunset: string }[] = [];
  r.daily.time.forEach((_, i) => {
    const rise = r.daily.sunrise[i];
    const set = r.daily.sunset[i];
    // Polar day/night: no sunrise or sunset → skip that day rather than guess.
    if (rise && set) out.push({ sunrise: localToUtcIso(rise, r.utc_offset_seconds), sunset: localToUtcIso(set, r.utc_offset_seconds) });
  });
  return out;
}
