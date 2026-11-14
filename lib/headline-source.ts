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
 *   - India NAQI: computed from station concentrations (OpenAQ) when
 *     available, otherwise from model concentrations.
 * The station summary (US AQI) is still returned so the UI can say when the
 * stations read far higher than the model.
 *
 * Pure module (relative imports only) so it runs under `node --test`.
 */

import type { ScaleKey } from "./aqi-categories.ts";

export const DATA_SOURCE_MODES = ["auto", "station", "model"] as const;
export type DataSourceMode = (typeof DATA_SOURCE_MODES)[number];

export const DATA_SOURCE_LABEL: Record<DataSourceMode, string> = { auto: "Auto", station: "Nearest station", model: "Model only" };

export const HEADLINE_RADIUS_KM = 15;
export const SINGLE_STATION_KM = 10;
export const FRESH_HOURS = 3;
export const MIN_STATIONS_FOR_MEDIAN = 3;
/** Station vs model difference (relative to the model) above which the UI explains the gap. */
export const DIVERGENCE_THRESHOLD = 0.25;

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
  /** US AQI. */
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

export interface StationNaqi {
  value: number;
  stationName: string;
  distanceKm: number;
  observedAt: string;
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
  /** NAQI from a station's own concentrations (OpenAQ), when available. */
  stationNaqi?: StationNaqi | null;
}

export type HeadlineSourceKind = "stations-median" | "station" | "model";

export interface HeadlineSource {
  source: HeadlineSourceKind;
  /** Headline index on `scale` (may exceed the index top: beyond index). */
  value: number | null;
  scale: ScaleKey;
  mode: DataSourceMode;
  stationCount: number;
  highest: StationRef | null;
  nearest: StationRef | null;
  /** Observation time of the headline (latest station used, or the model hour). */
  observedAt: string | null;
  modelValue: number | null;
  /** One line saying how the headline was chosen. */
  reason: string;
  summary: StationSummary;
  /** (station − model) / model on the US AQI, using the median (≥ 3 stations) or the nearest station. */
  divergence: number | null;
  showDivergenceNote: boolean;
  /** Visible note when station data could not be used (null when stations drive the headline). */
  stationNote: string | null;
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

export function selectHeadline(input: HeadlineInput): HeadlineSource {
  const summary = summarizeStations(input.stations, input.now);
  const modelReason = "Model estimate (Open-Meteo, CAMS)";
  const stationUs = summary.freshCount >= MIN_STATIONS_FOR_MEDIAN ? summary.median : summary.nearest?.value ?? null;
  const modelUs = input.model.usAqi;
  const divergence = stationUs !== null && modelUs !== null && modelUs > 0 ? (stationUs - modelUs) / modelUs : null;
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
  };
  const model = (note: string | null): HeadlineSource => ({
    ...base,
    source: "model",
    value: input.model.value,
    observedAt: input.model.time,
    reason: modelReason,
    stationNote: note,
  });

  if (input.scale === "eu") {
    return model(
      summary.freshCount > 0
        ? "Station readings are reported on the US AQI scale, so the European AQI comes from the model. Switch to US AQI to see the station figures."
        : noStationNote(input, summary) || null,
    );
  }

  if (input.scale === "in") {
    if (input.mode !== "model" && input.stationNaqi) {
      const s = input.stationNaqi;
      return {
        ...base,
        source: "station",
        value: s.value,
        observedAt: s.observedAt,
        reason: `NAQI from station concentrations: ${s.stationName} (${km(s.distanceKm)})`,
        stationNote: null,
      };
    }
    if (input.mode === "model") return model("Model only (your data-source setting).");
    return model(
      summary.freshCount > 0
        ? "NAQI is computed from model concentrations: the nearby stations publish a US AQI, not the concentrations NAQI needs. Switch to US AQI to see the station figures."
        : noStationNote(input, summary) || null,
    );
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
}

/** Short source label for cards, reports and alerts, e.g. "Stations (median of 18)", "Station: Murthal (5 km)", "Model". */
export function sourceLabel(h: Pick<HeadlineSource, "source" | "stationCount" | "nearest" | "reason" | "scale">): string {
  if (h.source === "stations-median") return `Stations (median of ${h.stationCount})`;
  if (h.source === "station") {
    if (h.scale === "in") return h.reason.replace("NAQI from station concentrations: ", "Station: ");
    return h.nearest ? `Station: ${h.nearest.name} (${km(h.nearest.distanceKm)})` : "Station";
  }
  return "Model (Open-Meteo)";
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
  return h.modelValue !== null ? `Model estimate: ${formatValue(h.modelValue)}` : "Model estimate";
}

/** "Anand Vihar, Delhi, Delhi, India" → "Anand Vihar". */
export function shortName(name: string): string {
  const first = name.split(",")[0]?.trim();
  return first && first.length >= 3 ? first : name;
}
