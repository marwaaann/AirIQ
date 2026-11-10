"use client";

import useSWR from "swr";

import { FORECAST_REFRESH_MS, forecastUrl, historyUrl, useAir } from "@/hooks/useCity";
import { apiFetch } from "@/lib/fetcher";
import { parseCitySlug, prettifySlugName } from "@/lib/slug";
import type { ForecastResponse, HistoryResponse } from "@/types/api";

export interface CompareCityRef {
  slug: string;
  name: string;
  latitude: number;
  longitude: number;
}

export function compareCityFromSlug(slug: string, knownName?: string): CompareCityRef | null {
  const p = parseCitySlug(slug);
  if (!p) return null;
  return { slug, name: knownName ?? prettifySlugName(p.name), latitude: p.latitude, longitude: p.longitude };
}

/** Current, history and forecast for one compared city. Each request fails independently. */
export function useCompareCity(city: CompareCityRef | null, range: 7 | 30 | 90) {
  const air = useAir(city?.latitude ?? null, city?.longitude ?? null);
  const history = useSWR<HistoryResponse, Error>(city ? historyUrl(city.latitude, city.longitude, range) : null, apiFetch, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });
  const forecast = useSWR<ForecastResponse, Error>(city ? forecastUrl(city.latitude, city.longitude) : null, apiFetch, {
    revalidateOnFocus: false,
    refreshInterval: FORECAST_REFRESH_MS,
  });
  return { city, air, history, forecast };
}

export type CompareCityData = ReturnType<typeof useCompareCity>;
