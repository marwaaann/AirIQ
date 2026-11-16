/**
 * India NAQI from ground stations' own concentrations (OpenAQ v3, which
 * republishes CPCB's real-time station data).
 *
 * Per station:
 *  - PM2.5 and PM10: 24-hour means of the station's hourly values (the 24
 *    hours ending at its latest PM hour), at least 16 hours (CPCB's rule);
 *  - NO2, SO2, CO and O3: the station's LATEST hourly value (within the last
 *    3 hours). CPCB uses 24-hour (NO2, SO2) and 8-hour (CO, O3) means; AirIQ
 *    uses the latest hour for the gases to stay inside OpenAQ's free rate
 *    limit (one request per station instead of one per gas). This is labelled
 *    wherever the value is explained. In the cases this feature is for (PM
 *    episodes) the PM sub-index is the maximum and decides the NAQI;
 *  - CPCB's breakpoints and rules from lib/naqi.ts: the overall index needs
 *    sub-indices for at least 3 pollutants, one of them PM2.5 or PM10.
 * Gases reported in ppm/ppb are converted to µg/m³ at 25 °C.
 *
 * Across stations: the MEDIAN of the stations with enough data (≥ 3), else
 * the nearest station with enough data, else none.
 *
 * WAQI index values are NEVER used here: an AQI turned back into a
 * concentration is not a measurement. WAQI stations are matched to OpenAQ
 * stations by name/coordinates for display only.
 *
 * Pure module (relative imports only) so it runs under `node --test`.
 */

import { naqiAt, naqiFromAverages, NAQI_SHORT, type NaqiAverage, type NaqiHourly, type NaqiPollutant, type NaqiResult } from "./naqi.ts";

const PARAM: Record<string, NaqiPollutant> = {
  pm25: "pm2_5",
  "pm2.5": "pm2_5",
  pm10: "pm10",
  no2: "nitrogen_dioxide",
  so2: "sulphur_dioxide",
  o3: "ozone",
  co: "carbon_monoxide",
  nh3: "ammonia",
};

/** Pollutants AirIQ reads from a station: PM as 24-hour means, the gases as the latest hour. */
export const STATION_PM: readonly NaqiPollutant[] = ["pm2_5", "pm10"];
export const STATION_GASES: readonly NaqiPollutant[] = ["nitrogen_dioxide", "sulphur_dioxide", "carbon_monoxide", "ozone"];

/** g/mol, for ppm/ppb → µg/m³ at 25 °C, 1 atm (molar volume 24.45 L). */
const MW: Partial<Record<NaqiPollutant, number>> = {
  nitrogen_dioxide: 46.0055,
  sulphur_dioxide: 64.066,
  ozone: 48.0,
  carbon_monoxide: 28.01,
  ammonia: 17.031,
};

const HOUR = 3600_000;
/** A station's reading counts as current for 3 hours (same rule as the headline). */
export const STATION_NAQI_FRESH_HOURS = 3;
export const STATION_NAQI_RADIUS_KM = 15;
/** At most this many stations are queried per city (OpenAQ free rate limit). */
export const STATION_NAQI_MAX_STATIONS = 15;
export const STATION_NAQI_MIN_FOR_MEDIAN = 3;

export function naqiPollutantFor(parameterName: string): NaqiPollutant | null {
  return PARAM[parameterName.trim().toLowerCase()] ?? null;
}

/** Convert a reading to µg/m³ (CO stays in µg/m³ here). Null for unknown units or invalid values. */
export function toUgm3(p: NaqiPollutant, units: string, value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const u = units.trim().toLowerCase().replace("μ", "µ").replace(/\s+/g, "");
  if (u === "µg/m³" || u === "µg/m3" || u === "ug/m3" || u === "ug/m³") return value;
  if (u === "mg/m³" || u === "mg/m3") return value * 1000;
  const mw = MW[p];
  if (!mw) return null;
  if (u === "ppm") return (value * mw * 1000) / 24.45;
  if (u === "ppb") return (value * mw) / 24.45;
  return null;
}

export interface SensorHours {
  /** OpenAQ parameter name, e.g. "pm25". */
  parameter: string;
  units: string;
  /** Hour-ending UTC ISO times and values. */
  hours: readonly { time: string; value: number }[];
}

export interface LatestReading {
  parameter: string;
  units: string;
  value: number;
  /** UTC ISO time of the reading. */
  time: string;
}

export interface StationNaqiResult {
  result: NaqiResult;
  /** End of the latest hour used (UTC ISO), or null when there are no readings. */
  observedAt: string | null;
}

/** Hourly series of the given sensors aligned to the 24 hours ending at their latest hour. */
function alignHours(sensors: readonly SensorHours[], only?: readonly NaqiPollutant[]): { series: NaqiHourly; latest: number | null } {
  let latest = -Infinity;
  const parsed: { p: NaqiPollutant; hours: { t: number; v: number }[] }[] = [];
  for (const s of sensors) {
    const p = naqiPollutantFor(s.parameter);
    if (!p || (only && !only.includes(p))) continue;
    const hours: { t: number; v: number }[] = [];
    for (const h of s.hours) {
      const t = Math.floor(Date.parse(h.time) / HOUR) * HOUR;
      const v = toUgm3(p, s.units, h.value);
      if (!Number.isFinite(t) || v === null) continue;
      hours.push({ t, v });
      if (t > latest) latest = t;
    }
    if (hours.length) parsed.push({ p, hours });
  }
  if (!Number.isFinite(latest)) return { series: {}, latest: null };
  const series: NaqiHourly = {};
  for (const { p, hours } of parsed) {
    const arr: (number | null)[] = Array.from({ length: 24 }, () => null);
    for (const { t, v } of hours) {
      const k = 23 - Math.round((latest - t) / HOUR);
      if (k >= 0 && k < 24) arr[k] = v;
    }
    series[p] = arr;
  }
  return { series, latest };
}

/** NAQI over the 24 hours ending at the latest reading, every pollutant from hourly data (CPCB's averaging). */
export function naqiFromSensorHours(sensors: readonly SensorHours[]): StationNaqiResult {
  const { series, latest } = alignHours(sensors);
  if (latest === null) return { result: naqiAt({}, 0), observedAt: null };
  return { result: naqiAt(series, 23), observedAt: new Date(latest).toISOString() };
}

export type ConcentrationBasis = "24h-mean" | "latest-hour";

export interface StationConcentration {
  /** µg/m³, or mg/m³ for CO (CPCB's unit). */
  value: number;
  unit: "µg/m³" | "mg/m³";
  basis: ConcentrationBasis;
  /** Hours with data (24-hour means), 1 for the latest hour. */
  hours: number;
  /** UTC ISO of the latest hour used. */
  at: string;
  subIndex: number | null;
}

export interface StationNaqiComputed {
  /** NAQI (may exceed 500), or null when CPCB's minimum-data rules are not met. */
  value: number | null;
  dominant: NaqiPollutant | null;
  status: "ok" | "insufficient";
  reason: string | null;
  /** UTC ISO end of the latest PM hour used (the station's observation time), or null. */
  observedAt: string | null;
  concentrations: Partial<Record<NaqiPollutant, StationConcentration>>;
}

const isCurrent = (t: number, now: number) => Number.isFinite(t) && now - t <= STATION_NAQI_FRESH_HOURS * HOUR && t - now <= HOUR;

/**
 * One station's NAQI: PM2.5/PM10 24-hour means from `pmHours`, the gases from
 * their latest hourly values in `latest` (only readings from the last 3 hours).
 */
export function naqiForStation(pmHours: readonly SensorHours[], latest: readonly LatestReading[], now: number): StationNaqiComputed {
  const { series, latest: pmLatest } = alignHours(pmHours, STATION_PM);
  const averages: Partial<Record<NaqiPollutant, NaqiAverage>> = {};
  const concentrations: Partial<Record<NaqiPollutant, StationConcentration>> = {};
  const observedAt = pmLatest === null ? null : new Date(pmLatest).toISOString();

  if (pmLatest !== null) {
    const pmResult = naqiAt(series, 23);
    for (const p of STATION_PM) {
      const a = pmResult.averages[p];
      if (!a) continue;
      averages[p] = a;
      concentrations[p] = { value: a.value, unit: "µg/m³", basis: "24h-mean", hours: a.hours, at: observedAt as string, subIndex: pmResult.subIndices[p] ?? null };
    }
  }

  // Latest value per gas (the most recent reading if a parameter appears twice).
  const byGas = new Map<NaqiPollutant, { v: number; t: number }>();
  for (const r of latest) {
    const p = naqiPollutantFor(r.parameter);
    if (!p || !STATION_GASES.includes(p)) continue;
    const t = Date.parse(r.time);
    const v = toUgm3(p, r.units, r.value);
    if (v === null || !isCurrent(t, now)) continue;
    const prev = byGas.get(p);
    if (!prev || t > prev.t) byGas.set(p, { v, t });
  }
  for (const [p, { v }] of byGas) {
    const value = p === "carbon_monoxide" ? v / 1000 : v;
    averages[p] = { value, hours: 1, window: p === "carbon_monoxide" || p === "ozone" ? 8 : 24 };
  }

  const result = naqiFromAverages(averages);
  for (const [p, { t }] of byGas) {
    const a = averages[p] as NaqiAverage;
    concentrations[p] = {
      value: a.value,
      unit: p === "carbon_monoxide" ? "mg/m³" : "µg/m³",
      basis: "latest-hour",
      hours: 1,
      at: new Date(t).toISOString(),
      subIndex: result.subIndices[p] ?? null,
    };
  }

  if (observedAt === null || !isCurrent(Date.parse(observedAt), now)) {
    return {
      value: null,
      dominant: null,
      status: "insufficient",
      reason: observedAt === null ? "No PM2.5 or PM10 readings in the last 24 hours." : `Latest PM reading is older than ${STATION_NAQI_FRESH_HOURS} hours.`,
      observedAt,
      concentrations,
    };
  }
  return { value: result.aqi, dominant: result.dominant, status: result.status, reason: result.reason, observedAt, concentrations };
}

/* ------------------------------------------------------------------------- */
/* Across stations                                                            */
/* ------------------------------------------------------------------------- */

export interface StationNaqiStation extends StationNaqiComputed {
  id: string;
  name: string;
  /** Data provider as OpenAQ reports it (e.g. "CPCB"), or null. */
  provider: string | null;
  /** True for CPCB-sourced stations, which are preferred. */
  cpcb: boolean;
  latitude: number;
  longitude: number;
  distanceKm: number;
  url: string;
  /** Gas readings left out and why (e.g. untrusted unit labels). */
  skipped?: string[];
  /** True when the station's data could not be fetched (rate limit, network), as opposed to lacking data. */
  fetchFailed?: boolean;
}

export interface StationNaqiRef {
  id: string;
  name: string;
  value: number;
  dominant: NaqiPollutant | null;
  distanceKm: number;
  observedAt: string;
}

export type StationNaqiStatus = "ok" | "none" | "not-configured" | "error";

/** What the headline needs from station-based NAQI. */
export interface StationNaqiSummary {
  status: StationNaqiStatus;
  /** "median" (≥ 3 stations with enough data) or "nearest" (fewer); null when none qualifies. */
  method: "median" | "nearest" | null;
  /** The station-based NAQI: the median, or the nearest station's value. */
  value: number | null;
  /** Stations with enough current data. */
  count: number;
  /** Stations queried. */
  checked: number;
  median: number | null;
  nearest: StationNaqiRef | null;
  highest: StationNaqiRef | null;
  latestObservedAt: string | null;
  /** Plain-language reason when status is not "ok". */
  note: string | null;
}

export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const toRef = (s: StationNaqiStation): StationNaqiRef => ({
  id: s.id,
  name: s.name,
  value: s.value as number,
  dominant: s.dominant,
  distanceKm: s.distanceKm,
  observedAt: s.observedAt as string,
});

/** Stations with enough current data: status ok, a value and an observation within the last 3 hours. */
export function usableStations(stations: readonly StationNaqiStation[], now: number): StationNaqiStation[] {
  return stations.filter((s) => s.status === "ok" && s.value !== null && s.observedAt !== null && isCurrent(Date.parse(s.observedAt), now));
}

export function summarizeStationNaqi(stations: readonly StationNaqiStation[], now: number): StationNaqiSummary {
  const ok = usableStations(stations, now).sort((a, b) => a.distanceKm - b.distanceKm);
  const empty = { median: null, nearest: null, highest: null, latestObservedAt: null };
  // Requests that failed say nothing about the stations' data. Without enough usable stations
  // for a median, don't report "none has enough data" or let one station stand in for the city.
  const failed = stations.filter((s) => s.fetchFailed);
  if (failed.length > 0 && ok.length < STATION_NAQI_MIN_FOR_MEDIAN) {
    const detail = failed[0].reason?.replace(/^OpenAQ:\s*/, "") ?? "request failed";
    const note = `Station data could not be fetched from OpenAQ for ${failed.length} of ${stations.length} station${stations.length === 1 ? "" : "s"} (${detail}); station-based NAQI is temporarily unavailable.`;
    return { status: "error", method: null, value: null, count: ok.length, checked: stations.length, ...empty, note };
  }
  if (ok.length === 0) {
    const note =
      stations.length === 0
        ? `No OpenAQ station with PM2.5 or PM10 has reported within ${STATION_NAQI_RADIUS_KM} km in the last ${STATION_NAQI_FRESH_HOURS} hours.`
        : `${stations.length} station${stations.length === 1 ? "" : "s"} within ${STATION_NAQI_RADIUS_KM} km checked; none has enough data (PM2.5 or PM10 for 16 of the last 24 hours, and 3 pollutants).`;
    return { status: "none", method: null, value: null, count: 0, checked: stations.length, ...empty, note };
  }
  const highest = ok.reduce((m, s) => ((s.value as number) > (m.value as number) ? s : m), ok[0]);
  const latest = ok.reduce((m, s) => (Date.parse(s.observedAt as string) > Date.parse(m) ? (s.observedAt as string) : m), ok[0].observedAt as string);
  const med = medianOf(ok.map((s) => s.value as number));
  const median = med === null ? null : Math.round(med);
  const useMedian = ok.length >= STATION_NAQI_MIN_FOR_MEDIAN;
  return {
    status: "ok",
    method: useMedian ? "median" : "nearest",
    value: useMedian ? median : (ok[0].value as number),
    count: ok.length,
    checked: stations.length,
    median,
    nearest: toRef(ok[0]),
    highest: toRef(highest),
    latestObservedAt: latest,
    note: null,
  };
}

/* ------------------------------------------------------------------------- */
/* Choosing and matching stations                                             */
/* ------------------------------------------------------------------------- */

export interface StationCandidate {
  id: number;
  name: string;
  provider: string | null;
  isMonitor: boolean | null;
  latitude: number;
  longitude: number;
  distanceKm: number;
  /** UTC ISO of the location's latest reading. */
  lastSeen: string | null;
  /** PM2.5 and PM10 sensor ids (µg/m³). */
  pmSensors: { id: number; parameter: string; units: string }[];
}

export const isCpcbProvider = (provider: string | null | undefined): boolean => !!provider && /\bcpcb\b|central pollution control board/i.test(provider);

/**
 * Which stations to query: reported in the last 3 hours, within the radius,
 * with a PM2.5 or PM10 sensor. CPCB-sourced stations first, then other
 * reference monitors, then the rest; nearest first within each group; capped.
 */
export function chooseStations(cands: readonly StationCandidate[], now: number, max = STATION_NAQI_MAX_STATIONS, radiusKm = STATION_NAQI_RADIUS_KM): StationCandidate[] {
  const group = (c: StationCandidate) => (isCpcbProvider(c.provider) ? 0 : c.isMonitor === false ? 2 : 1);
  return cands
    .filter((c) => c.distanceKm <= radiusKm && c.pmSensors.length > 0 && c.lastSeen !== null && isCurrent(Date.parse(c.lastSeen), now))
    .sort((a, b) => group(a) - group(b) || a.distanceKm - b.distanceKm)
    .slice(0, max);
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(cpcb|dpcc|imd|iitm|hspcb|upppcb|uppcb|rspcb|delhi|india|haryana|uttar pradesh|new|-)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Words of a station name that identify it (place words, not network or city names). */
export function nameTokens(name: string): Set<string> {
  return new Set(
    norm(name)
      .split(" ")
      .filter((w) => w.length >= 3),
  );
}

export interface MatchCandidate {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  aqi: number;
  observedAt: string | null;
}

/**
 * The WAQI station that is the same physical site as an OpenAQ station, for
 * DISPLAY only (side by side, never mixed): within 0.5 km, or within 3 km with
 * a shared distinctive name word ("Anand Vihar", "Wazirpur"). Nearest wins.
 */
export function matchStation<T extends MatchCandidate>(s: { name: string; latitude: number; longitude: number }, others: readonly T[], km: (aLat: number, aLon: number, bLat: number, bLon: number) => number): T | null {
  const mine = nameTokens(s.name);
  let best: { o: T; d: number } | null = null;
  for (const o of others) {
    const d = km(s.latitude, s.longitude, o.latitude, o.longitude);
    const shared = [...nameTokens(o.name)].some((w) => mine.has(w));
    if (d <= 0.5 || (d <= 3 && shared)) {
      if (!best || d < best.d) best = { o, d };
    }
  }
  return best?.o ?? null;
}

/** "PM2.5 24 h mean 180 µg/m³ (22 h)", "NO₂ latest hour 64 µg/m³". */
export function describeConcentration(p: NaqiPollutant, c: StationConcentration): string {
  const v = c.unit === "mg/m³" ? c.value.toFixed(2) : String(Math.round(c.value));
  return c.basis === "24h-mean" ? `${NAQI_SHORT[p]} 24 h mean ${v} ${c.unit} (${c.hours} h)` : `${NAQI_SHORT[p]} latest hour ${v} ${c.unit}`;
}
