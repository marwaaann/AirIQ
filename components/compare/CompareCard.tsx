"use client";

import Link from "next/link";

import { CategoryBadge } from "@/components/CategoryBadge";
import { NaqiBasisNote, OlderReadingLine } from "@/components/NaqiNotes";
import { ErrorState, Skeleton } from "@/components/states";
import { StaleNotice } from "@/components/StaleNotice";
import type { CompareCityData } from "@/hooks/useCompareCity";
import { beyondIndexLabel, formatIndex, getCategory, isBeyondIndex, POLLUTANT_INFO, POLLUTANT_ORDER, SCALE_NAME } from "@/lib/aqi-categories";
import { headline as modelHeadline } from "@/lib/aqi-display";
import { sourceLabel, type HeadlineSource } from "@/lib/headline-source";
import { errorMessage } from "@/lib/fetcher";
import { formatConcentration, formatPlaceTime, formatRatio } from "@/lib/format";
import { staleMetaOf } from "@/lib/stale";
import type { AqiScale } from "@/types/air";

/** Bars span 0–4× the WHO guideline; the 1× mark is drawn at 25%. */
const BAR_MAX_RATIO = 4;

export function CompareCard({
  d,
  scale,
  headline: hs,
  rank,
  color,
  dash,
  onRemove,
}: {
  d: CompareCityData;
  scale: AqiScale;
  headline: HeadlineSource | null;
  rank: number | null;
  color: string;
  dash: string;
  onRemove: () => void;
}) {
  const city = d.city!;
  const { data, error, isLoading, isValidating, mutate } = d.air;
  const h = data ? modelHeadline(data.current, scale) : null;
  const value = hs?.value ?? null;
  const category = value !== null ? getCategory(value, scale) : null;

  return (
    <article className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-surface p-4" data-testid="compare-card" data-slug={city.slug}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 truncate text-lg font-semibold">
            <svg aria-hidden width="20" height="8" className="shrink-0">
              <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="3" strokeDasharray={dash || undefined} />
            </svg>
            <Link prefetch={false} href={`/city/${city.slug}`} className="truncate hover:underline">
              {city.name}
            </Link>
          </h2>
          {rank !== null ? <p className="text-xs text-muted">#{rank} cleanest now</p> : null}
        </div>
        <button type="button" onClick={onRemove} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-surface-2" aria-label={`Remove ${city.name}`}>
          Remove
        </button>
      </header>

      {error && !data ? (
        <ErrorState compact title={`Couldn't load ${city.name}`} message={errorMessage(error)} onRetry={() => void mutate()} retrying={isValidating} />
      ) : isLoading || !data || !h ? (
        <Skeleton className="h-56 rounded-xl" label={`Loading ${city.name}`} />
      ) : (
        <>
          <div className="flex items-center gap-3">
            <span className="text-4xl font-bold" data-testid="compare-aqi" title={value !== null && isBeyondIndex(value, scale) ? beyondIndexLabel(value, scale) : undefined}>
              {formatIndex(value, scale)}
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-xs text-muted">{SCALE_NAME[scale]}</span>
              {category ? <CategoryBadge category={category} size="sm" /> : null}
            </div>
          </div>
          {hs ? (
            <p className="text-xs font-medium" data-testid="compare-source">
              Source: {sourceLabel(hs)}
              {hs.source !== "model" && hs.source !== "unavailable" && hs.modelValue !== null ? ` · model ${formatIndex(hs.modelValue, scale)}` : ""}
            </p>
          ) : null}
          {hs && scale === "in" ? <NaqiBasisNote headline={hs} compact /> : null}
          {scale === "in" && value === null && hs?.source !== "unavailable" ? <p className="text-xs">Not enough data for NAQI.</p> : null}
          {hs ? <OlderReadingLine headline={hs} timeZone={data.current.timezone} compact /> : null}
          <p className="text-sm">
            Main pollutant (model): <strong>{h.dominant ? POLLUTANT_INFO[h.dominant].short : "n/a"}</strong>
          </p>
          <p className="text-xs text-muted">{formatPlaceTime(hs?.observedAt ?? data.current.time, data.current.timezone)}</p>
          <StaleNotice compact meta={staleMetaOf(data)} timeZone={data.current.timezone} onRetry={() => void mutate()} retrying={isValidating} />
          <ul className="flex flex-col gap-1.5" aria-label={`${city.name} pollutants relative to WHO guidelines`}>
            {POLLUTANT_ORDER.map((p) => {
              const info = POLLUTANT_INFO[p];
              const v = data.current.pollutants[p];
              const ratio = v !== null ? v / info.who.value : null;
              return (
                <li key={p} className="grid grid-cols-[3.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-xs">
                  <span className="font-medium">{info.short}</span>
                  <span className="relative h-2.5 rounded-full bg-surface-2" aria-hidden>
                    {ratio !== null ? (
                      <span
                        className={`absolute inset-y-0 left-0 rounded-full ${ratio > 1 ? "bg-danger" : "bg-brand"}`}
                        style={{ width: `${Math.max(2, Math.min(ratio / BAR_MAX_RATIO, 1) * 100)}%` }}
                      />
                    ) : null}
                    <span className="absolute -inset-y-0.5 w-px bg-text" style={{ left: `${100 / BAR_MAX_RATIO}%` }} />
                  </span>
                  <span className="text-right font-mono" title={v !== null ? `${formatConcentration(v)} ${info.unit}` : undefined}>
                    {ratio !== null ? `${formatRatio(ratio)}× ${ratio > BAR_MAX_RATIO ? "▸" : ""}` : "n/a"}
                    <span className="sr-only">
                      {" "}
                      of the WHO {info.who.averaging} guideline ({v !== null ? `${formatConcentration(v)} ${info.unit}` : "no value"})
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-[11px] text-muted">Bars: current model concentration ÷ WHO 2021 guideline (line = 1×, bar full = {BAR_MAX_RATIO}× or more).</p>
          {error ? <ErrorState compact title="Refresh failed, showing the last reading" message={errorMessage(error)} onRetry={() => void mutate()} /> : null}
        </>
      )}
    </article>
  );
}
