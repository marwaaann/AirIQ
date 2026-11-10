"use client";

import { useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";

import { CategoryBadge } from "@/components/CategoryBadge";
import { CalendarHeatmap } from "@/components/history/CalendarHeatmap";
import { HistoryChart, type HistoryMetric } from "@/components/history/HistoryChart";
import { HourOfDayHeatmap } from "@/components/history/HourOfDayHeatmap";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { useUrlParam } from "@/hooks/useUrlParam";
import { getCategory, POLLUTANT_INFO, POLLUTANT_ORDER, type PollutantKey } from "@/lib/aqi-categories";
import { apiFetch, errorMessage } from "@/lib/fetcher";
import { formatLocalDate } from "@/lib/format";
import {
  bestWorst,
  buildInsights,
  dailyStats,
  extremeHour,
  hourOfDayProfile,
  periodChange,
  periodSummary,
  toLocalHours,
  weekdayHourMatrix,
  type DayStat,
  type RawHour,
} from "@/lib/history-stats";
import { datesEnding, formatHour, localParts } from "@/lib/time";
import type { AqiScale } from "@/types/air";
import type { HistoryResponse } from "@/types/api";

const RANGES = ["7", "30", "90"] as const;
type RangeParam = (typeof RANGES)[number];

function StatCard({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <div className="text-lg font-semibold">{children}</div>
      {sub ? <div className="text-xs text-muted">{sub}</div> : null}
    </div>
  );
}

function DayValue({ day, scale }: { day: DayStat | null; scale: AqiScale }) {
  if (!day || day.mean === null) return <span className="text-muted">n/a</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span className="font-mono">{Math.round(day.mean)}</span>
      <CategoryBadge category={getCategory(day.mean, scale)} size="sm" />
    </span>
  );
}

export default function HistoryPanel({ lat, lon, scale }: { lat: number; lon: number; scale: AqiScale }) {
  const [rangeParam, setRange] = useUrlParam<RangeParam>("range", RANGES, "7");
  const range = Number(rangeParam) as 7 | 30 | 90;
  const [metric, setMetric] = useState<HistoryMetric>("aqi");
  const { data, error, isLoading, isValidating, mutate } = useSWR<HistoryResponse, Error>(
    `/api/history?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}&days=${range}`,
    apiFetch,
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  const computed = useMemo(() => {
    if (!data) return null;
    const tz = data.series.timezone;
    const pts = data.series.points;
    const raw: RawHour[] = pts.map((p) => ({
      time: p.time,
      value: scale === "us" ? p.usAqi : p.euAqi,
      subs: scale === "us" ? p.usSubIndices : p.euSubIndices,
    }));
    const hours = toLocalHours(raw, tz);
    const endDate = pts.length ? localParts(pts[pts.length - 1].time, tz).date : localParts(data.fetchedAt, tz).date;
    const dates = datesEnding(endDate, range);
    const inRange = new Set(dates);
    const rangeHours = hours.filter((h) => inRange.has(h.date));
    const days = dailyStats(rangeHours);
    const profile = hourOfDayProfile(rangeHours);
    const change = periodChange(hours, endDate, range);
    const summary = periodSummary(hours, endDate, range);
    const metricDays =
      metric === "aqi"
        ? days
        : dailyStats(
            toLocalHours(
              pts.map((p) => ({ time: p.time, value: p.pollutants[metric as PollutantKey] })),
              tz,
            ).filter((h) => inRange.has(h.date)),
          );
    return {
      tz,
      dates,
      days,
      metricDays,
      profile,
      change,
      summary,
      bw: bestWorst(days),
      peak: extremeHour(profile, "peak"),
      matrix: weekdayHourMatrix(rangeHours),
      insights: buildInsights({ scale, rangeDays: range, days, profile, change }),
      validHours: rangeHours.filter((h) => h.value !== null).length,
    };
  }, [data, scale, range, metric]);

  const scaleLabel = scale === "us" ? "US AQI" : "EU AQI";

  return (
    <section aria-labelledby="history-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="history-title" className="text-lg font-semibold">
          History
        </h2>
        <div role="radiogroup" aria-label="History range" className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
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

      {error && !data ? (
        <ErrorState title="Couldn't load history" message={errorMessage(error)} onRetry={() => void mutate()} retrying={isValidating} />
      ) : isLoading && !data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-2xl" label="Loading history" />
        </div>
      ) : !computed || computed.validHours === 0 ? (
        <EmptyState title="No history for this location">Open-Meteo returned no hourly values for this period.</EmptyState>
      ) : (
        <div className={`flex flex-col gap-5 ${isValidating ? "opacity-80" : ""}`}>
          {error ? (
            <ErrorState compact title="Refresh failed, showing the last loaded history" message={errorMessage(error)} onRetry={() => void mutate()} retrying={isValidating} />
          ) : null}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard
              label="Best day"
              sub={computed.bw.best ? `${formatLocalDate(computed.bw.best.date)}${computed.bw.fromPartial ? " · partial data" : ""}` : "No complete day"}
            >
              <DayValue day={computed.bw.best} scale={scale} />
            </StatCard>
            <StatCard
              label="Worst day"
              sub={computed.bw.worst ? `${formatLocalDate(computed.bw.worst.date)}${computed.bw.fromPartial ? " · partial data" : ""}` : "No complete day"}
            >
              <DayValue day={computed.bw.worst} scale={scale} />
            </StatCard>
            <StatCard label={`Average (${range} d)`} sub={`${computed.summary.validHours} of ${computed.summary.expectedHours} hours`}>
              {computed.summary.mean !== null ? (
                <span className="font-mono">
                  {Math.round(computed.summary.mean)} <span className="text-sm font-normal text-muted">{scaleLabel}</span>
                </span>
              ) : (
                "n/a"
              )}
            </StatCard>
            <StatCard
              label="vs previous period"
              sub={
                computed.change
                  ? `${Math.round(computed.change.previous.mean!)} → ${Math.round(computed.change.current.mean!)} (${computed.change.previous.validHours} h before)`
                  : range === 90
                    ? "Open-Meteo keeps 92 days, so no earlier 90-day period"
                    : "Not enough earlier data"
              }
            >
              {computed.change ? (
                <span className={computed.change.absChange > 0 ? "text-danger" : ""}>
                  {computed.change.pctChange > 0 ? "▲" : computed.change.pctChange < 0 ? "▼" : "■"} {Math.abs(Math.round(computed.change.pctChange))}%
                  <span className="sr-only">{computed.change.pctChange > 0 ? " worse" : " better"}</span>
                </span>
              ) : (
                <span className="text-muted">n/a</span>
              )}
            </StatCard>
            <StatCard label="Typical peak hour" sub={computed.peak ? `Average ${Math.round(computed.peak.mean!)} · ${computed.peak.n} days` : "Needs ≥3 days per hour"}>
              {computed.peak ? `${formatHour(computed.peak.hour)} local` : <span className="text-muted">n/a</span>}
            </StatCard>
          </div>

          {computed.insights.length ? (
            <ul className="flex flex-col gap-1.5 rounded-2xl border border-border bg-surface p-4 text-sm">
              {computed.insights.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden className="text-brand">
                    ●
                  </span>
                  {line}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Daily {metric === "aqi" ? scaleLabel : POLLUTANT_INFO[metric].short}</h3>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-muted">Show</span>
                <select
                  value={metric}
                  onChange={(e) => setMetric(e.target.value as HistoryMetric)}
                  className="rounded-lg border border-border bg-surface px-2 py-1 text-sm"
                >
                  <option value="aqi">{scaleLabel}</option>
                  {POLLUTANT_ORDER.map((p) => (
                    <option key={p} value={p}>
                      {POLLUTANT_INFO[p].short} (µg/m³)
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <HistoryChart days={computed.metricDays} metric={metric} scale={scale} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
              <h3 className="font-semibold">Calendar</h3>
              <CalendarHeatmap dates={computed.dates} days={computed.days} scale={scale} />
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
              <h3 className="font-semibold">When is it worst?</h3>
              <HourOfDayHeatmap
                matrix={computed.matrix}
                scale={scale}
                summary={
                  computed.peak
                    ? `Average ${scaleLabel} by weekday and local hour over ${range} days. Highest on average at ${formatHour(computed.peak.hour)}.`
                    : `Average ${scaleLabel} by weekday and local hour over ${range} days.`
                }
              />
            </div>
          </div>
          <p className="text-xs text-muted">
            Source: Open-Meteo (CAMS) hourly model data, bucketed by local days in {computed.tz}. Missing hours are left out, never filled in.
          </p>
        </div>
      )}
    </section>
  );
}
