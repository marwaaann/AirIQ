import type { NextRequest } from "next/server";

import { baseStepForZoom, snapBoundsOutward } from "@/lib/grid";
import { handleRouteError, jsonOk, parseQuery } from "@/lib/http";
import { NearbyQuerySchema } from "@/lib/schemas";
import { getNearbyStations, getStations } from "@/lib/stations";
import { parseViewport } from "@/lib/viewport";
import type { NearbyStationsResponse, StationsResponse } from "@/types/api";

/**
 * Two modes:
 *
 * GET /api/stations?south=&west=&north=&east=&zoom=
 *   Ground stations in a map viewport from WAQI (WAQI_TOKEN) or OpenAQ
 *   (OPENAQ_API_KEY), else `{ source: "none", stations: [] }`.
 *
 * GET /api/stations?lat=&lon=[&radius=15]
 *   Stations within `radius` km of a point, nearest first, each with its
 *   distance and observation time (capped at 40), plus a station-based India
 *   NAQI when OpenAQ is configured. A failing feed returns `status: "error"`
 *   (HTTP 200) so the page can fall back to the model with a visible note.
 *
 * Both are cached 10 minutes on the server. Keys never leave the server.
 */
export async function GET(req: NextRequest) {
  try {
    const params = req.nextUrl.searchParams;
    if (params.has("lat") && params.has("lon")) {
      const { lat, lon, radius } = parseQuery(params, NearbyQuerySchema);
      return jsonOk<NearbyStationsResponse>(await getNearbyStations(lat, lon, radius));
    }
    const { bounds, zoom } = parseViewport(params);
    // Snap outward so nearby viewports share upstream cache entries.
    const snapped = snapBoundsOutward(bounds, Math.max(0.5, baseStepForZoom(zoom)));
    const data = await getStations(snapped);
    return jsonOk<StationsResponse>(data);
  } catch (err) {
    return handleRouteError(err);
  }
}
