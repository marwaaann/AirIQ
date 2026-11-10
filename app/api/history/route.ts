import type { NextRequest } from "next/server";

import { cached } from "@/lib/cache";
import { handleRouteError, jsonOk, parseQuery } from "@/lib/http";
import { getAirSeries, MAX_PAST_DAYS } from "@/lib/openmeteo";
import { HistoryQuerySchema } from "@/lib/schemas";
import type { HistoryRange, HistoryResponse } from "@/types/api";

const HISTORY_TTL = 30 * 60;

/**
 * GET /api/history?lat=&lon=&days=7|30|90
 * Hourly history (local-time aware via timezone=auto + utc_offset_seconds).
 * Fetches twice the range (max 92 days) so the UI can compare with the
 * previous period. Future hours of "today" are removed. Cached 30 minutes.
 */
export async function GET(req: NextRequest) {
  try {
    const { lat, lon, days } = parseQuery(req.nextUrl.searchParams, HistoryQuerySchema);
    const pastDays = Math.min(MAX_PAST_DAYS, days * 2);
    const key = `history:${lat.toFixed(3)},${lon.toFixed(3)}:${pastDays}`;
    const body = await cached<HistoryResponse>(key, HISTORY_TTL, async () => {
      const series = await getAirSeries(lat, lon, pastDays, 1, HISTORY_TTL);
      const now = Date.now();
      return {
        series: { ...series, points: series.points.filter((p) => Date.parse(p.time) <= now) },
        days: days as HistoryRange,
        fetchedPastDays: pastDays,
        fetchedAt: new Date().toISOString(),
      };
    });
    return jsonOk<HistoryResponse>(body, HISTORY_TTL);
  } catch (err) {
    return handleRouteError(err);
  }
}
