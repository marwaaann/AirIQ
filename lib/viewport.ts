import "server-only";

import { maxSpanForZoom, type Bounds } from "@/lib/grid";
import { BadRequestError, parseQuery } from "@/lib/http";
import { BoundsQuerySchema } from "@/lib/schemas";

/** Validate ?south&west&north&east&zoom; rejects inverted or oversized bounds with a 400. */
export function parseViewport(params: URLSearchParams): { bounds: Bounds; zoom: number } {
  const q = parseQuery(params, BoundsQuerySchema);
  const max = maxSpanForZoom(q.zoom);
  const latSpan = q.north - q.south;
  const lonSpan = q.east - q.west;
  if (latSpan > max.lat || lonSpan > max.lon) {
    throw new BadRequestError(
      `bounds too large for zoom ${q.zoom}: ${latSpan.toFixed(2)}° × ${lonSpan.toFixed(2)}° (max ${max.lat.toFixed(2)}° × ${max.lon.toFixed(2)}°)`,
    );
  }
  return { bounds: { south: q.south, west: q.west, north: q.north, east: q.east }, zoom: q.zoom };
}
