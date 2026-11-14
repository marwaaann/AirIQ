import type { NextRequest } from "next/server";

import { handleRouteError, jsonError, jsonOk, parseQuery } from "@/lib/http";
import { StationDetailQuerySchema } from "@/lib/schemas";
import { getStationDetail } from "@/lib/stations";
import type { StationDetailResponse } from "@/types/api";

/**
 * GET /api/station?id=waqi-12345
 * One WAQI station's dominant pollutant and observation time, for the map
 * popup (the bounds feed does not include them). Cached 10 minutes. The
 * per-pollutant values are WAQI INDEX values, never concentrations.
 */
export async function GET(req: NextRequest) {
  try {
    const { id } = parseQuery(req.nextUrl.searchParams, StationDetailQuerySchema);
    const detail = await getStationDetail(id);
    if (!detail) return jsonError(404, "Station detail unavailable", "WAQI is not configured on this server.");
    return jsonOk<StationDetailResponse>({ ...detail, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return handleRouteError(err);
  }
}
