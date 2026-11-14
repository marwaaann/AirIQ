/**
 * Normalising station lists for the nearby lookup (/api/stations?lat&lon).
 * Pure module (relative imports only) so it runs under `node --test`.
 */

import type { Bounds } from "./grid.ts";
import { haversineKm, type NearbyStation } from "./headline-source.ts";
import type { Station } from "../types/air.ts";

/** Most stations returned by the nearby lookup (sorted by distance). */
export const MAX_NEARBY_STATIONS = 40;

/** Bounding box around a point, snapped outward to 0.1° so nearby lookups share upstream cache entries. */
export function boxAround(lat: number, lon: number, radiusKm: number): Bounds {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const down = (v: number) => Math.floor(v * 10) / 10;
  const up = (v: number) => Math.ceil(v * 10) / 10;
  return {
    south: Math.max(-90, down(lat - dLat)),
    north: Math.min(90, up(lat + dLat)),
    west: Math.max(-180, down(lon - dLon)),
    east: Math.min(180, up(lon + dLon)),
  };
}

/** Station → NearbyStation with its distance from (lat, lon), rounded to 0.1 km. */
export function toNearby(s: Station, lat: number, lon: number): NearbyStation {
  return {
    id: s.id,
    name: s.name,
    source: s.source,
    aqi: s.aqi,
    aqiBasis: s.aqiBasis,
    latitude: s.latitude,
    longitude: s.longitude,
    distanceKm: Math.round(haversineKm(lat, lon, s.latitude, s.longitude) * 10) / 10,
    observedAt: s.updatedAt,
    url: s.url,
  };
}

/** Stations within `radiusKm`, nearest first, capped. */
export function nearbyList(stations: readonly Station[], lat: number, lon: number, radiusKm: number, max = MAX_NEARBY_STATIONS): NearbyStation[] {
  return stations
    .map((s) => toNearby(s, lat, lon))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, max);
}
