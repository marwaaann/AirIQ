/**
 * Assistant tools. Each tool validates its arguments with Zod, calls the data
 * layer (injected, so tests can mock it), and returns a COMPACT JSON object
 * with values, units, local times, the time zone, the source and the data
 * timestamp. Failures and bad arguments return `{ status: "error" }` objects
 * to the model instead of throwing.
 *
 * Pure module (relative imports only) so it runs under `node --test`.
 */

import { z } from "../zod.ts";

import { POLLUTANT_INFO, POLLUTANT_ORDER, SCALE_NAME, formatIndex, getCategory, isBeyondIndex, type PollutantKey, type ScaleKey } from "../aqi-categories.ts";
import { DATA_SOURCE_MODES, selectHeadline, shortName, sourceLabel, type DataSourceMode, type HeadlineSource } from "../headline-source.ts";
import { dailyRanges } from "../forecast-insights.ts";
import { healthAdvice } from "../health-advice.ts";
import {
  bestWorst,
  buildInsights,
  dailyStats,
  extremeHour,
  hourOfDayProfile,
  periodChange,
  periodSummary,
  toLocalHours,
} from "../history-stats.ts";
import { PROFILE_IDS, PROFILES } from "../profiles.ts";
import { findSafeWindows } from "../safe-windows.ts";
import { slugifyName } from "../slug.ts";
import { datesEnding, formatHour, localParts } from "../time.ts";
import type { AirSeries, GeoLocation } from "../../types/air.ts";
import type { AirResponse, NearbyStationsResponse } from "../../types/api.ts";

export const SOURCE = "Open-Meteo / CAMS";

/** Everything the tools need from the outside world. */
export interface AssistantDataLayer {
  geocode(query: string, count: number): Promise<GeoLocation[]>;
  currentAir(lat: number, lon: number): Promise<AirResponse>;
  airSeries(lat: number, lon: number, pastDays: number, forecastDays: number): Promise<AirSeries>;
  sunTimes(lat: number, lon: number): Promise<{ sunrise: string; sunset: string }[] | null>;
  /** Ground stations within 15 km (WAQI/OpenAQ); status "error"/"not-configured" when unavailable. */
  nearbyStations(lat: number, lon: number): Promise<NearbyStationsResponse>;
  now(): number;
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* ------------------------------------------------------------------------- */

const r1 = (v: number) => Math.round(v * 10) / 10;
const r0 = (v: number) => Math.round(v);

function zoneAbbrev(ms: number, timeZone: string): string {
  try {
    const p = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" }).formatToParts(new Date(ms));
    return p.find((x) => x.type === "timeZoneName")?.value ?? timeZone;
  } catch {
    return "UTC";
  }
}

/** "Tue 10 Nov 10:30" in the city's zone. */
export function localStamp(iso: string | number, timeZone: string): string {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).formatToParts(new Date(ms));
    const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "";
    return `${get("weekday")} ${get("day")} ${get("month")} ${get("hour")}:${get("minute")}`;
  } catch {
    return new Date(ms).toISOString();
  }
}

function dataTime(iso: string, timeZone: string) {
  const ms = Date.parse(iso);
  return { utc: new Date(ms).toISOString(), local: localStamp(ms, timeZone), zone: zoneAbbrev(ms, timeZone) };
}

const coordsLabel = (lat: number, lon: number) => `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(2)}°${lon >= 0 ? "E" : "W"}`;

/** Display label only (never used for lookups); untrusted, so trimmed and stripped. */
const label = (city: string | undefined, lat: number, lon: number) =>
  city ? city.replace(/[\u0000-\u001f<>]/g, "").slice(0, 60) : coordsLabel(lat, lon);

/** Value on a scale for a point; NAQI is AirIQ's computation from model concentrations. */
const pointValue = (p: { usAqi: number | null; euAqi: number | null; inAqi?: number | null }, scale: ScaleKey) =>
  scale === "us" ? p.usAqi : scale === "eu" ? p.euAqi : (p.inAqi ?? null);
const pointSubs = (p: { usSubIndices?: Partial<Record<string, number>>; euSubIndices?: Partial<Record<string, number>>; inSubIndices?: Partial<Record<string, number>> }, scale: ScaleKey) =>
  scale === "us" ? p.usSubIndices : scale === "eu" ? p.euSubIndices : p.inSubIndices;

/** "231", or "500+" with beyondIndex=true and the computed value. */
function indexValue(v: number | null, scale: ScaleKey) {
  if (v === null) return { value: null, display: "n/a", category: null, beyondIndex: false };
  return { value: Math.round(v), display: formatIndex(v, scale), category: getCategory(v, scale).label, beyondIndex: isBeyondIndex(v, scale) };
}

interface HeadlineBundle {
  air: AirResponse;
  near: NearbyStationsResponse | null;
  h: HeadlineSource;
}

/** The same headline the city page shows: station-first on the US AQI, model on EU, NAQI from concentrations. */
async function headlineFor(d: AssistantDataLayer, lat: number, lon: number, scale: ScaleKey, mode: DataSourceMode): Promise<HeadlineBundle> {
  const [air, near] = await Promise.all([d.currentAir(lat, lon), d.nearbyStations(lat, lon).catch(() => null)]);
  const c = air.current;
  const h = selectHeadline({
    scale,
    mode,
    now: d.now(),
    model: { value: pointValue(c, scale), usAqi: c.usAqi, time: c.time },
    stations: near?.stations ?? [],
    stationStatus: near ? near.status : "error",
    stationNaqi: near?.stationNaqi ?? null,
  });
  return { air, near, h };
}

/** Station summary for the model: count, median, highest, nearest (US AQI as reported), and the gap to the model. */
function stationBlock(h: HeadlineSource, timeZone: string) {
  const s = h.summary;
  const st = (r: NonNullable<typeof s.highest>) => ({
    name: shortName(r.name),
    aqi: r.value,
    display: formatIndex(r.value, "us"),
    distanceKm: Math.round(r.distanceKm * 10) / 10,
    observedLocal: r.observedAt ? localStamp(r.observedAt, timeZone) : null,
  });
  return {
    scale: "US AQI (as reported by the station network)",
    freshStationsWithin15km: s.freshCount,
    medianAqi: s.median,
    highest: s.highest ? st(s.highest) : null,
    nearest: s.nearest ? st(s.nearest) : null,
    stationVsModelPercent: h.divergence === null ? null : Math.round(h.divergence * 100),
    note: h.stationNote,
  };
}

/* ------------------------------------------------------------------------- */
/* Argument schemas                                                           */
/* ------------------------------------------------------------------------- */

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const scale = z.enum(["us", "eu", "in"]).default("us");
const source = z.enum(DATA_SOURCE_MODES).default("auto");
const cityLabel = z.string().max(120).optional();
const profile = z.enum(PROFILE_IDS).default("general");

export const ARG_SCHEMAS = {
  resolve_city: z.object({ query: z.string().trim().min(2).max(100) }),
  get_current_aqi: z.object({ lat, lon, city: cityLabel, source }),
  get_history: z.object({
    lat,
    lon,
    days: z.union([z.literal(7), z.literal(30), z.literal(90)]),
    scale,
    city: cityLabel,
  }),
  get_forecast: z.object({ lat, lon, scale, city: cityLabel }),
  compare_cities: z.object({
    cities: z.array(z.object({ name: z.string().min(1).max(120), lat, lon })).min(2).max(4),
    source,
  }),
  get_health_advice: z.object({ lat, lon, profile, scale, city: cityLabel, source }),
  find_safe_windows: z.object({
    lat,
    lon,
    profile,
    activity: z.enum(["walk", "exercise", "windows"]).default("walk"),
    minHours: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    scale,
    daylightOnly: z.boolean().default(false),
    city: cityLabel,
    source,
  }),
} as const;

export type ToolName = keyof typeof ARG_SCHEMAS;
export const TOOL_NAMES = Object.keys(ARG_SCHEMAS) as ToolName[];

/* ------------------------------------------------------------------------- */
/* Gemini function declarations (JSON Schema)                                 */
/* ------------------------------------------------------------------------- */

const LATLON = {
  lat: { type: "number", description: "Latitude in decimal degrees, from resolve_city or the page context." },
  lon: { type: "number", description: "Longitude in decimal degrees, from resolve_city or the page context." },
  city: { type: "string", description: "City display name, used only for labels." },
} as const;
const SCALE = {
  type: "string",
  enum: ["us", "eu", "in"],
  description: "Index scale: 'us' (US EPA AQI), 'eu' (European AQI) or 'in' (India NAQI, computed by AirIQ from concentrations per CPCB). Default 'us'.",
} as const;
const SOURCE_ARG = {
  type: "string",
  enum: [...DATA_SOURCE_MODES],
  description: "Data source for the headline: 'auto' (station median/nearest station when available, else model), 'station' or 'model'. Default 'auto'; use the page context's value when given.",
} as const;
const PROFILE = {
  type: "string",
  enum: [...PROFILE_IDS],
  description: "Health profile: general, respiratory (asthma etc.), older, children, pregnancy, athlete. Default 'general'.",
} as const;

export const FUNCTION_DECLARATIONS = [
  {
    name: "resolve_city",
    description:
      "Look up a place name with Open-Meteo geocoding. Returns status 'ok' with one city (name, region, country, lat, lon, timezone), 'ambiguous' with up to 3 candidates (you MUST ask the user which one before fetching any data), or 'not_found'. Accepts 'City' or 'City, Region/Country'.",
    parametersJsonSchema: {
      type: "object",
      properties: { query: { type: "string", description: "Place name as the user wrote it." } },
      required: ["query"],
    },
  },
  {
    name: "get_current_aqi",
    description:
      "Current air quality at a location. Returns the HEADLINE in effect (station median, nearest station, or model, with its source, observation time and reason), a summary of ground stations within 15 km (count, median, highest, nearest; US AQI as reported), the model's US AQI and European AQI with categories, India NAQI computed by AirIQ from concentrations, the station-vs-model difference, model pollutant concentrations in µg/m³ with WHO guideline values, and local times. Values above the index top are flagged beyondIndex with display '500+'.",
    parametersJsonSchema: { type: "object", properties: { ...LATLON, source: SOURCE_ARG }, required: ["lat", "lon"] },
  },
  {
    name: "get_history",
    description:
      "Air-quality history for the last 7, 30 or 90 local days on one AQI scale: daily mean/max with hours covered, best and worst day, average, change vs the previous period (when available), typical peak hour, and data-derived insight sentences.",
    parametersJsonSchema: {
      type: "object",
      properties: { ...LATLON, days: { type: "integer", enum: [7, 30, 90], description: "Number of days." }, scale: SCALE },
      required: ["lat", "lon", "days"],
    },
  },
  {
    name: "get_forecast",
    description:
      "Official 5-day air-quality forecast (CAMS via Open-Meteo) on one AQI scale: daily min/mean/max per local day and hourly values for the next 48 hours in local time.",
    parametersJsonSchema: { type: "object", properties: { ...LATLON, scale: SCALE }, required: ["lat", "lon"] },
  },
  {
    name: "compare_cities",
    description:
      "Compare the current air quality of 2–4 already-resolved cities. Returns each city's headline US AQI with its source (station median, nearest station or model), the model US AQI, European AQI and India NAQI with categories and main pollutants, ranked from cleanest to most polluted by the headline US AQI.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        cities: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: {
            type: "object",
            properties: { name: { type: "string" }, lat: { type: "number" }, lon: { type: "number" } },
            required: ["name", "lat", "lon"],
          },
        },
        source: SOURCE_ARG,
      },
      required: ["cities"],
    },
  },
  {
    name: "get_health_advice",
    description:
      "Rule-based health guidance for the current headline air quality and a health profile (US EPA AirNow, EEA, or CPCB NAQI statements). Uses the same headline as the app (stations first on the US AQI). Returns the index used and its source, a headline and recommendations for outdoor activity, indoor air and protection, each with its source ('basis'), plus why it applies.",
    parametersJsonSchema: { type: "object", properties: { ...LATLON, profile: PROFILE, scale: SCALE, source: SOURCE_ARG }, required: ["lat", "lon"] },
  },
  {
    name: "find_safe_windows",
    description:
      "Find times in the next 48 h of the OFFICIAL (model) forecast when AQI stays at or below the profile's threshold, for walking, exercise, or opening windows (cleanest hours). Returns local time windows with AQI ranges, or the least-bad times if none qualify, plus a note when nearby stations currently read much higher than the model (the forecast then likely under-estimates).",
    parametersJsonSchema: {
      type: "object",
      properties: {
        ...LATLON,
        profile: PROFILE,
        activity: { type: "string", enum: ["walk", "exercise", "windows"], description: "Default 'walk'." },
        minHours: { type: "integer", enum: [1, 2, 3], description: "Minimum window length in hours. Default 2." },
        scale: SCALE,
        daylightOnly: { type: "boolean", description: "Exercise only: keep daylight hours. Default false." },
        source: SOURCE_ARG,
      },
      required: ["lat", "lon"],
    },
  },
] as const;

/* ------------------------------------------------------------------------- */
/* Execution                                                                  */
/* ------------------------------------------------------------------------- */

export interface ToolOutcome {
  ok: boolean;
  /** What the model sees. */
  result: Record<string, unknown>;
  /** One line for the UI chip, e.g. "Fetched forecast for Delhi, data as of Tue 10 Nov 10:30 GMT+5:30". */
  summary: string;
  /** A few key values for the "Data used" panel. */
  keyValues: Record<string, string | number | null>;
}

const err = (summary: string, error: string): ToolOutcome => ({ ok: false, result: { status: "error", error }, summary, keyValues: {} });

function pollutantTable(p: AirResponse["current"]["pollutants"]) {
  const out: Record<string, { value: number | null; unit: string; whoGuideline: number }> = {};
  for (const k of POLLUTANT_ORDER) {
    const v = p[k];
    out[POLLUTANT_INFO[k].short] = { value: v === null ? null : r1(v), unit: "µg/m³", whoGuideline: POLLUTANT_INFO[k].who.value };
  }
  return out;
}

const mainName = (k: PollutantKey | null) => (k ? POLLUTANT_INFO[k].short : null);

async function toolResolveCity(a: z.infer<typeof ARG_SCHEMAS.resolve_city>, d: AssistantDataLayer): Promise<ToolOutcome> {
  const [rawName, ...rest] = a.query.split(",");
  const name = rawName.trim();
  const qualifier = rest.join(",").trim().toLowerCase();
  const results = await d.geocode(name, 10);
  const qualified = qualifier
    ? results.filter((r) => [r.admin1, r.country, r.countryCode].some((x) => x && x.toLowerCase().includes(qualifier)))
    : results;
  const exact = qualified.filter((r) => slugifyName(r.name) === slugifyName(name));
  const pool = (exact.length ? exact : qualified).slice().sort((x, y) => (y.population ?? 0) - (x.population ?? 0));
  if (pool.length === 0) {
    return { ok: true, result: { status: "not_found", query: a.query, source: "Open-Meteo Geocoding" }, summary: `No place found for “${a.query.slice(0, 40)}”`, keyValues: { matches: 0 } };
  }
  const describe = (r: GeoLocation) => ({
    name: r.name,
    region: r.admin1 ?? null,
    country: r.country ?? null,
    lat: Math.round(r.latitude * 1000) / 1000,
    lon: Math.round(r.longitude * 1000) / 1000,
    timezone: r.timezone ?? null,
    population: r.population ?? null,
  });
  const top = pool[0];
  const second = pool[1];
  // One clear match: only one candidate, or a top match at least 10× more populous than the next
  // (e.g. London, UK vs London, Ontario). Otherwise the user must choose (e.g. Springfield).
  const topPop = top.population ?? 0;
  const clear = !second || (topPop > 0 && topPop >= 10 * (second.population ?? 0));
  if (clear) {
    const c = describe(top);
    return {
      ok: true,
      result: { status: "ok", city: c, source: "Open-Meteo Geocoding" },
      summary: `Found ${[c.name, c.region, c.country].filter(Boolean).join(", ")}`,
      keyValues: { lat: c.lat, lon: c.lon, timezone: c.timezone },
    };
  }
  const candidates = pool.slice(0, 3).map(describe);
  return {
    ok: true,
    result: {
      status: "ambiguous",
      candidates,
      note: "Several places match. Ask the user which one they mean before fetching any air-quality data.",
      source: "Open-Meteo Geocoding",
    },
    summary: `${candidates.length} places match “${name.slice(0, 40)}”`,
    keyValues: Object.fromEntries(candidates.map((c, i) => [`option ${i + 1}`, [c.name, c.region, c.country].filter(Boolean).join(", ")])),
  };
}

async function toolCurrent(a: z.infer<typeof ARG_SCHEMAS.get_current_aqi>, d: AssistantDataLayer): Promise<ToolOutcome> {
  const { air, h } = await headlineFor(d, a.lat, a.lon, "us", a.source);
  const c = air.current;
  const dt = dataTime(c.time, c.timezone);
  return {
    ok: true,
    result: {
      status: "ok",
      source: SOURCE,
      timezone: c.timezone,
      dataTime: dt,
      headline: {
        scale: "US AQI",
        source: h.source,
        sourceLabel: sourceLabel(h),
        reason: h.reason,
        aqi: indexValue(h.value, "us"),
        observedLocal: h.observedAt ? localStamp(h.observedAt, c.timezone) : null,
      },
      stations: stationBlock(h, c.timezone),
      model: {
        source: "Open-Meteo (CAMS) model grid",
        usAqi: { ...indexValue(c.usAqi, "us"), mainPollutant: mainName(c.dominantUs) },
        europeanAqi: { ...indexValue(c.euAqi, "eu"), mainPollutant: mainName(c.dominantEu) },
      },
      indiaNaqi: {
        ...indexValue(c.inAqi, "in"),
        mainPollutant: mainName(c.dominantIn),
        basis: "model concentrations (24-h PM/NO2/SO2, 8-h CO/O3 means)",
        computedBy: "AirIQ, following CPCB's method; may differ from CPCB's official bulletin",
        note: c.inReason,
      },
      pollutants: pollutantTable(c.pollutants),
      pollutantsSource: "Open-Meteo (CAMS) model concentrations",
    },
    summary: `Fetched current AQI for ${label(a.city, a.lat, a.lon)}, data as of ${dt.local} ${dt.zone} · headline from ${sourceLabel(h)}`,
    keyValues: {
      "headline US AQI": h.value === null ? null : formatIndex(h.value, "us"),
      source: sourceLabel(h),
      "stations (15 km)": h.summary.freshCount,
      "station median": h.summary.median,
      "model US AQI": c.usAqi,
      "India NAQI": c.inAqi === null ? null : formatIndex(c.inAqi, "in"),
      "PM2.5 µg/m³ (model)": c.pollutants.pm2_5 === null ? null : r1(c.pollutants.pm2_5),
    },
  };
}

async function toolHistory(a: z.infer<typeof ARG_SCHEMAS.get_history>, d: AssistantDataLayer): Promise<ToolOutcome> {
  const series = await d.airSeries(a.lat, a.lon, Math.min(92, a.days * 2), 1);
  const now = d.now();
  const pts = series.points.filter((p) => Date.parse(p.time) <= now);
  if (pts.length === 0) return { ok: true, result: { status: "no_data", source: SOURCE }, summary: "No history returned", keyValues: {} };
  const tz = series.timezone;
  const hours = toLocalHours(
    pts.map((p) => ({ time: p.time, value: pointValue(p, a.scale), subs: pointSubs(p, a.scale) })),
    tz,
  );
  const endDate = localParts(pts[pts.length - 1].time, tz).date;
  const dates = datesEnding(endDate, a.days);
  const inRange = new Set(dates);
  const rangeHours = hours.filter((h) => inRange.has(h.date));
  const days = dailyStats(rangeHours);
  const profileHours = hourOfDayProfile(rangeHours);
  const change = periodChange(hours, endDate, a.days);
  const summary = periodSummary(hours, endDate, a.days);
  const bw = bestWorst(days);
  const peak = extremeHour(profileHours, "peak");
  const dt = dataTime(pts[pts.length - 1].time, tz);
  const scaleName = SCALE_NAME[a.scale];
  return {
    ok: true,
    result: {
      status: "ok",
      source: `${SOURCE} model history${a.scale === "in" ? " (NAQI computed by AirIQ from model concentrations)" : ""}`,
      scale: scaleName,
      timezone: tz,
      dataTime: dt,
      period: { from: dates[0], to: dates[dates.length - 1], days: a.days },
      average: { value: summary.mean === null ? null : r0(summary.mean), hoursCovered: summary.validHours, hoursExpected: summary.expectedHours },
      bestDay: bw.best ? { date: bw.best.date, mean: r0(bw.best.mean!), category: getCategory(bw.best.mean!, a.scale).label } : null,
      worstDay: bw.worst ? { date: bw.worst.date, mean: r0(bw.worst.mean!), category: getCategory(bw.worst.mean!, a.scale).label } : null,
      changeVsPreviousPeriod: change
        ? { currentMean: r0(change.current.mean!), previousMean: r0(change.previous.mean!), percentChange: r0(change.pctChange) }
        : null,
      typicalPeakHourLocal: peak ? { hour: formatHour(peak.hour), mean: r0(peak.mean!) } : null,
      daily: days.map((x) => ({
        date: x.date,
        mean: x.mean === null ? null : r0(x.mean),
        max: x.max === null ? null : r0(x.max),
        hoursCovered: x.validHours,
        partial: x.partial,
        mainPollutant: mainName(x.dominant),
      })),
      insights: buildInsights({ scale: a.scale, rangeDays: a.days, days, profile: profileHours, change }),
    },
    summary: `Fetched ${a.days}-day history for ${label(a.city, a.lat, a.lon)}, data up to ${dt.local} ${dt.zone}`,
    keyValues: {
      scale: scaleName,
      average: summary.mean === null ? null : r0(summary.mean),
      "worst day": bw.worst ? `${bw.worst.date} (${r0(bw.worst.mean!)})` : null,
      "change vs previous": change ? `${r0(change.pctChange)}%` : null,
    },
  };
}

async function toolForecast(a: z.infer<typeof ARG_SCHEMAS.get_forecast>, d: AssistantDataLayer): Promise<ToolOutcome> {
  const series = await d.airSeries(a.lat, a.lon, 0, 5);
  const now = d.now();
  const tz = series.timezone;
  let nowIdx = 0;
  series.points.forEach((p, i) => {
    if (Date.parse(p.time) <= now) nowIdx = i;
  });
  const pts = series.points.slice(nowIdx);
  const val = (p: (typeof pts)[number]) => pointValue(p, a.scale);
  const valid = pts.filter((p) => val(p) !== null);
  if (valid.length === 0) return { ok: true, result: { status: "no_data", source: SOURCE }, summary: "No forecast returned", keyValues: {} };
  const daily = dailyRanges(
    pts.map((p) => ({ time: p.time, value: val(p) })),
    tz,
  ).map((x) => ({ date: x.date, min: r0(x.min), mean: r0(x.mean), max: r0(x.max), hours: x.n }));
  const next48 = pts.slice(0, 48).map((p) => ({ localTime: localStamp(p.time, tz), aqi: val(p) }));
  const v48 = next48.filter((x) => x.aqi !== null) as { localTime: string; aqi: number }[];
  const peak = v48.reduce((m, x) => (x.aqi > m.aqi ? x : m), v48[0]);
  const low = v48.reduce((m, x) => (x.aqi < m.aqi ? x : m), v48[0]);
  const dt = dataTime(pts[0].time, tz);
  const scaleName = SCALE_NAME[a.scale];
  return {
    ok: true,
    result: {
      status: "ok",
      source: `${SOURCE} official forecast (model-based; it smooths local pollution and can under-estimate where ground stations read higher)`,
      scale: scaleName,
      timezone: tz,
      dataTime: dt,
      daily,
      next48h: next48,
      next48hHighest: peak ?? null,
      next48hLowest: low ?? null,
    },
    summary: `Fetched forecast for ${label(a.city, a.lat, a.lon)}, data as of ${dt.local} ${dt.zone}`,
    keyValues: { scale: scaleName, "next 48 h high": peak ? `${peak.aqi} (${peak.localTime})` : null, "next 48 h low": low ? `${low.aqi} (${low.localTime})` : null },
  };
}

async function toolCompare(a: z.infer<typeof ARG_SCHEMAS.compare_cities>, d: AssistantDataLayer): Promise<ToolOutcome> {
  const settled = await Promise.allSettled(a.cities.map((c) => headlineFor(d, c.lat, c.lon, "us", a.source)));
  const rows = a.cities.map((c, i) => {
    const s = settled[i];
    if (s.status !== "fulfilled") return { name: c.name, status: "error" as const, error: "data source unavailable" };
    const { air, h } = s.value;
    const cur = air.current;
    const dt = dataTime(cur.time, cur.timezone);
    return {
      name: c.name,
      status: "ok" as const,
      headlineUsAqi: h.value === null ? null : Math.round(h.value),
      headline: { ...indexValue(h.value, "us"), source: sourceLabel(h), observedLocal: h.observedAt ? localStamp(h.observedAt, cur.timezone) : null },
      stationCount: h.summary.freshCount,
      modelUsAqi: indexValue(cur.usAqi, "us"),
      usMainPollutant: mainName(cur.dominantUs),
      europeanAqi: indexValue(cur.euAqi, "eu"),
      // Both scales, explicitly: real Gemini once guessed the EU main pollutant when only the US one was returned.
      europeanMainPollutant: mainName(cur.dominantEu),
      indiaNaqi: { ...indexValue(cur.inAqi, "in"), mainPollutant: mainName(cur.dominantIn), basis: "model concentrations, computed by AirIQ" },
      timezone: cur.timezone,
      dataTime: dt,
    };
  });
  const ok = rows.filter((r): r is Extract<(typeof rows)[number], { status: "ok" }> => r.status === "ok" && r.headlineUsAqi !== null);
  ok.sort((x, y) => (x.headlineUsAqi as number) - (y.headlineUsAqi as number));
  const ranked = ok.map((r, i) => ({ rank: i + 1, ...r }));
  const failed = rows.filter((r) => r.status !== "ok" || r.headlineUsAqi === null).map((r) => ({ name: r.name, status: "error", error: "no reading" }));
  if (ranked.length === 0) return err("Comparison failed", "No city returned data.");
  return {
    ok: true,
    result: { status: "ok", source: `${SOURCE} model and ground stations (WAQI/OpenAQ)`, rankedCleanestFirst: ranked, unavailable: failed },
    summary: `Compared ${a.cities.map((c) => c.name.slice(0, 30)).join(", ")}, data as of ${ranked[0].dataTime.local} ${ranked[0].dataTime.zone}`,
    keyValues: Object.fromEntries(ranked.map((r) => [r.name.slice(0, 40), `US AQI ${r.headline.display} (${r.headline.category}; ${r.headline.source})`])),
  };
}

async function toolAdvice(a: z.infer<typeof ARG_SCHEMAS.get_health_advice>, d: AssistantDataLayer): Promise<ToolOutcome> {
  const { air, h } = await headlineFor(d, a.lat, a.lon, a.scale, a.source);
  const c = air.current;
  const aqi = h.value;
  if (aqi === null) {
    return {
      ok: true,
      result: { status: "no_data", source: SOURCE, note: a.scale === "in" ? (c.inReason ?? "NAQI could not be computed.") : "No current index value." },
      summary: "No current AQI for advice",
      keyValues: {},
    };
  }
  const adv = healthAdvice({
    aqi,
    scale: a.scale,
    dominant: a.scale === "us" ? c.dominantUs : a.scale === "eu" ? c.dominantEu : c.dominantIn,
    pollutants: c.pollutants,
    profile: a.profile,
    localHour: localParts(c.time, c.timezone).hour,
  });
  const dt = dataTime(c.time, c.timezone);
  const rec = (x: { text: string; basis: string }) => ({ text: x.text, basis: x.basis });
  return {
    ok: true,
    result: {
      status: "ok",
      source: `AirIQ rules engine on the headline in effect (${sourceLabel(h)})`,
      profile: PROFILES[a.profile].label,
      scale: SCALE_NAME[a.scale],
      aqi: Math.round(aqi),
      aqiDisplay: formatIndex(aqi, a.scale),
      beyondIndex: isBeyondIndex(aqi, a.scale),
      aqiSource: sourceLabel(h),
      aqiReason: h.reason,
      modelValue: h.modelValue === null ? null : Math.round(h.modelValue),
      stations: stationBlock(h, c.timezone),
      category: adv.category.label,
      timezone: c.timezone,
      dataTime: dt,
      headline: rec(adv.headline),
      outdoorActivity: adv.activity.map((g) => ({ activity: g.label, recommendations: g.items.map(rec) })),
      indoorAir: adv.indoor.map(rec),
      protection: adv.protection.map(rec),
      notes: adv.info.map(rec),
      why: adv.why,
      disclaimer: "General information, not medical advice.",
    },
    summary: `Health advice (${PROFILES[a.profile].label}) for ${label(a.city, a.lat, a.lon)} using ${sourceLabel(h)}, data as of ${dt.local} ${dt.zone}`,
    keyValues: { profile: PROFILES[a.profile].label, [SCALE_NAME[a.scale]]: formatIndex(aqi, a.scale), source: sourceLabel(h), category: adv.category.label, headline: adv.headline.text },
  };
}

async function toolWindows(a: z.infer<typeof ARG_SCHEMAS.find_safe_windows>, d: AssistantDataLayer): Promise<ToolOutcome> {
  const [series, sun, bundle] = await Promise.all([
    // One past day so the 24-hour NAQI means are defined from the first forecast hour.
    d.airSeries(a.lat, a.lon, a.scale === "in" ? 1 : 0, 3),
    d.sunTimes(a.lat, a.lon).catch(() => null),
    headlineFor(d, a.lat, a.lon, "us", a.source).catch(() => null),
  ]);
  const now = d.now();
  const threshold = PROFILES[a.profile].defaultThreshold[a.scale];
  const div = bundle?.h.divergence ?? null;
  const underEstimate =
    div !== null && div > 0.25
      ? `Nearby ground stations currently read ${Math.round(div * 100)}% higher than the model (US AQI), so this model forecast likely under-estimates.`
      : null;
  const res = findSafeWindows({
    points: series.points.map((p) => ({ time: p.time, value: pointValue(p, a.scale) })),
    threshold,
    timeZone: series.timezone,
    activity: a.activity,
    minHours: a.minHours,
    now,
    daylightOnly: a.activity === "exercise" && a.daylightOnly,
    sun,
  });
  const w = (x: { label: string; min: number; max: number; hours: number }) => ({ localTime: x.label, aqiMin: r0(x.min), aqiMax: r0(x.max), hours: x.hours });
  const dt = dataTime(new Date(Math.floor(now / 3600_000) * 3600_000).toISOString(), series.timezone);
  const scaleName = SCALE_NAME[a.scale];
  const base = {
    source: `${SOURCE} official forecast (model-based)`,
    forecastNote: underEstimate,
    scale: scaleName,
    threshold,
    thresholdRule: a.activity === "windows" ? "cleanest hours (no threshold)" : `${scaleName} at or below ${threshold} (${PROFILES[a.profile].label} profile)`,
    activity: a.activity,
    minHours: a.minHours,
    timezone: series.timezone,
    dataTime: dt,
  };
  const summaryTail = `for ${label(a.city, a.lat, a.lon)}, forecast as of ${dt.local} ${dt.zone}`;
  if (res.status === "no-data") return { ok: true, result: { status: "no_data", ...base }, summary: `No forecast ${summaryTail}`, keyValues: {} };
  if (res.status === "none") {
    return {
      ok: true,
      result: { status: "none", ...base, leastBadWindows: res.leastBad.map(w), note: "No window meets the threshold; these are only the least-bad times." },
      summary: `No safe window ${summaryTail}`,
      keyValues: { threshold, "least bad": res.leastBad[0] ? `${res.leastBad[0].label} (${r0(res.leastBad[0].min)}–${r0(res.leastBad[0].max)})` : null },
    };
  }
  return {
    ok: true,
    result: { status: "ok", ...base, windows: res.windows.map(w) },
    summary: `Found ${res.windows.length} window(s) ${summaryTail}`,
    keyValues: { threshold: a.activity === "windows" ? null : threshold, first: res.windows[0] ? `${res.windows[0].label} (${r0(res.windows[0].min)}–${r0(res.windows[0].max)})` : null },
  };
}

/**
 * Run one tool call. Never throws: invalid arguments and data-layer failures
 * become `{ status: "error" }` results for the model.
 */
export async function runTool(name: string, rawArgs: unknown, deps: AssistantDataLayer): Promise<ToolOutcome> {
  if (!(name in ARG_SCHEMAS)) return err(`Unknown tool ${name.slice(0, 40)}`, `Unknown tool "${name.slice(0, 40)}".`);
  const tool = name as ToolName;
  const parsed = ARG_SCHEMAS[tool].safeParse(rawArgs ?? {});
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "args"}: ${i.message}`).join("; ");
    return err(`Invalid arguments for ${tool}`, `invalid arguments: ${msg}`);
  }
  try {
    switch (tool) {
      case "resolve_city":
        return await toolResolveCity(parsed.data as z.infer<typeof ARG_SCHEMAS.resolve_city>, deps);
      case "get_current_aqi":
        return await toolCurrent(parsed.data as z.infer<typeof ARG_SCHEMAS.get_current_aqi>, deps);
      case "get_history":
        return await toolHistory(parsed.data as z.infer<typeof ARG_SCHEMAS.get_history>, deps);
      case "get_forecast":
        return await toolForecast(parsed.data as z.infer<typeof ARG_SCHEMAS.get_forecast>, deps);
      case "compare_cities":
        return await toolCompare(parsed.data as z.infer<typeof ARG_SCHEMAS.compare_cities>, deps);
      case "get_health_advice":
        return await toolAdvice(parsed.data as z.infer<typeof ARG_SCHEMAS.get_health_advice>, deps);
      case "find_safe_windows":
        return await toolWindows(parsed.data as z.infer<typeof ARG_SCHEMAS.find_safe_windows>, deps);
    }
  } catch {
    return err(`${tool} failed: data source unavailable`, "The data source is unavailable right now. Tell the user; do not guess values.");
  }
}
