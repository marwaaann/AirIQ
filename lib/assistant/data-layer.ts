import "server-only";

import { geocode, getAirSeries, getCurrentAir, getSunTimes } from "@/lib/openmeteo";
import { getNearbyStations } from "@/lib/stations";
import { HEADLINE_RADIUS_KM } from "@/lib/headline-source";
import type { AssistantDataLayer } from "@/lib/assistant/tools";

/** The real data layer: the same functions the rest of the app uses (no HTTP round-trip). */
export const liveDataLayer: AssistantDataLayer = {
  geocode: (q, count) => geocode(q, count),
  currentAir: (lat, lon) => getCurrentAir(lat, lon),
  airSeries: (lat, lon, pastDays, forecastDays) => getAirSeries(lat, lon, pastDays, forecastDays),
  sunTimes: (lat, lon) => getSunTimes(lat, lon, 3),
  nearbyStations: (lat, lon) => getNearbyStations(lat, lon, HEADLINE_RADIUS_KM),
  now: () => Date.now(),
};
