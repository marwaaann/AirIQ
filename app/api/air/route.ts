import type { NextRequest } from "next/server";

import { handleRouteError, jsonOk, parseQuery } from "@/lib/http";
import { getCurrentAir } from "@/lib/openmeteo";
import { LatLonQuerySchema } from "@/lib/schemas";
import type { AirResponse } from "@/types/api";

/** GET /api/air?lat=..&lon=.. → current air quality + 24 h + EPA cross-check. */
export async function GET(req: NextRequest) {
  try {
    const { lat, lon } = parseQuery(req.nextUrl.searchParams, LatLonQuerySchema);
    const data = await getCurrentAir(lat, lon);
    return jsonOk<AirResponse>(data);
  } catch (err) {
    return handleRouteError(err);
  }
}
