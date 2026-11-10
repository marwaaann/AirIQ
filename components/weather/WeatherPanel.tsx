"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";

import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { StaleNotice } from "@/components/StaleNotice";
import { WeatherScatter } from "@/components/weather/WeatherScatter";
import { WindRose } from "@/components/weather/WindRose";
import { useUrlParam } from "@/hooks/useUrlParam";
import { apiFetch, errorMessage } from "@/lib/fetcher";
import { combineStale, staleMetaOf } from "@/lib/stale";
import { datesEnding, localParts } from "@/lib/time";
import {
  MIN_HOURS_PER_DAY,
  MIN_INSIGHT_DAYS,
  MIN_RAIN_GROUP_DAYS,
  RAIN_DAY_MM,
  WEATHER_VARS,
  WEATHER_VAR_INFO,
  alignHours,
  correlations,
  dailyPairs,
  formatR,
  rainComparison,
  weatherInsights,
  windRose,
  type WeatherVar,
} from "@/lib/weather-stats";
import type { HistoryResponse, WeatherResponseBody } from "@/types/api";

const RANGES = ["7", "30", "90"] as const;
type RangeParam = (typeof RANGES)[number];

const STRENGTH_CLASS = { weak: "text-muted", moderate: "", strong: "font-semibold" } as const;

/** Weather tab: how PM2.5 has moved with local weather, from real hourly data. */
export default function WeatherPanel({ lat, lon }: { lat: number; lon: number }) {
  const [rangeParam, setRange] = useUrlParam<RangeParam>("range", RANGES, "7");
  const range = Number(rangeParam) as 7 | 30 | 90;
  const [variable, setVariable] = useState<WeatherVar>("windSpeed");
  const q = `lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&days=${range}`;
  const swrOpts = { revalidateOnFocus: false, keepPreviousData: true } as const;
  const air = useSWR<HistoryResponse, Error>(`/api/history?${q}`, apiFetch, swrOpts);
  const wx = useSWR<WeatherResponseBody, Error>(`/api/weather?${q}`, apiFetch, swrOpts);

  const computed = useMemo(() => {
    if (!air.data || !wx.data) return null;
    const tz = air.data.series.timezone;
    const pts = air.data.series.points;
    const endDate = pts.length ? localParts(pts[pts.length - 1].time, tz).date : localParts(air.data.fetchedAt, tz).date;
    const inRange = new Set(datesEnding(endDate, range));
    const aligned = alignHours(
      pts.map((p) => ({ time: p.time, pm25: p.pollutants.pm2_5 })),
      wx.data.weather.points,
      tz,
    );
    const hours = aligned.hours.filter((h) => inRange.has(h.date));
    const pmInRange = pts.filter((p) => inRange.has(localParts(p.time, tz).date) && p.pollutants.pm2_5 !== null).length;
    const cors = correlations(hours);
    const precipPairs = dailyPairs(hours, "precipitation");
    return {
      tz,
      hours,
      pmInRange,
      cors,
      insights: weatherInsights(cors),
      rose: windRose(hours),
      rain: rainComparison(precipPairs),
      precipDays: precipPairs.length,
      maxDays: Math.max(0, ...cors.map((c) => c.days)),
    };
  }, [air.data, wx.data, range]);

  const pairs = useMemo(() => (computed ? dailyPairs(computed.hours, variable) : []), [computed, variable]);
  const error = air.error ?? wx.error;
  const loading = (air.isLoading && !air.data) || (wx.isLoading && !wx.data);
  const retry = () => {
    void air.mutate();
    void wx.mutate();
  };

  return (
    <section aria-labelledby="weather-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="weather-title" className="text-lg font-semibold">
            Weather and PM2.5
          </h2>
          <p className="text-xs text-muted">PM2.5 in µg/m³ (scale-independent). Daily values per local day.</p>
        </div>
        <div role="radiogroup" aria-label="Weather range" className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
          {RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={rangeParam === r}
              data-range={r}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1.5 font-medium ${rangeParam === r ? "bg-text text-bg" : "text-muted hover:text-text"}`}
            >
              {r} days
            </button>
          ))}
        </div>
      </div>

      {error && !computed ? (
        <ErrorState
          title={wx.error ? "Couldn't load weather data" : "Couldn't load PM2.5 history"}
          message={errorMessage(error)}
          onRetry={retry}
          retrying={air.isValidating || wx.isValidating}
        />
      ) : loading || !computed ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-28 rounded-2xl" label="Loading weather analysis" />
          <Skeleton className="h-72 rounded-2xl" />
        </div>
      ) : computed.hours.length === 0 ? (
        <EmptyState title="No overlapping data">Open-Meteo returned no hours with both PM2.5 and weather for this period.</EmptyState>
      ) : (
        <div className={`flex flex-col gap-5 ${air.isValidating || wx.isValidating ? "opacity-80" : ""}`} data-testid="weather-analysis">
          <StaleNotice
            meta={combineStale(staleMetaOf(air.data), staleMetaOf(wx.data))}
            timeZone={computed.tz}
            onRetry={retry}
            retrying={air.isValidating || wx.isValidating}
          />
          {error ? <ErrorState compact title="Refresh failed, showing the last loaded data" message={errorMessage(error)} onRetry={retry} /> : null}

          <p className="text-sm text-muted" data-testid="weather-n">
            <strong className="text-text">{computed.hours.length}</strong> hours have both PM2.5 and weather (of {computed.pmInRange} PM2.5 hours in the last {range} days;
            hours missing either are left out). Daily correlations use days with at least {MIN_HOURS_PER_DAY} paired hours.
            {computed.maxDays < range - 1 ? ` Open-Meteo's archive covered ${computed.maxDays} full days of this period.` : ""}
          </p>

          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 text-sm" data-testid="weather-insights">
            <h3 className="font-semibold">What the data shows</h3>
            <ul className="flex flex-col gap-1">
              {computed.insights.map((line) => (
                <li key={line} className={line.startsWith("Correlation does not") ? "text-xs text-muted" : "flex gap-2"}>
                  {line.startsWith("Correlation does not") ? null : (
                    <span aria-hidden className="text-brand">
                      ●
                    </span>
                  )}
                  {line}
                </li>
              ))}
            </ul>
            {computed.maxDays < MIN_INSIGHT_DAYS ? (
              <p className="text-xs text-muted">Statements need at least {MIN_INSIGHT_DAYS} days of data; choose 30 or 90 days for more.</p>
            ) : null}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-surface p-4">
            <table className="w-full min-w-[28rem] text-left text-sm">
              <caption className="mb-2 text-left font-semibold">Spearman correlation with daily mean PM2.5</caption>
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1 font-medium">
                    Variable
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    r
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Strength
                  </th>
                  <th scope="col" className="py-1 font-medium">
                    Days (n)
                  </th>
                </tr>
              </thead>
              <tbody>
                {computed.cors.map((c) => (
                  <tr key={c.variable} className="border-t border-border" data-var={c.variable}>
                    <th scope="row" className="py-1.5 font-normal">
                      <button type="button" onClick={() => setVariable(c.variable)} className={`text-left hover:underline ${variable === c.variable ? "font-semibold" : ""}`}>
                        {WEATHER_VAR_INFO[c.variable].label}
                      </button>
                    </th>
                    <td className="py-1.5 font-mono">{c.r !== undefined ? formatR(c.r) : "n/a"}</td>
                    <td className={`py-1.5 ${c.strength ? STRENGTH_CLASS[c.strength] : "text-muted"}`}>{c.strength ?? (c.days < 3 ? "too few days" : "no variation")}</td>
                    <td className="py-1.5">{c.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">|r| &lt; 0.2 weak · 0.2–0.5 moderate · &gt; 0.5 strong. No significance test is applied; small n makes r unstable.</p>
          </div>

          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">PM2.5 vs {WEATHER_VAR_INFO[variable].label.toLowerCase()}</h3>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Variable</span>
                <select
                  value={variable}
                  onChange={(e) => setVariable(e.target.value as WeatherVar)}
                  className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                  data-testid="weather-var"
                >
                  {WEATHER_VARS.map((v) => (
                    <option key={v} value={v}>
                      {WEATHER_VAR_INFO[v].label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {pairs.length >= 3 ? (
              <WeatherScatter pairs={pairs} variable={variable} correlation={computed.cors.find((c) => c.variable === variable)} />
            ) : (
              <p className="text-sm text-muted">Only {pairs.length} days have enough paired hours for this variable; a scatter plot needs at least 3.</p>
            )}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
              <h3 className="font-semibold">PM2.5 by wind direction</h3>
              <WindRose rose={computed.rose} />
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4" data-testid="rain-comparison">
              <h3 className="font-semibold">Dry days vs rain days</h3>
              {computed.rain ? (
                <>
                  <dl className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-surface-2 p-3">
                      <dt className="text-xs text-muted">Dry days (&lt; {RAIN_DAY_MM} mm)</dt>
                      <dd className="text-2xl font-semibold">
                        {computed.rain.dry.meanPm25.toFixed(1)} <span className="text-sm font-normal text-muted">µg/m³</span>
                      </dd>
                      <dd className="text-xs text-muted">{computed.rain.dry.days} days</dd>
                    </div>
                    <div className="rounded-xl bg-surface-2 p-3">
                      <dt className="text-xs text-muted">Rain days (≥ {RAIN_DAY_MM} mm)</dt>
                      <dd className="text-2xl font-semibold">
                        {computed.rain.wet.meanPm25.toFixed(1)} <span className="text-sm font-normal text-muted">µg/m³</span>
                      </dd>
                      <dd className="text-xs text-muted">{computed.rain.wet.days} days</dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted">Mean of daily mean PM2.5 in each group. Correlation does not prove cause.</p>
                </>
              ) : (
                <p className="text-sm text-muted">
                  Not shown: a fair comparison needs at least {MIN_RAIN_GROUP_DAYS} dry days and {MIN_RAIN_GROUP_DAYS} rain days. This period has {computed.precipDays} days with
                  precipitation data.
                </p>
              )}
            </div>
          </div>
          <p className="text-xs text-muted">
            Sources: Open-Meteo Air Quality (CAMS) for PM2.5 and Open-Meteo Weather for temperature, humidity, wind, pressure, precipitation and boundary layer height. Local days in{" "}
            {computed.tz}. Model data, not station measurements.
          </p>
        </div>
      )}
    </section>
  );
}
