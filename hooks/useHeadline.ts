"use client";

import { useEffect, useMemo } from "react";
import useSWR from "swr";

import { AIR_REFRESH_MS, useAir } from "@/hooks/useCity";
import { useDataSource } from "@/hooks/useDataSource";
import { useNow } from "@/hooks/useNow";
import { currentIndex } from "@/lib/aqi-display";
import { ABORTED_STATUS, ApiClientError, apiFetch } from "@/lib/fetcher";
import { HEADLINE_RADIUS_KM, selectHeadline, type DataSourceMode, type HeadlineSource, type StationFeedStatus } from "@/lib/headline-source";
import { staleMetaOf } from "@/lib/stale";
import type { StationNaqiSummary } from "@/lib/station-naqi";
import type { AqiScale } from "@/types/air";
import type { AirResponse, NearbyStationsResponse, StationNaqiResponse } from "@/types/api";

/** Same key everywhere so SWR shares one request per city. */
export function nearbyStationsUrl(lat: number, lon: number): string {
  return `/api/stations?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&radius=${HEADLINE_RADIUS_KM}`;
}

export function stationNaqiUrl(lat: number, lon: number): string {
  return `/api/station-naqi?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
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

/*
 * Cancelling stale station-NAQI requests: the OpenAQ lookup can take several
 * seconds, so when no component uses a city's request any more (the user
 * moved to another city or scale) it is aborted, and the server starts no
 * further upstream calls for it. Reference-counted per URL because SWR
 * shares one request between every component showing that city.
 */
const inflight = new Map<string, { ctrl: AbortController; users: number }>();

function entry(url: string) {
  let e = inflight.get(url);
  if (!e || e.ctrl.signal.aborted) {
    e = { ctrl: new AbortController(), users: e?.users ?? 0 };
    inflight.set(url, e);
  }
  return e;
}

function stationNaqiFetcher(url: string) {
  return apiFetch<StationNaqiResponse>(url, entry(url).ctrl.signal);
}

function retain(url: string) {
  entry(url).users++;
}

function release(url: string) {
  const e = inflight.get(url);
  if (!e) return;
  e.users--;
  // Next tick, so a re-render that releases and retains the same URL keeps the request.
  setTimeout(() => {
    const cur = inflight.get(url);
    if (cur === e && e.users <= 0) {
      e.ctrl.abort();
      inflight.delete(url);
    }
  }, 0);
}

/** India NAQI from station concentrations (OpenAQ). Fetched only when `enabled` (the NAQI scale is in use). */
const STATION_NAQI_ERROR_RETRY_MS = 75_000;

export function useStationNaqi(lat: number | null, lon: number | null, enabled: boolean) {
  const key = enabled && lat !== null && lon !== null ? stationNaqiUrl(lat, lon) : null;
  useEffect(() => {
    if (!key) return;
    retain(key);
    return () => release(key);
  }, [key]);
  return useSWR<StationNaqiResponse, Error>(key, stationNaqiFetcher, {
    // An "error" summary is usually OpenAQ's per-minute limit: try again after it resets.
    refreshInterval: (data) => (data?.status === "error" ? STATION_NAQI_ERROR_RETRY_MS : AIR_REFRESH_MS),
    revalidateOnFocus: false,
    keepPreviousData: false,
    errorRetryCount: 1,
  });
}

const unavailable = (status: "error", note: string): StationNaqiSummary => ({
  status,
  method: null,
  value: null,
  count: 0,
  checked: 0,
  median: null,
  nearest: null,
  highest: null,
  latestObservedAt: null,
  note,
});

/** What the headline gets for station NAQI: the summary, an "error" summary, or null while loading / not requested. */
export function stationNaqiInput(scale: AqiScale, data: StationNaqiResponse | undefined, error: unknown): StationNaqiSummary | null {
  if (scale !== "in") return null;
  if (data) {
    // Offline copies are not current observations.
    return staleMetaOf(data).isStale ? unavailable("error", "this is an offline copy, not a current reading.") : data;
  }
  if (error && !(error instanceof ApiClientError && error.status === ABORTED_STATUS)) {
    return unavailable("error", "the station concentration feed could not be reached.");
  }
  return null;
}

/** Pure combination used by the hook, alert engine, compare cards and report. */
export function computeHeadline(
  air: AirResponse,
  near: NearbyStationsResponse | undefined,
  nearError: unknown,
  scale: AqiScale,
  mode: DataSourceMode,
  now: number,
  naqi?: { data?: StationNaqiResponse; error?: unknown },
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
    stationNaqi: stationNaqiInput(scale, naqi?.data, naqi?.error),
  });
}

/**
 * The headline in effect for a city: the model reading (/api/air) combined
 * with nearby stations (/api/stations?lat&lon) and, on the NAQI scale,
 * station-based NAQI (/api/station-naqi) under the user's data-source
 * setting. Every view that shows "the" AQI for a city uses this.
 */
export function useHeadline(lat: number, lon: number, scale: AqiScale) {
  const air = useAir(lat, lon);
  const near = useNearbyStations(lat, lon);
  const [mode] = useDataSource();
  const naqi = useStationNaqi(lat, lon, scale === "in" && mode !== "model");
  const now = useNow(60_000);
  const headline = useMemo(
    () => (air.data ? computeHeadline(air.data, near.data, near.error, scale, mode, now, { data: naqi.data, error: naqi.error }) : null),
    [air.data, near.data, near.error, scale, mode, now, naqi.data, naqi.error],
  );
  return { air, near, naqi, headline, mode };
}
