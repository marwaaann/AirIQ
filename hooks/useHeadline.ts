"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { AIR_REFRESH_MS, useAir } from "@/hooks/useCity";
import { useDataSource } from "@/hooks/useDataSource";
import { useNow } from "@/hooks/useNow";
import { currentIndex } from "@/lib/aqi-display";
import { apiFetch } from "@/lib/fetcher";
import { HEADLINE_RADIUS_KM, selectHeadline, type DataSourceMode, type HeadlineSource, type StationFeedStatus } from "@/lib/headline-source";
import { staleMetaOf } from "@/lib/stale";
import type { AqiScale } from "@/types/air";
import type { AirResponse, NearbyStationsResponse } from "@/types/api";

/** Same key everywhere so SWR shares one request per city. */
export function nearbyStationsUrl(lat: number, lon: number): string {
  return `/api/stations?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&radius=${HEADLINE_RADIUS_KM}`;
}

/** Ground stations within 15 km (refreshes with the air reading, every 10 minutes). */
export function useNearbyStations(lat: number | null, lon: number | null) {
  const key = lat !== null && lon !== null ? nearbyStationsUrl(lat, lon) : null;
  return useSWR<NearbyStationsResponse, Error>(key, apiFetch, {
    refreshInterval: AIR_REFRESH_MS,
    revalidateOnFocus: false,
    keepPreviousData: true,
    errorRetryCount: 1,
  });
}

/** Pure combination used by the hook, alert engine and compare cards. */
export function computeHeadline(
  air: AirResponse,
  near: NearbyStationsResponse | undefined,
  nearError: unknown,
  scale: AqiScale,
  mode: DataSourceMode,
  now: number,
): HeadlineSource {
  // Offline copies of station data are not "fresh" observations: never let them drive the headline.
  const stale = near ? staleMetaOf(near).isStale : false;
  const status: StationFeedStatus = near && !stale ? near.status : nearError || stale ? "error" : "loading";
  return selectHeadline({
    scale,
    mode,
    now,
    model: { value: currentIndex(air.current, scale), usAqi: air.current.usAqi, time: air.current.time },
    stations: near && !stale ? near.stations : [],
    stationStatus: status,
    stationNaqi: near && !stale ? near.stationNaqi : null,
  });
}

/**
 * The headline in effect for a city: the model reading (/api/air) combined
 * with nearby stations (/api/stations?lat&lon) under the user's data-source
 * setting. Every view that shows "the" AQI for a city uses this.
 */
export function useHeadline(lat: number, lon: number, scale: AqiScale) {
  const air = useAir(lat, lon);
  const near = useNearbyStations(lat, lon);
  const [mode] = useDataSource();
  const now = useNow(60_000);
  const headline = useMemo(
    () => (air.data ? computeHeadline(air.data, near.data, near.error, scale, mode, now) : null),
    [air.data, near.data, near.error, scale, mode, now],
  );
  return { air, near, headline, mode };
}
