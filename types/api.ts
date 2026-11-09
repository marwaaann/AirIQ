import type { AirQuality, AirSeries, GeoLocation, GridCell, Station, StationSource, WeatherSeries } from "@/types/air";
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

export interface WeatherResponseBody {
  weather: WeatherSeries;
  fetchedAt: string;
}
