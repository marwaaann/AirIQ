"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { ErrorState, Skeleton } from "@/components/states";
import { StaleNotice } from "@/components/StaleNotice";
import {
  CIGARETTE_DISCLAIMER,
  CIGARETTE_SOURCE,
  MIN_VALID_HOURS,
  PM25_PER_CIGARETTE,
  cigaretteWord,
  formatCigarettes,
  weekEquivalent,
  windowEquivalent,
} from "@/lib/cigarette-equivalent";
import { historyUrl } from "@/hooks/useCity";
import { apiFetch, errorMessage } from "@/lib/fetcher";
import { formatInZone } from "@/lib/format";
import { staleMetaOf } from "@/lib/stale";
import type { HistoryResponse } from "@/types/api";

/**
 * "≈ X cigarettes" for the last 24 hours of PM2.5 plus the 7-day total
 * (Berkeley Earth: 22 µg/m³ for 24 h ≈ 1 cigarette). Needs 18 of 24 valid
 * hours per day; otherwise says there is not enough data.
 */
export function CigaretteEquivalent({ lat, lon, variant = "card" }: { lat: number; lon: number; variant?: "card" | "report" }) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<HistoryResponse, Error>(historyUrl(lat, lon, 7), apiFetch, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  const result = useMemo(() => {
    if (!data) return null;
    const pts = data.series.points.map((p) => ({ time: p.time, pm25: p.pollutants.pm2_5 }));
    const last = pts.length ? Date.parse(pts[pts.length - 1].time) : Date.parse(data.fetchedAt);
    return { day: windowEquivalent(pts, last), week: weekEquivalent(pts, last), tz: data.series.timezone };
  }, [data]);

  const shell = variant === "card" ? "rounded-2xl border border-border bg-surface p-4" : "";

  if (error && !data) {
    return <ErrorState compact title="Couldn't load the cigarette equivalent" message={errorMessage(error)} onRetry={() => void mutate()} retrying={isValidating} />;
  }
  if (isLoading || !result) return <Skeleton className="h-36 rounded-2xl" label="Loading cigarette equivalent" />;

  const { day, week, tz } = result;
  return (
    <section aria-labelledby="cig-title" className={`flex flex-col gap-2 text-sm ${shell}`} data-testid="cigarette-equivalent">
      <h3 id="cig-title" className="font-semibold">
        Cigarette equivalent
      </h3>
      <StaleNotice compact meta={staleMetaOf(data)} timeZone={tz} onRetry={() => void mutate()} retrying={isValidating} />
      {day.ok ? (
        <p>
          <span className="text-2xl font-bold" data-testid="cig-day">
            ≈ {formatCigarettes(day.cigarettes)}
          </span>{" "}
          {cigaretteWord(day.cigarettes)} in the last 24 hours
          <span className="block text-xs text-muted">
            Mean PM2.5 {day.meanPm25.toFixed(1)} µg/m³ over {day.validHours} of 24 hours, to {formatInZone(day.end, tz, { weekday: "short", hour: "2-digit", minute: "2-digit" })} local.
          </span>
        </p>
      ) : (
        <p data-testid="cig-day">
          <strong>Not enough data</strong> for the last 24 hours ({day.validHours} of 24 hours available; at least {MIN_VALID_HOURS} needed).
        </p>
      )}
      {week.ok ? (
        <p data-testid="cig-week">
          ≈ <strong>{formatCigarettes(week.cigarettes)}</strong> {cigaretteWord(week.cigarettes)} over the last 7 days.
        </p>
      ) : (
        <p data-testid="cig-week" className="text-muted">
          7-day total: not enough data ({week.missingDays} of 7 days have fewer than {MIN_VALID_HOURS} valid hours).
        </p>
      )}
      <p className="text-xs text-muted">
        {CIGARETTE_DISCLAIMER} Rule of thumb: {PM25_PER_CIGARETTE} µg/m³ of PM2.5 breathed for 24 hours ≈ 1 cigarette. Source:{" "}
        <a href={CIGARETTE_SOURCE.url} target="_blank" rel="noreferrer" className="underline">
          {CIGARETTE_SOURCE.name}, “{CIGARETTE_SOURCE.title}”
        </a>
        . PM2.5 from Open-Meteo (CAMS).
      </p>
    </section>
  );
}
