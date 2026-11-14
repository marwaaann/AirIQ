/**
 * Internal, source-agnostic data model. Every external API is normalized to
 * these shapes inside lib/* before it reaches route handlers or the UI.
 */

export const POLLUTANTS = ["pm2_5", "pm10", "nitrogen_dioxide", "sulphur_dioxide", "ozone", "carbon_monoxide"] as const;
export type Pollutant = (typeof POLLUTANTS)[number];

/** US EPA AQI, European AQI (EEA), or India NAQI (CPCB, computed by AirIQ from concentrations). */
export type AqiScale = "us" | "eu" | "in";

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
  /**
   * India NAQI computed by AirIQ from the model's hourly concentrations (24-h
   * PM/NO₂/SO₂ means, 8-h CO/O₃ means, CPCB minimum-data rules). Null when
   * there is not enough data. May exceed 500 (beyond index).
   */
  inAqi: number | null;
  inSubIndices: SubIndexValues;
  dominantIn: Pollutant | null;
  /** Why NAQI could not be computed (null when it was). */
  inReason: string | null;
}

export interface HourlyPoint {
  /** ISO-8601 UTC */
  time: string;
  usAqi: number | null;
  euAqi: number | null;
  pollutants: PollutantValues;
  /** Hourly source sub-indices (present on history/forecast series). */
  usSubIndices?: SubIndexValues;
  euSubIndices?: SubIndexValues;
  /** India NAQI computed by AirIQ from the series' concentrations (null without 16 h of data). */
  inAqi?: number | null;
  inSubIndices?: SubIndexValues;
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
  /** mm in the preceding hour (hourly) or current interval. */
  precipitation: number | null;
  /** Planetary boundary layer height, m (hourly only; null in `current`). */
  boundaryLayerHeight: number | null;
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
  /** Source sub-indices per pollutant (EU has no CO). */
  usSubIndices: SubIndexValues;
  euSubIndices: SubIndexValues;
  /** India NAQI computed by AirIQ from the point's last 24 h of model concentrations. */
  inAqi: number | null;
  inSubIndices: SubIndexValues;
}

export type StationSource = "waqi" | "openaq";

export interface Station {
  id: string;
  source: StationSource;
  name: string;
  latitude: number;
  longitude: number;
  /** US AQI. */
  aqi: number;
  /**
   * "reported": the network's own AQI (WAQI, US EPA scale).
   * "pm25-latest": computed in-app from the station's latest hourly PM2.5
   * reading (OpenAQ), an instantaneous indicator rather than a 24-h AQI.
   */
  aqiBasis: "reported" | "pm25-latest";
  /** Only set when the source states it; never inferred. */
  dominant: Pollutant | null;
  /** Latest PM2.5 in µg/m³ when the source provides it. */
  pm25: number | null;
  /** ISO time of the reading, if provided. */
  updatedAt: string | null;
  url?: string;
}

/** Uniform API error envelope returned by every route handler. */
export interface ApiError {
  error: string;
  detail?: string;
}
