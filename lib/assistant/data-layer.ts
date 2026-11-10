import "server-only";

import { geocode, getAirSeries, getCurrentAir, getSunTimes } from "@/lib/openmeteo";
import type { AssistantDataLayer } from "@/lib/assistant/tools";

/** The real data layer: the same Open-Meteo functions the rest of the app uses (no HTTP round-trip). */
export const liveDataLayer: AssistantDataLayer = {
  geocode: (q, count) => geocode(q, count),
  currentAir: (lat, lon) => getCurrentAir(lat, lon),
  airSeries: (lat, lon, pastDays, forecastDays) => getAirSeries(lat, lon, pastDays, forecastDays),
  sunTimes: (lat, lon) => getSunTimes(lat, lon, 3),
  now: () => Date.now(),
};
