"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import useSWR from "swr";

import { AlertIcon } from "@/components/icons";
import { AIR_REFRESH_MS, airUrl, FORECAST_REFRESH_MS, forecastUrl } from "@/hooks/useCity";
import { evaluateCity, useAlertEngine, type CityGroup } from "@/hooks/useAlertEngine";
import { dataSourceStore } from "@/hooks/useDataSource";
import { useNearbyStations } from "@/hooks/useHeadline";
import { useStoredValue } from "@/lib/storage";
import { showBrowserNotification } from "@/hooks/useNotificationPermission";
import { apiFetch } from "@/lib/fetcher";
import { dismissToast, pushToast, useToasts } from "@/lib/toast-store";
import type { AirResponse, ForecastResponse } from "@/types/api";

/** Fetches one city's data (shared with the rest of the app via SWR) and evaluates its rules. */
function CityWatcher({ group, tick }: { group: CityGroup; tick: number }) {
  const router = useRouter();
  const air = useSWR<AirResponse, Error>(airUrl(group.latitude, group.longitude), apiFetch, {
    refreshInterval: AIR_REFRESH_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
  const forecast = useSWR<ForecastResponse, Error>(group.needsForecast ? forecastUrl(group.latitude, group.longitude) : null, apiFetch, {
    refreshInterval: FORECAST_REFRESH_MS,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });
  // Stations decide the headline (Auto mode), so wait until the station request has settled.
  const near = useNearbyStations(group.latitude, group.longitude);
  const [mode] = useStoredValue(dataSourceStore);
  const stationsSettled = near.data !== undefined || near.error !== undefined || mode === "model";
  const rulesSig = useMemo(() => JSON.stringify(group.rules), [group.rules]);

  useEffect(() => {
    if (!air.data && !forecast.data) return;
    if (!stationsSettled) return;
    const rules = JSON.parse(rulesSig) as CityGroup["rules"];
    const events = evaluateCity(rules, air.data, forecast.data, Date.now(), near.data, near.error, mode);
    for (const ev of events) {
      const href = `/city/${ev.citySlug}`;
      pushToast({
        id: ev.id,
        title: ev.suppressed ? `${ev.title} (quiet hours)` : ev.title,
        body: ev.message,
        href,
        tone: "alert",
      });
      if (!ev.suppressed) void showBrowserNotification(ev.title, ev.message, ev.id, href, () => router.push(href));
    }
  }, [air.data, forecast.data, near.data, near.error, stationsSettled, mode, tick, rulesSig, router]);

  return null;
}

function Toaster() {
  const toasts = useToasts();
  useEffect(() => {
    if (!toasts.length) return;
    const timers = toasts.map((t) => setTimeout(() => dismissToast(t.id), 12_000));
    return () => timers.forEach(clearTimeout);
  }, [toasts]);
  return (
    <div
      role="region"
      aria-label="Notifications"
      className="pointer-events-none fixed inset-x-2 bottom-2 z-[2000] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-4 sm:w-96"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex w-full gap-3 rounded-xl border border-border bg-surface p-3 text-sm shadow-xl"
          data-toast={t.id}
        >
          <AlertIcon size={18} className={`mt-0.5 shrink-0 ${t.tone === "alert" ? "text-danger" : "text-brand"}`} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t.title}</p>
            <p className="text-muted">{t.body}</p>
            {t.href ? (
              <Link href={t.href} className="text-xs font-semibold text-brand underline underline-offset-2" onClick={() => dismissToast(t.id)}>
                Open city
              </Link>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss notification"
            className="h-7 w-7 shrink-0 rounded-md text-muted hover:bg-surface-2 hover:text-text"
          >
            <span aria-hidden>✕</span>
          </button>
        </div>
      ))}
    </div>
  );
}

/** Mounted once in the root layout. Runs only while a tab is open. */
export function AlertRuntime() {
  const { cities, tick } = useAlertEngine();
  return (
    <>
      {cities.map((g) => (
        <CityWatcher key={g.key} group={g} tick={tick} />
      ))}
      <Toaster />
    </>
  );
}
