/**
 * Station-first headline selection.
 *
 * The model grid (Open-Meteo / CAMS, ~10–40 km cells) smooths out local
 * pollution, so where ground stations exist AirIQ prefers them:
 *
 *   Auto (default):
 *     1. ≥ 3 fresh stations (observed in the last 3 h) within 15 km → the MEDIAN
 *        of their AQI, plus the highest station and the count;
 *     2. else one fresh station within 10 km → that station;
 *     3. else the model.
 *   Nearest station: the nearest fresh station within 15 km, else the model.
 *   Model only: always the model (station figures are still summarised).
 *
 * Station networks (WAQI) report the US AQI only. Their values are never
 * converted to another scale, so:
 *   - European AQI: always the model;
 *   - India NAQI: computed by AirIQ from station CONCENTRATIONS (OpenAQ, see
 *     lib/station-naqi.ts) with the same rules: median of ≥ 3 stations with
 *     enough data, else the nearest one. When stations drive the US headline
 *     but no station-based NAQI exists, the NAQI is shown as "unavailable"
 *     with the model value only as a secondary "model estimate", never as an
 *     equal peer of the station figure (Phase 9b: the model's smoothed
 *     concentrations gave Delhi NAQI 188 "Moderately polluted" while the
 *     stations read US AQI 248).
 *   - Consistency check: when a model NAQI is shown and it is more than one
 *     NAQI category below what the stations' US AQI implies, a warning says so.
 *
 * Older readings: the 3-hour rule decides the headline, but when the nearest
 * station within 10 km last reported 3–12 hours ago its reading is returned
 * as a labelled secondary line (never the headline).
 *
 * Pure module (relative imports only) so it runs under `node --test`.
 */

import { PM25_2024 } from "./aqi.ts";
import { getInCategory, IN_CATEGORIES, type ScaleKey } from "./aqi-categories.ts";
import { naqiSubIndex } from "./naqi.ts";
import type { StationNaqiRef, StationNaqiSummary } from "./station-naqi.ts";

export type { StationNaqiSummary } from "./station-naqi.ts";

export const DATA_SOURCE_MODES = ["auto", "station", "model"] as const;
export type DataSourceMode = (typeof DATA_SOURCE_MODES)[number];

export const DATA_SOURCE_LABEL: Record<DataSourceMode, string> = { auto: "Auto", station: "Nearest station", model: "Model only" };

export const HEADLINE_RADIUS_KM = 15;
export const SINGLE_STATION_KM = 10;
export const FRESH_HOURS = 3;
/** Older readings up to this age are shown as a secondary line; older ones only in the stations list. */
export const OLDER_READING_MAX_HOURS = 12;
export const MIN_STATIONS_FOR_MEDIAN = 3;
/** Station vs model difference (relative to the model) above which the UI explains the gap. */
export const DIVERGENCE_THRESHOLD = 0.25;
/** A model NAQI more than this many categories below the stations' implied category triggers the warning. */
export const NAQI_CONSISTENCY_CATEGORIES = 1;

export type StationNetwork = "waqi" | "openaq";

export interface NearbyStation {
  id: string;
  name: string;
  source: StationNetwork;
  /** US AQI as reported (WAQI) or computed from the latest PM2.5 (OpenAQ). */
  aqi: number;
  aqiBasis: "reported" | "pm25-latest";
  latitude: number;
  longitude: number;
  distanceKm: number;
  /** ISO time of the observation, or null when the feed gives none. */
  observedAt: string | null;
  url?: string;
}

export type StationFeedStatus = "ok" | "not-configured" | "error" | "loading";

export interface StationRef {
  id: string;
  name: string;
  /** Index value (US AQI for WAQI stations; NAQI for station-based NAQI). */
  value: number;
  distanceKm: number;
  observedAt: string | null;
  source: StationNetwork;
}

export interface StationSummary {
  /** Fresh stations (≤ 3 h old) within 15 km. */
  freshCount: number;
  /** Median US AQI of those stations (null when there are none). */
  median: number | null;
  highest: StationRef | null;
  nearest: StationRef | null;
  latestObservedAt: string | null;
}

/** The nearest station's last reading when it is 3–12 hours old (secondary line, never the headline). */
export interface OlderReading {
  id: string;
  name: string;
  distanceKm: number;
  /** US AQI as reported. */
  value: number;
  observedAt: string;
  ageHours: number;
  /** US AQI it is compared with: the headline on the US scale, else the model's US AQI. */
  reference: number | null;
  /** More than 25% above the reference: the model may under-estimate current pollution. */
  aboveReference: boolean;
}

export interface HeadlineInput {
  scale: ScaleKey;
  mode: DataSourceMode;
  now: number;
  model: {
    /** Model index on the active scale. */
    value: number | null;
    /** Model US AQI (for the station comparison on every scale). */
    usAqi: number | null;
    time: string;
  };
  stations: readonly NearbyStation[];
  stationStatus: StationFeedStatus;
  /**
   * Station-based India NAQI (OpenAQ concentrations). `undefined`/null while
   * loading or not requested; a summary with status "none"/"error"/
   * "not-configured" when unavailable.
   */
  stationNaqi?: StationNaqiSummary | null;
}

/** "unavailable": India NAQI only, stations drive the headline but station-based NAQI is missing. */
export type HeadlineSourceKind = "stations-median" | "station" | "model" | "unavailable";

/** India NAQI only: where the value comes from. */
export type NaqiBasis = "stations" | "model" | "unavailable";

export interface HeadlineSource {
  source: HeadlineSourceKind;
  /** Headline index on `scale` (may exceed the index top: beyond index). Null when unavailable. */
  value: number | null;
  scale: ScaleKey;
  mode: DataSourceMode;
  stationCount: number;
  highest: StationRef | null;
  nearest: StationRef | null;
  /** Observation time of the headline (latest station used, or the model hour). */
  observedAt: string | null;
  /** Model value on the active scale (the secondary "model estimate" when the NAQI is unavailable). */
  modelValue: number | null;
  /** One line saying how the headline was chosen. */
  reason: string;
  /** US AQI station summary (WAQI), on every scale. */
  summary: StationSummary;
  /** (station − model) / model on the US AQI, using the median (≥ 3 stations) or the nearest station. */
  divergence: number | null;
  showDivergenceNote: boolean;
  /** Visible note when station data could not be used (null when stations drive the headline). */
  stationNote: string | null;
  /** The US AQI the stations give under this mode (median / nearest), or null. Used for advice when the NAQI is unavailable. */
  stationUsAqi: number | null;
  /** India NAQI: stations, model or unavailable; null on the other scales. */
  naqiBasis: NaqiBasis | null;
  /** Station-based NAQI summary as received (India NAQI only). */
  stationNaqi: StationNaqiSummary | null;
  /** True while the station-based NAQI is still loading. */
  naqiPending: boolean;
  /** A shown model NAQI is more than one category below what the station US AQI implies. */
  consistencyWarning: string | null;
  olderReading: OlderReading | null;
}

const HOUR = 3600_000;

/** Fresh = observed within the last 3 h (and not more than 1 h in the future, which would be a bad clock). */
export function isFresh(observedAt: string | null, now: number): boolean {
  if (!observedAt) return false;
  const t = Date.parse(observedAt);
  return Number.isFinite(t) && now - t <= FRESH_HOURS * HOUR && t - now <= HOUR;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const ref = (s: NearbyStation): StationRef => ({ id: s.id, name: s.name, value: s.aqi, distanceKm: s.distanceKm, observedAt: s.observedAt, source: s.source });
const naqiRef = (s: StationNaqiRef): StationRef => ({ id: s.id, name: s.name, value: s.value, distanceKm: s.distanceKm, observedAt: s.observedAt, source: "openaq" });

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function summarizeStations(stations: readonly NearbyStation[], now: number, radiusKm = HEADLINE_RADIUS_KM): StationSummary {
  const fresh = stations.filter((s) => s.distanceKm <= radiusKm && Number.isFinite(s.aqi) && isFresh(s.observedAt, now));
  if (fresh.length === 0) return { freshCount: 0, median: null, highest: null, nearest: null, latestObservedAt: null };
  const byDistance = [...fresh].sort((a, b) => a.distanceKm - b.distanceKm);
  const highest = fresh.reduce((m, s) => (s.aqi > m.aqi || (s.aqi === m.aqi && s.distanceKm < m.distanceKm) ? s : m), fresh[0]);
  const latest = fresh.reduce<string | null>((m, s) => (s.observedAt && (!m || Date.parse(s.observedAt) > Date.parse(m)) ? s.observedAt : m), null);
  const med = median(fresh.map((s) => s.aqi));
  return { freshCount: fresh.length, median: med === null ? null : Math.round(med), highest: ref(highest), nearest: ref(byDistance[0]), latestObservedAt: latest };
}

const km = (d: number) => (d < 1 ? "<1 km" : `${Math.round(d)} km`);

/**
 * The US AQI the stations give under `mode` (what the US headline would use):
 * Auto → median of ≥ 3 fresh stations, else the nearest within 10 km;
 * Nearest station → the nearest fresh station within 15 km; Model only → null.
 */
export function stationUsFigure(summary: StationSummary, mode: DataSourceMode): number | null {
  if (mode === "model") return null;
  if (mode === "station") return summary.nearest?.value ?? null;
  if (summary.freshCount >= MIN_STATIONS_FOR_MEDIAN && summary.median !== null) return summary.median;
  return summary.nearest && summary.nearest.distanceKm <= SINGLE_STATION_KM ? summary.nearest.value : null;
}

/* ------------------------------------------------------------------------- */
/* NAQI consistency check                                                     */
/* ------------------------------------------------------------------------- */

/**
 * The PM2.5 concentration (µg/m³) at which the US AQI (EPA 2024 table) equals
 * `usAqi`: the inverse of the PM2.5 sub-index. Used ONLY to compare
 * categories, never shown as a value or used as a reading.
 */
export function pm25ForUsAqi(usAqi: number): number | null {
  if (!Number.isFinite(usAqi) || usAqi < 0) return null;
  const top = PM25_2024[PM25_2024.length - 1];
  const band = PM25_2024.find((b) => usAqi <= b.iHigh) ?? top;
  const lo = usAqi < band.iLow ? band.iLow : usAqi;
  return band.cLow + ((lo - band.iLow) * (band.cHigh - band.cLow)) / (band.iHigh - band.iLow);
}

/**
 * The NAQI category rank (0 Good … 5 Severe) that a station US AQI implies,
 * assuming PM2.5 is the pollutant behind it (the case in Indian PM episodes,
 * where this check matters). Null for invalid input.
 */
export function impliedNaqiRank(usAqi: number): number | null {
  const c = pm25ForUsAqi(usAqi);
  if (c === null) return null;
  const sub = naqiSubIndex("pm2_5", c);
  return sub === null ? null : getInCategory(sub).rank;
}

export interface NaqiConsistency {
  modelRank: number;
  impliedRank: number;
  /** Model NAQI is more than one category below the implied category. */
  warn: boolean;
}

export function naqiConsistency(modelNaqi: number | null, stationUsAqi: number | null): NaqiConsistency | null {
  if (modelNaqi === null || stationUsAqi === null || !Number.isFinite(modelNaqi)) return null;
  const impliedRank = impliedNaqiRank(stationUsAqi);
  if (impliedRank === null) return null;
  const modelRank = getInCategory(modelNaqi).rank;
  return { modelRank, impliedRank, warn: impliedRank - modelRank > NAQI_CONSISTENCY_CATEGORIES };
}

const IN_LABEL_BY_RANK = Object.fromEntries(IN_CATEGORIES.map((c) => [c.rank, c.label])) as Record<number, string>;

function consistencyText(modelNaqi: number, stationUs: number, summary: StationSummary, c: NaqiConsistency): string {
  const what = summary.freshCount >= MIN_STATIONS_FOR_MEDIAN ? `the median of ${summary.freshCount} nearby stations` : "the nearest station";
  return (
    `The model's NAQI ${Math.round(modelNaqi)} (${IN_LABEL_BY_RANK[c.modelRank]}) is more than one category below what ${what} imply ` +
    `(US AQI ${Math.round(stationUs)}, which corresponds to "${IN_LABEL_BY_RANK[c.impliedRank]}" or worse on the NAQI scale when PM2.5 is the main pollutant). ` +
    "The model estimate is likely lower than station readings here."
  );
}

/* ------------------------------------------------------------------------- */
/* Older station readings                                                     */
/* ------------------------------------------------------------------------- */

/**
 * The nearest station within 10 km that reported in the last 12 hours, when
 * that reading is older than 3 hours (a fresh nearest station is already in
 * the headline). Readings older than 12 hours are not returned.
 */
export function olderReadingFor(stations: readonly NearbyStation[], now: number, reference: number | null): OlderReading | null {
  const recent = stations
    .filter((s) => s.distanceKm <= SINGLE_STATION_KM && Number.isFinite(s.aqi) && s.observedAt !== null)
    .map((s) => ({ s, age: now - Date.parse(s.observedAt as string) }))
    .filter(({ age }) => Number.isFinite(age) && age >= -HOUR && age <= OLDER_READING_MAX_HOURS * HOUR)
    .sort((a, b) => a.s.distanceKm - b.s.distanceKm);
  const first = recent[0];
  if (!first || isFresh(first.s.observedAt, now)) return null;
  const { s, age } = first;
  const above = reference !== null && reference > 0 ? (s.aqi - reference) / reference > DIVERGENCE_THRESHOLD : false;
  return {
    id: s.id,
    name: s.name,
    distanceKm: s.distanceKm,
    value: s.aqi,
    observedAt: s.observedAt as string,
    ageHours: Math.round((age / HOUR) * 10) / 10,
    reference,
    aboveReference: above,
  };
}

/* ------------------------------------------------------------------------- */
/* Selection                                                                  */
/* ------------------------------------------------------------------------- */

function noStationNote(input: HeadlineInput, summary: StationSummary): string {
  if (input.stationStatus === "not-configured") return "No nearby station data: ground stations are not configured on this server.";
  if (input.stationStatus === "error") return "No nearby station data: the station feed is unavailable right now.";
  if (input.stationStatus === "loading") return "Checking nearby stations…";
  if (summary.freshCount === 0) {
    const any = input.stations.some((s) => s.distanceKm <= HEADLINE_RADIUS_KM);
    return any
      ? `No nearby station data: no station within ${HEADLINE_RADIUS_KM} km has reported in the last ${FRESH_HOURS} hours.`
      : `No nearby station data: no station within ${HEADLINE_RADIUS_KM} km.`;
  }
  return "";
}

function naqiUnavailableReason(sn: StationNaqiSummary | null | undefined): string {
  if (!sn) return "Computing India NAQI from station concentrations…";
  if (sn.status === "not-configured") return "India NAQI from stations unavailable: station concentrations (OpenAQ) are not configured on this server.";
  if (sn.status === "error") return "India NAQI from stations unavailable: the station concentration feed (OpenAQ) could not be reached.";
  return `India NAQI from stations unavailable: ${sn.note ?? "no station has enough recent concentration data."}`;
}

export function selectHeadline(input: HeadlineInput): HeadlineSource {
  const summary = summarizeStations(input.stations, input.now);
  const modelReason = "Model estimate (Open-Meteo, CAMS)";
  const stationUs = summary.freshCount >= MIN_STATIONS_FOR_MEDIAN ? summary.median : summary.nearest?.value ?? null;
  const modelUs = input.model.usAqi;
  const divergence = stationUs !== null && modelUs !== null && modelUs > 0 ? (stationUs - modelUs) / modelUs : null;
  const stationUsAqi = stationUsFigure(summary, input.mode);
  const isIn = input.scale === "in";
  const sn = isIn ? (input.stationNaqi ?? null) : null;
  // For the consistency check even under "Model only": what the stations say in Auto.
  const checkUs = stationUsAqi ?? stationUsFigure(summary, "auto");
  const consistency = isIn ? naqiConsistency(input.model.value, checkUs) : null;
  const consistencyWarning =
    consistency?.warn && input.model.value !== null && checkUs !== null ? consistencyText(input.model.value, checkUs, summary, consistency) : null;

  const base = {
    scale: input.scale,
    mode: input.mode,
    stationCount: summary.freshCount,
    highest: summary.highest,
    nearest: summary.nearest,
    modelValue: input.model.value,
    summary,
    divergence,
    showDivergenceNote: divergence !== null && Math.abs(divergence) > DIVERGENCE_THRESHOLD,
    stationUsAqi,
    naqiBasis: null as NaqiBasis | null,
    stationNaqi: sn,
    naqiPending: false,
    consistencyWarning: null as string | null,
    olderReading: null as OlderReading | null,
  };
  const model = (note: string | null): HeadlineSource => ({
    ...base,
    source: "model",
    value: input.model.value,
    observedAt: input.model.time,
    reason: modelReason,
    stationNote: note,
    ...(isIn ? { naqiBasis: "model" as const, consistencyWarning } : {}),
  });

  const pick = (): HeadlineSource => {
    if (input.scale === "eu") {
      return model(
        summary.freshCount > 0
          ? "Station readings are reported on the US AQI scale, so the European AQI comes from the model. Switch to US AQI to see the station figures."
          : noStationNote(input, summary) || null,
      );
    }

    if (isIn) {
      if (input.mode === "model") return model("Model only (your data-source setting).");
      // Station-based NAQI from concentrations.
      if (sn && sn.status === "ok" && sn.value !== null && sn.nearest) {
        const stationsBase = {
          ...base,
          naqiBasis: "stations" as const,
          stationNote: null,
          highest: sn.highest ? naqiRef(sn.highest) : null,
          nearest: naqiRef(sn.nearest),
        };
        if (input.mode === "auto" && sn.method === "median" && sn.median !== null) {
          return {
            ...stationsBase,
            source: "stations-median",
            value: sn.median,
            stationCount: sn.count,
            observedAt: sn.latestObservedAt,
            reason: `Median of ${sn.count} stations within ${HEADLINE_RADIUS_KM} km`,
          };
        }
        const n = sn.nearest;
        return {
          ...stationsBase,
          source: "station",
          value: n.value,
          stationCount: sn.count,
          observedAt: n.observedAt,
          reason: `Nearest station with enough data: ${n.name} (${km(n.distanceKm)})`,
        };
      }
      // No station-based NAQI. If stations drive the US headline, the model NAQI must not stand in as an equal peer.
      if (stationUsAqi !== null) {
        return {
          ...base,
          source: "unavailable",
          value: null,
          observedAt: input.model.time,
          reason: "India NAQI from stations unavailable",
          stationNote: naqiUnavailableReason(sn),
          naqiBasis: "unavailable",
          naqiPending: !sn,
          consistencyWarning,
        };
      }
      return model(noStationNote(input, summary) || null);
    }

    // US AQI
    if (input.mode === "model") return model("Model only (your data-source setting).");
    if (input.mode === "station") {
      if (!summary.nearest) return model(noStationNote(input, summary));
      const n = summary.nearest;
      return { ...base, source: "station", value: n.value, observedAt: n.observedAt, reason: `Nearest station: ${n.name} (${km(n.distanceKm)})`, stationNote: null };
    }
    if (summary.freshCount >= MIN_STATIONS_FOR_MEDIAN && summary.median !== null) {
      return {
        ...base,
        source: "stations-median",
        value: summary.median,
        observedAt: summary.latestObservedAt,
        reason: `Median of ${summary.freshCount} stations within ${HEADLINE_RADIUS_KM} km`,
        stationNote: null,
      };
    }
    if (summary.nearest && summary.nearest.distanceKm <= SINGLE_STATION_KM) {
      const n = summary.nearest;
      return { ...base, source: "station", value: n.value, observedAt: n.observedAt, reason: `Nearest station: ${n.name} (${km(n.distanceKm)})`, stationNote: null };
    }
    if (summary.nearest) {
      return model(`Only ${summary.freshCount} fresh station${summary.freshCount === 1 ? "" : "s"} within ${HEADLINE_RADIUS_KM} km, none within ${SINGLE_STATION_KM} km, so the headline uses the model.`);
    }
    return model(noStationNote(input, summary));
  };

  const h = pick();
  // Older nearest-station reading (US AQI): compared with the US headline, or the model's US AQI on other scales.
  const reference = input.scale === "us" ? h.value : modelUs;
  h.olderReading = input.mode === "model" ? null : olderReadingFor(input.stations, input.now, reference);
  return h;
}

/* ------------------------------------------------------------------------- */
/* Labels                                                                     */
/* ------------------------------------------------------------------------- */

/** Short source label for cards, reports and alerts, e.g. "Stations (median of 18)", "Station: Murthal (5 km)", "Model". */
export function sourceLabel(h: Pick<HeadlineSource, "source" | "stationCount" | "nearest" | "reason" | "scale">): string {
  if (h.source === "stations-median") return `Stations (median of ${h.stationCount})`;
  if (h.source === "station") return h.nearest ? `Station: ${shortName(h.nearest.name)} (${km(h.nearest.distanceKm)})` : "Station";
  if (h.source === "unavailable") return "Station NAQI unavailable";
  return "Model (Open-Meteo)";
}

/**
 * Full India NAQI label, e.g.
 * "India NAQI, computed by AirIQ from station concentrations (median of 9 stations)",
 * "India NAQI, computed by AirIQ from model concentrations",
 * "India NAQI from stations unavailable". Null on other scales.
 */
export function naqiLabel(h: Pick<HeadlineSource, "scale" | "source" | "stationCount" | "nearest" | "naqiBasis">): string | null {
  if (h.scale !== "in") return null;
  if (h.naqiBasis === "unavailable" || h.source === "unavailable") return "India NAQI from stations unavailable";
  if (h.naqiBasis === "stations") {
    return h.source === "stations-median"
      ? `India NAQI, computed by AirIQ from station concentrations (median of ${h.stationCount} stations)`
      : `India NAQI, computed by AirIQ from station concentrations (nearest station with enough data${h.nearest ? `: ${shortName(h.nearest.name)}, ${km(h.nearest.distanceKm)}` : ""})`;
  }
  return "India NAQI, computed by AirIQ from model concentrations";
}

/** Secondary line when the NAQI is unavailable: "Model estimate 188 (model estimate, likely lower than station readings here)". */
export function modelEstimateLine(h: Pick<HeadlineSource, "source" | "modelValue">, formatValue: (v: number) => string): string | null {
  if (h.source !== "unavailable" || h.modelValue === null) return null;
  return `NAQI ${formatValue(h.modelValue)}: model estimate, likely lower than station readings here`;
}

/** "Last reading at Murthal, Sonipat (5.1 km): 187, 18:00 IST (4.6 h ago)". */
export function olderReadingText(o: OlderReading, formatTime: (iso: string) => string, usPrefix = false): string {
  const dist = o.distanceKm < 1 ? "<1" : o.distanceKm.toFixed(1);
  return `Last reading at ${o.name.split(",").slice(0, 2).join(",").trim()} (${dist} km): ${usPrefix ? "US AQI " : ""}${Math.round(o.value)}, ${formatTime(o.observedAt)} (${o.ageHours.toFixed(1)} h ago)`;
}

/**
 * Gauge subtitle, e.g.
 * "Median of 18 stations within 15 km · highest 531 at Anand Vihar (9 km) · latest 18:00 IST"
 * or "Model estimate: 150".
 */
export function headlineSubtitle(h: HeadlineSource, formatTime: (iso: string) => string, formatValue: (v: number) => string): string {
  if (h.source === "stations-median") {
    const parts = [h.reason];
    if (h.highest) parts.push(`highest ${formatValue(h.highest.value)} at ${shortName(h.highest.name)} (${km(h.highest.distanceKm)})`);
    if (h.observedAt) parts.push(`latest ${formatTime(h.observedAt)}`);
    return parts.join(" · ");
  }
  if (h.source === "station") {
    return [h.reason, h.observedAt ? `observed ${formatTime(h.observedAt)}` : null].filter(Boolean).join(" · ");
  }
  if (h.source === "unavailable") return h.naqiPending ? "Computing India NAQI from station concentrations…" : "India NAQI from stations unavailable";
  return h.modelValue !== null ? `Model estimate: ${formatValue(h.modelValue)}` : "Model estimate";
}

/**
 * The index the health advice uses: the headline when it has a value; when
 * the India NAQI is unavailable, the stations' US AQI (so advice never rests
 * on the lower model estimate); else null.
 */
export function adviceBasis(h: HeadlineSource): { scale: ScaleKey; value: number; label: string } | null {
  if (h.value !== null) return { scale: h.scale, value: h.value, label: sourceLabel(h) };
  if (h.source === "unavailable" && h.stationUsAqi !== null) {
    return { scale: "us", value: h.stationUsAqi, label: "US AQI from stations (station-based NAQI unavailable)" };
  }
  return null;
}

/** "Anand Vihar, Delhi, Delhi, India" → "Anand Vihar". */
export function shortName(name: string): string {
  const first = name.split(",")[0]?.trim();
  return first && first.length >= 3 ? first : name;
}
