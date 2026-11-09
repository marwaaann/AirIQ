import "server-only";

import type { Bounds } from "@/lib/grid";
import { fetchJson, UpstreamError } from "@/lib/http";
import { WaqiBoundsItemSchema, WaqiBoundsResponseSchema } from "@/lib/schemas";
import type { Station } from "@/types/air";

const WAQI_BASE = "https://api.waqi.info";

/** Parse WAQI's AQI field ("57", 57, or "-"); null when not a real number. */
export function parseWaqiAqi(v: string | number): number | null {
  const n = typeof v === "number" ? v : /^\s*\d+(\.\d+)?\s*$/.test(v) ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

function toIso(t: string | undefined): string | null {
  if (!t) return null;
  const ms = Date.parse(t);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/**
 * Ground stations inside `b` via WAQI /map/bounds/. WAQI reports a US-EPA-scale
 * AQI per station. The bounds endpoint does not state the dominant pollutant,
 * so it is left null rather than guessed.
 */
export async function getWaqiStations(b: Bounds, token: string): Promise<Station[]> {
  const latlng = `${b.south},${b.west},${b.north},${b.east}`;
  const url = `${WAQI_BASE}/map/bounds/?${new URLSearchParams({ latlng, networks: "all", token })}`;
  const body = await fetchJson(url, {
    upstream: "WAQI",
    schema: WaqiBoundsResponseSchema,
    // Never put the token in a cache key or error message.
    cacheKey: `waqi:bounds:${latlng}`,
  });
  if (body.status === "error") {
    const reason = typeof body.data === "string" ? body.data : "request rejected";
    throw new UpstreamError("WAQI", `WAQI: ${reason}`);
  }

  const stations: Station[] = [];
  for (const raw of body.data) {
    const parsed = WaqiBoundsItemSchema.safeParse(raw);
    if (!parsed.success) continue;
    const d = parsed.data;
    const aqi = parseWaqiAqi(d.aqi);
    if (aqi === null || !Number.isFinite(d.lat) || !Number.isFinite(d.lon)) continue;
    stations.push({
      id: `waqi-${d.uid}`,
      source: "waqi",
      name: d.station.name,
      latitude: d.lat,
      longitude: d.lon,
      aqi,
      aqiBasis: "reported",
      dominant: null,
      pm25: null,
      updatedAt: toIso(d.station.time),
      url: `https://aqicn.org/station/@${d.uid}`,
    });
  }
  return stations;
}
