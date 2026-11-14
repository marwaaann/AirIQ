import "server-only";

import { getEnv } from "@/lib/env";
import type { Bounds } from "@/lib/grid";
import { UpstreamError } from "@/lib/http";
import { boxAround, nearbyList } from "@/lib/nearby";
import { getOpenAqStationNaqi, getOpenAqStations } from "@/lib/openaq";
import { getWaqiStationDetail, getWaqiStations, type WaqiStationDetail } from "@/lib/waqi";
import type { NearbyStationsResponse, StationsResponse } from "@/types/api";

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

/**
 * Stations within `radiusKm` of a point, nearest first (capped), plus a
 * station-based India NAQI from OpenAQ concentrations when OPENAQ_API_KEY is
 * set. Never throws: a failing feed becomes status "error" so the UI can fall
 * back to the model with a visible note.
 */
export async function getNearbyStations(lat: number, lon: number, radiusKm: number): Promise<NearbyStationsResponse> {
  const fetchedAt = new Date().toISOString();
  const sources = configuredStationSources();
  if (!sources.waqi && !sources.openaq) {
    return { status: "not-configured", source: "none", stations: [], radiusKm, stationNaqi: null, note: "Ground stations: not configured", fetchedAt };
  }
  let base: StationsResponse;
  try {
    base = await getStations(boxAround(lat, lon, radiusKm));
  } catch (err) {
    const msg = err instanceof Error ? err.message : "station feed failed";
    return { status: "error", source: "none", stations: [], radiusKm, stationNaqi: null, note: msg, fetchedAt };
  }
  const stations = nearbyList(base.stations, lat, lon, radiusKm);
  let stationNaqi = null;
  const openaqKey = key("OPENAQ_API_KEY");
  if (openaqKey) {
    try {
      stationNaqi = await getOpenAqStationNaqi(lat, lon, openaqKey, radiusKm);
    } catch {
      // Station NAQI is optional: the model-based NAQI is used instead.
      stationNaqi = null;
    }
  }
  return { status: "ok", source: base.source, stations, radiusKm, stationNaqi, note: base.note, fetchedAt };
}

/** Station popup detail (WAQI only); null when WAQI is not configured. */
export async function getStationDetail(id: string): Promise<WaqiStationDetail | null> {
  const token = key("WAQI_TOKEN");
  if (!token) return null;
  const uid = Number(id.replace(/^waqi-/, ""));
  return getWaqiStationDetail(uid, token);
}
