import type { NextRequest } from "next/server";

import { baseStepForZoom, snapBoundsOutward } from "@/lib/grid";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getStations } from "@/lib/stations";
import { parseViewport } from "@/lib/viewport";
import type { StationsResponse } from "@/types/api";

/**
 * GET /api/stations?south=&west=&north=&east=&zoom=
 * Ground stations from WAQI (WAQI_TOKEN) or OpenAQ (OPENAQ_API_KEY), else
 * `{ source: "none", stations: [] }`. Keys never leave the server.
 */
export async function GET(req: NextRequest) {
  try {
    const { bounds, zoom } = parseViewport(req.nextUrl.searchParams);
    // Snap outward so nearby viewports share upstream cache entries.
    const snapped = snapBoundsOutward(bounds, Math.max(0.5, baseStepForZoom(zoom)));
    const data = await getStations(snapped);
    return jsonOk<StationsResponse>(data);
  } catch (err) {
    return handleRouteError(err);
  }
}
