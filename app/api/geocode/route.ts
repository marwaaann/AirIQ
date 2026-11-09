import type { NextRequest } from "next/server";

import { GEOCODE_REVALIDATE_SECONDS } from "@/lib/cache";
import { handleRouteError, jsonOk, parseQuery } from "@/lib/http";
import { geocode } from "@/lib/openmeteo";
import { GeocodeQuerySchema } from "@/lib/schemas";
import type { GeocodeResponse } from "@/types/api";

/** GET /api/geocode?q=delhi&count=8&lang=en → city search via Open-Meteo Geocoding. */
export async function GET(req: NextRequest) {
  try {
    const { q, count, lang } = parseQuery(req.nextUrl.searchParams, GeocodeQuerySchema);
    const results = await geocode(q, count, lang);
    return jsonOk<GeocodeResponse>({ results }, GEOCODE_REVALIDATE_SECONDS);
  } catch (err) {
    return handleRouteError(err);
  }
}
