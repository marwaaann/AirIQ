/**
 * Assistant tools. Each tool validates its arguments with Zod, calls the data
 * layer (injected, so tests can mock it), and returns a COMPACT JSON object
 * with values, units, local times, the time zone, the source and the data
 * timestamp. Failures and bad arguments return `{ status: "error" }` objects
 * to the model instead of throwing.
 *
 * Pure module (relative imports only) so it runs under `node --test`.
 */

import { z } from "zod";

import { POLLUTANT_INFO, POLLUTANT_ORDER, getCategory, type PollutantKey } from "../aqi-categories.ts";
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
import type { AirResponse } from "../../types/api.ts";

export const SOURCE = "Open-Meteo / CAMS";

/** Everything the tools need from the outside world. */
export interface AssistantDataLayer {
  geocode(query: string, count: number): Promise<GeoLocation[]>;
  currentAir(lat: number, lon: number): Promise<AirResponse>;
  airSeries(lat: number, lon: number, pastDays: number, forecastDays: number): Promise<AirSeries>;
  sunTimes(lat: number, lon: number): Promise<{ sunrise: string; sunset: string }[] | null>;
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

/* ------------------------------------------------------------------------- */
/* Argument schemas                                                           */
/* ------------------------------------------------------------------------- */

const lat = z.number().min(-90).max(90);
const lon = z.number().min(-180).max(180);
const scale = z.enum(["us", "eu"]).default("us");
const cityLabel = z.string().max(120).optional();
const profile = z.enum(PROFILE_IDS).default("general");

export const ARG_SCHEMAS = {
  resolve_city: z.object({ query: z.string().trim().min(2).max(100) }),
  get_current_aqi: z.object({ lat, lon, city: cityLabel }),
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
  }),
  get_health_advice: z.object({ lat, lon, profile, scale, city: cityLabel }),
  find_safe_windows: z.object({
    lat,
    lon,
    profile,
    activity: z.enum(["walk", "exercise", "windows"]).default("walk"),
    minHours: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(2),
    scale,
    daylightOnly: z.boolean().default(false),
    city: cityLabel,
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
const SCALE = { type: "string", enum: ["us", "eu"], description: "AQI scale: 'us' (US EPA) or 'eu' (European AQI). Default 'us'." } as const;
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
      "Current air quality at a location: US AQI and European AQI with categories, the main pollutant on each scale, PM2.5/PM10/NO2/SO2/O3/CO in µg/m³ with WHO guideline values, and the data time in the city's local time.",
    parametersJsonSchema: { type: "object", properties: { ...LATLON }, required: ["lat", "lon"] },
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
      "Compare the current air quality of 2–4 already-resolved cities. Returns each city's US AQI, category and main pollutant, and European AQI, category and main pollutant, ranked from cleanest to most polluted (by US AQI).",
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
      },
      required: ["cities"],
    },
  },
  {
    name: "get_health_advice",
    description:
      "Rule-based health guidance for the current air quality and a health profile (US EPA AirNow / EEA guidance). Returns a headline and recommendations for outdoor activity, indoor air and protection, each with its source ('basis'), plus why it applies.",
    parametersJsonSchema: { type: "object", properties: { ...LATLON, profile: PROFILE, scale: SCALE }, required: ["lat", "lon"] },
  },
  {
    name: "find_safe_windows",
    description:
      "Find times in the next 48 h of the OFFICIAL forecast when AQI stays at or below the profile's threshold, for walking, exercise, or opening windows (cleanest hours). Returns local time windows with AQI ranges, or the least-bad times if none qualify.",
    parametersJsonSchema: {
      type: "object",
      properties: {
        ...LATLON,
        profile: PROFILE,
        activity: { type: "string", enum: ["walk", "exercise", "windows"], description: "Default 'walk'." },
        minHours: { type: "integer", enum: [1, 2, 3], description: "Minimum window length in hours. Default 2." },
        scale: SCALE,
        daylightOnly: { type: "boolean", description: "Exercise only: keep daylight hours. Default false." },
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
  const air = await d.currentAir(a.lat, a.lon);
  const c = air.current;
  const dt = dataTime(c.time, c.timezone);
  return {
    ok: true,
    result: {
      status: "ok",
      source: SOURCE,
      timezone: c.timezone,
      dataTime: dt,
      usAqi: { value: c.usAqi, category: c.usAqi === null ? null : getCategory(c.usAqi, "us").label, mainPollutant: mainName(c.dominantUs) },
      europeanAqi: { value: c.euAqi, category: c.euAqi === null ? null : getCategory(c.euAqi, "eu").label, mainPollutant: mainName(c.dominantEu) },
      pollutants: pollutantTable(c.pollutants),
    },
    summary: `Fetched current AQI for ${label(a.city, a.lat, a.lon)}, data as of ${dt.local} ${dt.zone}`,
    keyValues: { "US AQI": c.usAqi, "European AQI": c.euAqi, "main pollutant": mainName(c.dominantUs), "PM2.5 µg/m³": c.pollutants.pm2_5 === null ? null : r1(c.pollutants.pm2_5) },
  };
}

async function toolHistory(a: z.infer<typeof ARG_SCHEMAS.get_history>, d: AssistantDataLayer): Promise<ToolOutcome> {
  const series = await d.airSeries(a.lat, a.lon, Math.min(92, a.days * 2), 1);
  const now = d.now();
  const pts = series.points.filter((p) => Date.parse(p.time) <= now);
  if (pts.length === 0) return { ok: true, result: { status: "no_data", source: SOURCE }, summary: "No history returned", keyValues: {} };
  const tz = series.timezone;
  const hours = toLocalHours(
    pts.map((p) => ({ time: p.time, value: a.scale === "us" ? p.usAqi : p.euAqi, subs: a.scale === "us" ? p.usSubIndices : p.euSubIndices })),
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
  const scaleName = a.scale === "us" ? "US AQI" : "European AQI";
  return {
    ok: true,
    result: {
      status: "ok",
      source: SOURCE,
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
  const val = (p: (typeof pts)[number]) => (a.scale === "us" ? p.usAqi : p.euAqi);
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
  const scaleName = a.scale === "us" ? "US AQI" : "European AQI";
  return {
    ok: true,
    result: {
      status: "ok",
      source: `${SOURCE} official forecast`,
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
  const settled = await Promise.allSettled(a.cities.map((c) => d.currentAir(c.lat, c.lon)));
  const rows = a.cities.map((c, i) => {
    const s = settled[i];
    if (s.status !== "fulfilled") return { name: c.name, status: "error" as const, error: "data source unavailable" };
    const cur = s.value.current;
    const dt = dataTime(cur.time, cur.timezone);
    return {
      name: c.name,
      status: "ok" as const,
      usAqi: cur.usAqi,
      usCategory: cur.usAqi === null ? null : getCategory(cur.usAqi, "us").label,
      usMainPollutant: mainName(cur.dominantUs),
      europeanAqi: cur.euAqi,
      europeanCategory: cur.euAqi === null ? null : getCategory(cur.euAqi, "eu").label,
      // Both scales, explicitly: real Gemini once guessed the EU main pollutant when only the US one was returned.
      europeanMainPollutant: mainName(cur.dominantEu),
      timezone: cur.timezone,
      dataTime: dt,
    };
  });
  const ok = rows.filter((r): r is Extract<(typeof rows)[number], { status: "ok" }> => r.status === "ok" && r.usAqi !== null);
  ok.sort((x, y) => (x.usAqi as number) - (y.usAqi as number));
  const ranked = ok.map((r, i) => ({ rank: i + 1, ...r }));
  const failed = rows.filter((r) => r.status !== "ok" || r.usAqi === null).map((r) => ({ name: r.name, status: "error", error: "no reading" }));
  if (ranked.length === 0) return err("Comparison failed", "No city returned data.");
  return {
    ok: true,
    result: { status: "ok", source: SOURCE, rankedCleanestFirst: ranked, unavailable: failed },
    summary: `Compared ${a.cities.map((c) => c.name.slice(0, 30)).join(", ")}, data as of ${ranked[0].dataTime.local} ${ranked[0].dataTime.zone}`,
    keyValues: Object.fromEntries(ranked.map((r) => [r.name.slice(0, 40), `US AQI ${r.usAqi} (${r.usCategory})`])),
  };
}

async function toolAdvice(a: z.infer<typeof ARG_SCHEMAS.get_health_advice>, d: AssistantDataLayer): Promise<ToolOutcome> {
  const air = await d.currentAir(a.lat, a.lon);
  const c = air.current;
  const aqi = a.scale === "us" ? c.usAqi : c.euAqi;
  if (aqi === null) return { ok: true, result: { status: "no_data", source: SOURCE }, summary: "No current AQI for advice", keyValues: {} };
  const adv = healthAdvice({
    aqi,
    scale: a.scale,
    dominant: a.scale === "us" ? c.dominantUs : c.dominantEu,
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
      source: `AirIQ rules engine on ${SOURCE} data`,
      profile: PROFILES[a.profile].label,
      scale: a.scale === "us" ? "US AQI" : "European AQI",
      aqi,
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
    summary: `Health advice (${PROFILES[a.profile].label}) for ${label(a.city, a.lat, a.lon)}, data as of ${dt.local} ${dt.zone}`,
    keyValues: { profile: PROFILES[a.profile].label, aqi, category: adv.category.label, headline: adv.headline.text },
  };
}

async function toolWindows(a: z.infer<typeof ARG_SCHEMAS.find_safe_windows>, d: AssistantDataLayer): Promise<ToolOutcome> {
  const [series, sun] = await Promise.all([d.airSeries(a.lat, a.lon, 0, 3), d.sunTimes(a.lat, a.lon).catch(() => null)]);
  const now = d.now();
  const threshold = PROFILES[a.profile].defaultThreshold[a.scale];
  const res = findSafeWindows({
    points: series.points.map((p) => ({ time: p.time, value: a.scale === "us" ? p.usAqi : p.euAqi })),
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
  const scaleName = a.scale === "us" ? "US AQI" : "European AQI";
  const base = {
    source: `${SOURCE} official forecast`,
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
