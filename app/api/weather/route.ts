import type { NextRequest } from "next/server";

import { cached } from "@/lib/cache";
import { handleRouteError, jsonOk, parseQuery } from "@/lib/http";
import { getWeather } from "@/lib/openmeteo";
import { HistoryQuerySchema } from "@/lib/schemas";
import type { HistoryRange, WeatherResponseBody } from "@/types/api";

const WEATHER_TTL = 30 * 60;

/**
 * GET /api/weather?lat=&lon=&days=7|30|90
 * Hourly Open-Meteo weather for the past `days` up to the current hour:
 * temperature, humidity, wind speed/direction, surface pressure,
 * precipitation and boundary layer height. Times are exact UTC instants
 * (converted with the response's utc_offset_seconds); `weather.timezone`
 * is the IANA zone for local-day grouping. Cached 30 minutes.
 */
export async function GET(req: NextRequest) {
  try {
    const { lat, lon, days } = parseQuery(req.nextUrl.searchParams, HistoryQuerySchema);
    const key = `weather:${lat.toFixed(3)},${lon.toFixed(3)}:${days}`;
    const body = await cached<WeatherResponseBody>(key, WEATHER_TTL, async () => {
      const weather = await getWeather(lat, lon, days, 1, WEATHER_TTL);
      const now = Date.now();
      return {
        weather: { ...weather, points: weather.points.filter((p) => Date.parse(p.time) <= now) },
        days: days as HistoryRange,
        fetchedAt: new Date().toISOString(),
      };
    });
    return jsonOk<WeatherResponseBody>(body, WEATHER_TTL);
  } catch (err) {
    return handleRouteError(err);
  }
}
