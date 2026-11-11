import "server-only";

import { getEnv } from "@/lib/env";
import type { Bounds } from "@/lib/grid";
import { UpstreamError } from "@/lib/http";
import { getOpenAqStations } from "@/lib/openaq";
import { getWaqiStations } from "@/lib/waqi";
import type { StationsResponse } from "@/types/api";

/** Optional keys, read only on the server via lib/env.ts. Empty strings count as missing. */
function key(name: "WAQI_TOKEN" | "OPENAQ_API_KEY"): string | null {
  const env = getEnv();
  return (name === "WAQI_TOKEN" ? env.waqiToken : env.openaqKey) ?? null;
}

export function configuredStationSources(): { waqi: boolean; openaq: boolean } {
  return { waqi: key("WAQI_TOKEN") !== null, openaq: key("OPENAQ_API_KEY") !== null };
}

/**
 * Source priority: WAQI (if WAQI_TOKEN) → OpenAQ (if OPENAQ_API_KEY) → none.
 * A missing key is never an error. If a configured source fails and the other
 * is configured, fall back to it; if every configured source fails, throw.
 */
export async function getStations(b: Bounds): Promise<StationsResponse> {
  const fetchedAt = new Date().toISOString();
  const waqiToken = key("WAQI_TOKEN");
  const openaqKey = key("OPENAQ_API_KEY");

  if (!waqiToken && !openaqKey) {
    return { source: "none", stations: [], note: "Ground stations: not configured", fetchedAt };
  }

  let waqiError: string | null = null;
  if (waqiToken) {
    try {
      return { source: "waqi", stations: await getWaqiStations(b, waqiToken), fetchedAt };
    } catch (err) {
      waqiError = err instanceof Error ? err.message : "WAQI failed";
      if (!openaqKey) throw err instanceof UpstreamError ? err : new UpstreamError("WAQI", waqiError);
    }
  }

  // openaqKey is non-null here.
  let stations;
  try {
    stations = await getOpenAqStations(b, openaqKey as string);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OpenAQ failed";
    throw new UpstreamError("stations", waqiError ? `${waqiError}; ${msg}` : msg);
  }
  return {
    source: "openaq",
    stations,
    note: waqiError ? `WAQI unavailable (${waqiError}); showing OpenAQ` : undefined,
    fetchedAt,
  };
}
