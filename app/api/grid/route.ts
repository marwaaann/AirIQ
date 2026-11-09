import type { NextRequest } from "next/server";

import { cached, REVALIDATE_SECONDS } from "@/lib/cache";
import { buildGrid } from "@/lib/grid";
import { handleRouteError, jsonOk } from "@/lib/http";
import { getAirGrid } from "@/lib/openmeteo";
import { parseViewport } from "@/lib/viewport";
import type { GridResponse } from "@/types/api";

/**
 * GET /api/grid?south=&west=&north=&east=&zoom=
 * Current air quality on a snapped lat/lon grid (≤64 points) covering the
 * viewport, fetched in one batched Open-Meteo request. Cached 10 minutes;
 * `fetchedAt` is when the data was actually fetched from Open-Meteo.
 */
export async function GET(req: NextRequest) {
  try {
    const { bounds, zoom } = parseViewport(req.nextUrl.searchParams);
    const grid = buildGrid(bounds, zoom);
    const key = `grid:${grid.step}:${grid.points.map((p) => `${p.lat},${p.lon}`).join(";")}`;
    const body = await cached<GridResponse>(key, REVALIDATE_SECONDS, async () => ({
      cells: await getAirGrid(grid.points),
      step: grid.step,
      fetchedAt: new Date().toISOString(),
    }));
    return jsonOk<GridResponse>(body);
  } catch (err) {
    return handleRouteError(err);
  }
}
