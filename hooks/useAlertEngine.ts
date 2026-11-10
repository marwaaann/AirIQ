"use client";

import { useEffect, useMemo, useState } from "react";
import { useSWRConfig } from "swr";

import { CHECK_ALERTS_EVENT, eventsStore, ruleStatesStore, rulesStore } from "@/lib/alert-store";
import { appendEvents, evaluateRule, INITIAL_STATE, type AlertEvent, type AlertRule, type ReadingSource } from "@/lib/alerts";
import { useStoredValue } from "@/lib/storage";
import { airUrl, forecastUrl } from "@/hooks/useCity";
import type { AirResponse, ForecastResponse } from "@/types/api";

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
 * Evaluate a city's rules against its latest data. State is read and written
 * through the store's functional update, so repeated or concurrent runs never
 * fire the same episode twice. Returns the NEW events only.
 */
export function evaluateCity(rules: readonly AlertRule[], air: AirResponse | undefined, forecast: ForecastResponse | undefined, now: number): AlertEvent[] {
  const current: ReadingSource | null = air
    ? {
        time: air.current.time,
        usAqi: air.current.usAqi,
        euAqi: air.current.euAqi,
        usSubIndices: air.current.usSubIndices,
        euSubIndices: air.current.euSubIndices,
      }
    : null;
  const points = forecast?.official.points ?? null;
  const fresh: AlertEvent[] = [];
  ruleStatesStore.set((prev) => {
    const next = { ...prev };
    for (const rule of rules) {
      const res = evaluateRule(rule, current, points, now, prev[rule.id] ?? INITIAL_STATE);
      next[rule.id] = res.state;
      fresh.push(...res.events);
    }
    return next;
  });
  if (fresh.length) eventsStore.set((prev) => appendEvents(prev, fresh));
  return fresh;
}
