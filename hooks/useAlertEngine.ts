"use client";

import { useEffect, useMemo, useState } from "react";
import { useSWRConfig } from "swr";

import { CHECK_ALERTS_EVENT, eventsStore, ruleStatesStore, rulesStore } from "@/lib/alert-store";
import { appendEvents, evaluateCityRules, type AlertEvent, type AlertRule, type ReadingSource } from "@/lib/alerts";
import { sourceLabel, type DataSourceMode } from "@/lib/headline-source";
import { staleMetaOf } from "@/lib/stale";
import { useStoredValue } from "@/lib/storage";
import { airUrl, forecastUrl } from "@/hooks/useCity";
import { computeHeadline, nearbyStationsUrl } from "@/hooks/useHeadline";
import type { AirResponse, ForecastResponse, NearbyStationsResponse } from "@/types/api";

export const ALERT_RECHECK_MS = 10 * 60 * 1000;

export interface CityGroup {
  key: string;
  latitude: number;
  longitude: number;
  rules: AlertRule[];
  needsForecast: boolean;
}

/**
 * Groups enabled rules by city and produces a `tick` that changes every 10
 * minutes, when the tab becomes visible again, and on "Check now". Alerts
 * only run while a tab is open: there is no server push.
 */
export function useAlertEngine(): { cities: CityGroup[]; tick: number } {
  const [rules] = useStoredValue(rulesStore);
  const [tick, setTick] = useState(0);
  const { mutate } = useSWRConfig();

  const cities = useMemo(() => {
    const by = new Map<string, CityGroup>();
    for (const r of rules) {
      if (!r.enabled) continue;
      const key = `${r.city.latitude.toFixed(3)},${r.city.longitude.toFixed(3)}`;
      const g = by.get(key) ?? { key, latitude: r.city.latitude, longitude: r.city.longitude, rules: [], needsForecast: false };
      g.rules.push(r);
      g.needsForecast ||= r.trigger.type === "forecast";
      by.set(key, g);
    }
    return [...by.values()];
  }, [rules]);

  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    const interval = setInterval(bump, ALERT_RECHECK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    const onCheck = () => {
      for (const c of cities) {
        void mutate(airUrl(c.latitude, c.longitude));
        void mutate(nearbyStationsUrl(c.latitude, c.longitude));
        if (c.needsForecast) void mutate(forecastUrl(c.latitude, c.longitude));
      }
      bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(CHECK_ALERTS_EVENT, onCheck);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(CHECK_ALERTS_EVENT, onCheck);
    };
  }, [cities, mutate]);

  return { cities, tick };
}

/**
 * The reading a "current" rule is checked against: the headline in effect on
 * each scale (station median / nearest station / model, under the user's
 * data-source setting). Station data older than 3 hours is ignored by the
 * headline selection, so a stale feed falls back to the model; the label of
 * whichever source was used is recorded on the event.
 */
export function readingFor(air: AirResponse, near: NearbyStationsResponse | undefined, nearError: unknown, mode: DataSourceMode, now: number): ReadingSource {
  const us = computeHeadline(air, near, nearError, "us", mode, now);
  const inn = computeHeadline(air, near, nearError, "in", mode, now);
  const eu = computeHeadline(air, near, nearError, "eu", mode, now);
  return {
    time: us.observedAt ?? air.current.time,
    usAqi: us.value,
    euAqi: eu.value,
    inAqi: inn.value,
    usSubIndices: air.current.usSubIndices,
    euSubIndices: air.current.euSubIndices,
    inSubIndices: air.current.inSubIndices,
    sourceLabels: { us: sourceLabel(us), eu: sourceLabel(eu), in: sourceLabel(inn) },
  };
}

/**
 * Evaluate a city's rules against its latest data. State is read and written
 * through the store's functional update, so repeated or concurrent runs never
 * fire the same episode twice. Returns the NEW events only.
 *
 * Data served from the service worker's offline cache is never evaluated:
 * nothing fires and nothing is recorded until fresh data arrives.
 */
export function evaluateCity(
  rules: readonly AlertRule[],
  air: AirResponse | undefined,
  forecast: ForecastResponse | undefined,
  now: number,
  near?: NearbyStationsResponse,
  nearError?: unknown,
  mode: DataSourceMode = "auto",
): AlertEvent[] {
  const stale = staleMetaOf(air).isStale || staleMetaOf(forecast).isStale;
  if (stale) return [];
  const current: ReadingSource | null = air ? readingFor(air, near, nearError, mode, now) : null;
  const points = forecast?.official.points ?? null;
  let fresh: AlertEvent[] = [];
  ruleStatesStore.set((prev) => {
    const res = evaluateCityRules(rules, current, points, now, prev, stale);
    fresh = res.events;
    return res.states ?? prev;
  });
  if (fresh.length) eventsStore.set((prev) => appendEvents(prev, fresh));
  return fresh;
}
