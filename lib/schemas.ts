import { z } from "zod";

/* ------------------------------------------------------------------------- */
/* Shared                                                                     */
/* ------------------------------------------------------------------------- */

const num = z.number().nullable().optional();
const numArray = z.array(z.number().nullable());

/** Open-Meteo returns `{ error: true, reason }` with HTTP 400 on bad input. */
export const OpenMeteoErrorSchema = z.object({
  error: z.literal(true),
  reason: z.string(),
});

/* ------------------------------------------------------------------------- */
/* Air Quality API                                                            */
/* ------------------------------------------------------------------------- */

export const AQ_VARIABLES = [
  "us_aqi",
  "european_aqi",
  "pm10",
  "pm2_5",
  "carbon_monoxide",
  "nitrogen_dioxide",
  "sulphur_dioxide",
  "ozone",
] as const;

/** Per-pollutant sub-indices Open-Meteo reports alongside us_aqi / european_aqi. */
export const SUB_INDEX_POLLUTANTS = ["pm2_5", "pm10", "nitrogen_dioxide", "sulphur_dioxide", "ozone", "carbon_monoxide"] as const;
export const US_SUB_INDEX_VARIABLES = SUB_INDEX_POLLUTANTS.map((p) => `us_aqi_${p}` as const);
/** The European index has no CO component. */
export const EU_SUB_INDEX_VARIABLES = SUB_INDEX_POLLUTANTS.filter((p) => p !== "carbon_monoxide").map(
  (p) => `european_aqi_${p}` as const,
);

export const AqCurrentSchema = z.object({
  time: z.string(),
  interval: z.number().optional(),
  us_aqi: num,
  european_aqi: num,
  pm10: num,
  pm2_5: num,
  carbon_monoxide: num,
  nitrogen_dioxide: num,
  sulphur_dioxide: num,
  ozone: num,
  uv_index: num,
  us_aqi_pm2_5: num,
  us_aqi_pm10: num,
  us_aqi_nitrogen_dioxide: num,
  us_aqi_sulphur_dioxide: num,
  us_aqi_ozone: num,
  us_aqi_carbon_monoxide: num,
  european_aqi_pm2_5: num,
  european_aqi_pm10: num,
  european_aqi_nitrogen_dioxide: num,
  european_aqi_sulphur_dioxide: num,
  european_aqi_ozone: num,
});

export const AqHourlySchema = z.object({
  time: z.array(z.string()),
  us_aqi: numArray.optional(),
  european_aqi: numArray.optional(),
  pm10: numArray.optional(),
  pm2_5: numArray.optional(),
  carbon_monoxide: numArray.optional(),
  nitrogen_dioxide: numArray.optional(),
  sulphur_dioxide: numArray.optional(),
  ozone: numArray.optional(),
});

export const AqResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  utc_offset_seconds: z.number().default(0),
  timezone: z.string().default("GMT"),
  current: AqCurrentSchema.optional(),
  hourly: AqHourlySchema.optional(),
});
export type AqResponse = z.infer<typeof AqResponseSchema>;

/** Multi-location requests return an array; single-location an object. */
export const AqMultiResponseSchema = z.union([z.array(AqResponseSchema), AqResponseSchema]);

/* ------------------------------------------------------------------------- */
/* Weather (Forecast) API                                                     */
/* ------------------------------------------------------------------------- */

export const WEATHER_VARIABLES = [
  "temperature_2m",
  "relative_humidity_2m",
  "wind_speed_10m",
  "wind_direction_10m",
  "surface_pressure",
] as const;

export const WeatherCurrentSchema = z.object({
  time: z.string(),
  temperature_2m: num,
  relative_humidity_2m: num,
  wind_speed_10m: num,
  wind_direction_10m: num,
  surface_pressure: num,
});

export const WeatherHourlySchema = z.object({
  time: z.array(z.string()),
  temperature_2m: numArray.optional(),
  relative_humidity_2m: numArray.optional(),
  wind_speed_10m: numArray.optional(),
  wind_direction_10m: numArray.optional(),
  surface_pressure: numArray.optional(),
});

export const WeatherResponseSchema = z.object({
  latitude: z.number(),
  longitude: z.number(),
  utc_offset_seconds: z.number().default(0),
  timezone: z.string().default("GMT"),
  current: WeatherCurrentSchema.optional(),
  hourly: WeatherHourlySchema.optional(),
});
export type WeatherResponse = z.infer<typeof WeatherResponseSchema>;

/* ------------------------------------------------------------------------- */
/* Geocoding API                                                              */
/* ------------------------------------------------------------------------- */

export const GeocodeResultSchema = z.object({
  id: z.number(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  country: z.string().optional(),
  country_code: z.string().optional(),
  admin1: z.string().optional(),
  timezone: z.string().optional(),
  population: z.number().optional(),
});

export const GeocodeResponseSchema = z.object({
  results: z.array(GeocodeResultSchema).optional(),
});

/* ------------------------------------------------------------------------- */
/* Route query params                                                         */
/* ------------------------------------------------------------------------- */

export const LatLonQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
});

export const GeocodeQuerySchema = z.object({
  q: z.string().trim().min(2, "Query must be at least 2 characters").max(100),
  count: z.coerce.number().int().min(1).max(20).default(8),
  lang: z
    .string()
    .regex(/^[a-z]{2}$/)
    .default("en"),
});
