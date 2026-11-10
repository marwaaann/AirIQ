"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { CategorySwatch } from "@/components/CategoryBadge";
import { ErrorState, Skeleton } from "@/components/states";
import { StaleNotice } from "@/components/StaleNotice";
import { FORECAST_REFRESH_MS, forecastUrl } from "@/hooks/useCity";
import { useProfile } from "@/hooks/useProfile";
import { getCategory } from "@/lib/aqi-categories";
import { apiFetch, errorMessage } from "@/lib/fetcher";
import { findSafeWindows, type SafeWindow, type WindowActivity } from "@/lib/safe-windows";
import { staleMetaOf } from "@/lib/stale";
import type { AqiScale } from "@/types/air";
import type { ForecastResponse } from "@/types/api";

const ACTIVITIES: { id: WindowActivity; label: string }[] = [
  { id: "walk", label: "Walk" },
  { id: "exercise", label: "Exercise" },
  { id: "windows", label: "Open windows" },
];
const DURATIONS = [1, 2, 3] as const;

function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-xs font-medium text-muted">{label}</legend>
      <div className="inline-flex flex-wrap gap-1">
        {options.map((o) => (
          <label
            key={String(o.id)}
            className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-medium focus-within:outline focus-within:outline-2 focus-within:outline-[var(--focus)] ${
              value === o.id ? "border-text bg-text text-bg" : "border-border bg-surface hover:bg-surface-2"
            }`}
          >
            <input type="radio" className="sr-only" name={label} checked={value === o.id} onChange={() => onChange(o.id)} />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function WindowList({ windows, scale, unit }: { windows: SafeWindow[]; scale: AqiScale; unit: string }) {
  return (
    <ol className="flex flex-col gap-2">
      {windows.map((w) => {
        const worst = getCategory(w.max, scale);
        return (
          <li key={w.start} className="flex flex-wrap items-center gap-2 text-sm">
            <CategorySwatch category={worst} />
            <span className="font-semibold">{w.label}</span>
            <span className="text-muted">
              {unit} {Math.round(w.min)}–{Math.round(w.max)} · {worst.label} at worst · {w.hours} h
              {w.daylight !== null && w.daylight < 1 ? ` · ${Math.round(w.daylight * 100)}% daylight` : ""}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Safe outdoor windows over the next 48 h of the OFFICIAL forecast. */
export function WindowFinder({ lat, lon, scale }: { lat: number; lon: number; scale: AqiScale }) {
  const [profile] = useProfile();
  const [activity, setActivity] = useState<WindowActivity>("walk");
  const [minHours, setMinHours] = useState<1 | 2 | 3>(2);
  const [daylightOnly, setDaylightOnly] = useState(false);
  const { data, error, isLoading, isValidating, mutate } = useSWR<ForecastResponse, Error>(forecastUrl(lat, lon), apiFetch, {
    revalidateOnFocus: false,
    refreshInterval: FORECAST_REFRESH_MS,
    keepPreviousData: true,
  });
  const threshold = profile.defaultThreshold[scale];
  const unit = scale === "us" ? "US AQI" : "EU AQI";

  const result = useMemo(() => {
    if (!data) return null;
    return findSafeWindows({
      points: data.official.points.map((p) => ({ time: p.time, value: scale === "us" ? p.usAqi : p.euAqi })),
      threshold,
      timeZone: data.official.timezone,
      activity,
      minHours,
      now: Date.parse(data.now) + 1,
      daylightOnly: activity === "exercise" && daylightOnly,
      sun: data.sun,
    });
  }, [data, scale, threshold, activity, minHours, daylightOnly]);

  return (
    <section aria-labelledby="window-finder-title" className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
      <div>
        <h3 id="window-finder-title" className="font-semibold">
          Safe times outside (next 48 h)
        </h3>
        <p className="text-xs text-muted">
          From the official forecast (CAMS via Open-Meteo). Your threshold: {unit} at or below {threshold} ({profile.label} profile). Times are local to the
          city.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <Segmented label="Activity" options={ACTIVITIES} value={activity} onChange={setActivity} />
        <Segmented
          label="At least"
          options={DURATIONS.map((d) => ({ id: d, label: `${d} h` }))}
          value={minHours}
          onChange={(v) => setMinHours(v as 1 | 2 | 3)}
        />
        <label className={`flex items-center gap-2 self-end text-sm ${activity !== "exercise" || !data?.sun ? "opacity-50" : ""}`}>
          <input
            type="checkbox"
            checked={daylightOnly}
            disabled={activity !== "exercise" || !data?.sun}
            onChange={(e) => setDaylightOnly(e.target.checked)}
            className="h-4 w-4 accent-[var(--brand)]"
          />
          Daylight only
          <span className="text-xs text-muted">{data && !data.sun ? "(sunrise data unavailable)" : "(exercise)"}</span>
        </label>
      </div>

      {data ? <StaleNotice compact meta={staleMetaOf(data)} timeZone={data.official.timezone} onRetry={() => void mutate()} retrying={isValidating} /> : null}
      {error && !data ? (
        <ErrorState compact title="Couldn't load the forecast" message={errorMessage(error)} onRetry={() => void mutate()} retrying={isValidating} />
      ) : isLoading && !data ? (
        <Skeleton className="h-24" label="Loading forecast" />
      ) : !result || result.status === "no-data" ? (
        <p className="text-sm text-muted">The forecast has no values for the next 48 hours.</p>
      ) : result.status === "ok" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm">
            {result.mode === "lowest"
              ? "Cleanest times to air out your home (lowest forecast AQI):"
              : `Times when the forecast stays at or below ${threshold}:`}
          </p>
          <WindowList windows={result.windows} scale={scale} unit={unit} />
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-danger">
            No {minHours}-hour window in the next 48 h stays at or below {threshold}
            {activity === "exercise" && daylightOnly ? " during daylight" : ""}.
          </p>
          {result.leastBad.length ? (
            <>
              <p className="text-sm">Least-bad times (still above your threshold):</p>
              <WindowList windows={result.leastBad} scale={scale} unit={unit} />
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
