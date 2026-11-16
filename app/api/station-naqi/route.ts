import type { NextRequest } from "next/server";

import { handleRouteError, jsonError, jsonOk, parseQuery } from "@/lib/http";
import { LatLonQuerySchema } from "@/lib/schemas";
import { getStationNaqi } from "@/lib/stations";
import type { StationNaqiResponse } from "@/types/api";

/**
 * GET /api/station-naqi?lat=&lon=
 * India NAQI computed by AirIQ from ground stations' concentrations (OpenAQ
 * v3): per station from PM2.5/PM10 24-hour means and the gases' latest hour,
 * then the median across stations with enough data (≥ 3) or the nearest one.
 * Requires OPENAQ_API_KEY (status "not-configured" otherwise); OpenAQ
 * failures return status "error" with HTTP 200 so the page can say so.
 * Upstream calls are cached 10 minutes and rate-limited; when the client
 * disconnects, no further upstream calls are started for this request.
 */
export async function GET(req: NextRequest) {
  try {
    const { lat, lon } = parseQuery(req.nextUrl.searchParams, LatLonQuerySchema);
    return jsonOk<StationNaqiResponse>(await getStationNaqi(lat, lon, req.signal));
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return jsonError(503, "Request cancelled");
    return handleRouteError(err);
  }
}
