import type { NearbyStation, StationFeedStatus, StationNaqi } from "@/lib/headline-source";
import type { AirQuality, AirSeries, GeoLocation, GridCell, Pollutant, Station, StationSource, WeatherSeries } from "@/types/air";
import type { PollutantKey } from "@/lib/aqi-categories";

/** Response bodies of the app's own route handlers (app/api/*). */

export interface EpaCrossCheck {
  /** AQI computed in-app with 2024 EPA breakpoints and proper averaging windows. */
  aqi2024: number | null;
  /** Same calculation with the superseded 2012 PM2.5 table, for reference. */
  aqi2012: number | null;
  dominant: PollutantKey | null;
  subIndices: Partial<Record<PollutantKey, number>>;
  /** Trailing 24-h PM2.5 mean (µg/m³) used for the cigarette indicator. */
  pm25Mean24h: number | null;
}

export interface AirResponse {
  current: AirQuality;
  epa: EpaCrossCheck;
  /** Last 24 hours, for sparklines. */
  recent: AirSeries;
  fetchedAt: string;
}

export interface SeriesResponse {
  series: AirSeries;
  fetchedAt: string;
}

export interface GeocodeResponse {
  results: GeoLocation[];
}

export interface GridResponse {
  cells: GridCell[];
  /** Grid spacing in degrees (points sit on multiples of it). */
  step: number;
  fetchedAt: string;
}

export interface StationsResponse {
  source: StationSource | "none";
  stations: Station[];
  /** Human-readable note, e.g. a fallback or "not configured". */
  note?: string;
  fetchedAt: string;
}

/** GET /api/stations?lat=&lon=: stations near a point, for the station-first headline. */
export interface NearbyStationsResponse {
  status: StationFeedStatus;
  source: StationSource | "none";
  /** Nearest first, within `radiusKm`, capped at 40. */
  stations: NearbyStation[];
  radiusKm: number;
  /** India NAQI from a station's own concentrations (OpenAQ), when available. */
  stationNaqi: StationNaqi | null;
  note?: string;
  fetchedAt: string;
}

/** GET /api/station?id=waqi-123: popup detail for one station. */
export interface StationDetailResponse {
  id: string;
  dominant: Pollutant | null;
  observedAt: string | null;
  /** WAQI per-pollutant INDEX values (US-EPA scale), never concentrations. */
  indexByPollutant: Partial<Record<Pollutant, number>>;
  fetchedAt: string;
}

export interface WeatherResponseBody {
  weather: WeatherSeries;
  days: HistoryRange;
  fetchedAt: string;
}

/* ------------------------------------------------------------------------- */
/* History & forecast                                                         */
/* ------------------------------------------------------------------------- */

export type HistoryRange = 7 | 30 | 90;

export interface HistoryResponse {
  /** Hourly points up to the current hour (no future hours), oldest first. */
  series: AirSeries;
  /** Requested display range in days. */
  days: HistoryRange;
  /** Days actually fetched (2× range when available, for period-over-period). */
  fetchedPastDays: number;
  fetchedAt: string;
}

export interface MetricsPayload {
  mae: number;
  rmse: number;
  n: number;
}

export interface ModelForecastPoint {
  /** UTC ISO */
  time: string;
  k: number;
  pm25: number;
  pm25Lo: number;
  pm25Hi: number;
  us: number | null;
  usLo: number | null;
  usHi: number | null;
  eu: number | null;
  euLo: number | null;
  euHi: number | null;
  /** India NAQI PM2.5 sub-index of the trailing 24-h mean (observed + predicted). */
  in: number | null;
  inLo: number | null;
  inHi: number | null;
}

export type ModelPayload =
  | {
      status: "ok";
      params: { alpha: number; beta: number; gamma: number; phi: number };
      trainHours: number;
      validHours: number;
      backtest: {
        holdout: number;
        trainHours: number;
        /** PM2.5 error in µg/m³ over the held-out hours. */
        model: MetricsPayload;
        persistence: MetricsPayload;
        seasonalNaive: MetricsPayload;
      };
      intervals: { from: number; to: number; q10: number; q90: number; n: number }[];
      points: ModelForecastPoint[];
    }
  | { status: "insufficient"; reason: string; validHours: number; trainHours: number };

export interface ForecastResponse {
  /** Official CAMS forecast via Open-Meteo, from the current hour onward. */
  official: AirSeries;
  /** UTC ISO of the current (latest analysed) hour. */
  now: string;
  model: ModelPayload;
  /** Daily sunrise/sunset (UTC ISO) for the next 3 days; null if unavailable. */
  sun: { sunrise: string; sunset: string }[] | null;
  fetchedAt: string;
}
