/**
 * Internal, source-agnostic data model. Every external API is normalized to
 * these shapes inside lib/* before it reaches route handlers or the UI.
 */

export const POLLUTANTS = ["pm2_5", "pm10", "nitrogen_dioxide", "sulphur_dioxide", "ozone", "carbon_monoxide"] as const;
export type Pollutant = (typeof POLLUTANTS)[number];

export type AqiScale = "us" | "eu";

/** Concentrations in µg/m³ (Open-Meteo native unit, incl. CO). `null` = not reported. */
export type PollutantValues = Record<Pollutant, number | null>;

export interface GeoLocation {
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  countryCode?: string;
  admin1?: string;
  timezone?: string;
  population?: number;
}

export type SubIndexValues = Partial<Record<Pollutant, number>>;

export interface AirQuality {
  source: "open-meteo" | "waqi" | "openaq";
  latitude: number;
  longitude: number;
  /** ISO-8601 UTC timestamp of the measurement / model hour. */
  time: string;
  timezone: string;
  utcOffsetSeconds: number;
  usAqi: number | null;
  euAqi: number | null;
  uvIndex: number | null;
  pollutants: PollutantValues;
  /** Source-reported per-pollutant sub-indices (Open-Meteo); empty when unavailable. */
  usSubIndices: SubIndexValues;
  euSubIndices: SubIndexValues;
  /** Pollutant with the highest sub-index on each scale. */
  dominantUs: Pollutant | null;
  dominantEu: Pollutant | null;
}

export interface HourlyPoint {
  /** ISO-8601 UTC */
  time: string;
  usAqi: number | null;
  euAqi: number | null;
  pollutants: PollutantValues;
}

export interface AirSeries {
  latitude: number;
  longitude: number;
  timezone: string;
  utcOffsetSeconds: number;
  points: HourlyPoint[];
}

export interface WeatherPoint {
  time: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  pressure: number | null;
}

export interface WeatherSeries {
  latitude: number;
  longitude: number;
  timezone: string;
  utcOffsetSeconds: number;
  current: WeatherPoint | null;
  points: WeatherPoint[];
}

export interface GridCell {
  latitude: number;
  longitude: number;
  time: string;
  usAqi: number | null;
  euAqi: number | null;
  pollutants: PollutantValues;
}

export interface Station {
  id: string;
  source: "waqi" | "openaq";
  name: string;
  latitude: number;
  longitude: number;
  /** AQI as reported by the network (WAQI) or computed from PM2.5 (OpenAQ). */
  aqi: number | null;
  pollutants: Partial<PollutantValues>;
  time: string | null;
  url?: string;
}

/** Uniform API error envelope returned by every route handler. */
export interface ApiError {
  error: string;
  detail?: string;
}
