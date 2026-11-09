"use client";

import useSWR from "swr";

import { apiFetch } from "@/lib/fetcher";
import { createStoredValue, useStoredValue } from "@/lib/storage";
import type { AirResponse } from "@/types/api";
import { SavedCitySchema, type SavedCity } from "@/types/city";

/** Refresh live readings every 10 minutes (matches the server cache window). */
export const AIR_REFRESH_MS = 10 * 60 * 1000;

const activeCityStore = createStoredValue<SavedCity | null>("airiq:active-city", SavedCitySchema.nullable(), null);

/** The most recently opened city, shared across pages. */
export function useActiveCity(): [SavedCity | null, (c: SavedCity | null) => void] {
  return useStoredValue(activeCityStore);
}

export function airUrl(latitude: number, longitude: number): string {
  return `/api/air?lat=${latitude.toFixed(3)}&lon=${longitude.toFixed(3)}`;
}

/** Live air quality for a coordinate via /api/air, auto-refreshing. */
export function useAir(latitude: number | null, longitude: number | null) {
  const key = latitude !== null && longitude !== null ? airUrl(latitude, longitude) : null;
  return useSWR<AirResponse, Error>(key, apiFetch, {
    refreshInterval: AIR_REFRESH_MS,
    revalidateOnFocus: false,
    keepPreviousData: true,
    errorRetryCount: 2,
  });
}
