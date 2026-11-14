"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useRef } from "react";

import { AqiScaleToggle } from "@/components/AqiScaleToggle";
import { CategoryBadge } from "@/components/CategoryBadge";
import { SERIES_DASH, useSeriesColors } from "@/components/charts/chart-kit";
import { CitySearch } from "@/components/CitySearch";
import { CompareCard } from "@/components/compare/CompareCard";
import { dateLabel, type ChartRow, type ChartSeries } from "@/components/compare/compare-chart-data";
import { offlineFallback } from "@/components/pwa/OfflineUnavailable";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { StaleNotice } from "@/components/StaleNotice";
import { useAqiScale } from "@/hooks/useAqiScale";
import { useDataSource } from "@/hooks/useDataSource";
import { computeHeadline } from "@/hooks/useHeadline";
import { useNow } from "@/hooks/useNow";
import { compareCityFromSlug, useCompareCity, type CompareCityData, type CompareCityRef } from "@/hooks/useCompareCity";
import { useFavorites } from "@/hooks/useFavorites";
import { useUrlParam } from "@/hooks/useUrlParam";
import { formatIndex, getCategory, POLLUTANT_INFO, POLLUTANT_ORDER, SCALE_SHORT, type PollutantKey } from "@/lib/aqi-categories";
import { sourceLabel, type HeadlineSource } from "@/lib/headline-source";
import type { AqiScale } from "@/types/air";
import { MAX_COMPARE, MIN_COMPARE, compareSummary, parseCitiesParam, rankCleanest, serializeCities } from "@/lib/compare";
import { errorMessage } from "@/lib/fetcher";
import { combineStale, staleMetaOf } from "@/lib/stale";
import { dailyStats, toLocalHours } from "@/lib/history-stats";
import { RANGES, type RangeParam } from "@/lib/share";
import { makeCitySlug, parseCitySlug } from "@/lib/slug";
import { datesEnding, localParts } from "@/lib/time";

/** Recharts loads only when the charts render, so prefetching /compare stays light. */
const CompareLineChart = dynamic(
  () => import("@/components/compare/CompareCharts").then((m) => m.CompareLineChart).catch(offlineFallback("The comparison chart")),
  { ssr: false, loading: () => <Skeleton className="h-72 rounded-xl" label="Loading chart" /> },
);

const METRICS = ["aqi", ...POLLUTANT_ORDER] as const;
type Metric = (typeof METRICS)[number];
const HOUR = 3_600_000;
const FORECAST_HOURS = 48;

function seriesValue(p: { usAqi: number | null; euAqi: number | null; inAqi?: number | null; pollutants: Record<PollutantKey, number | null> }, metric: Metric, scale: AqiScale) {
  return metric === "aqi" ? (scale === "us" ? p.usAqi : scale === "eu" ? p.euAqi : (p.inAqi ?? null)) : p.pollutants[metric];
}

/** Daily means for one city in its own local days, limited to the selected range. */
function cityDays(d: CompareCityData, metric: Metric, scale: AqiScale, range: number): Map<string, number> | null {
  const data = d.history.data;
  if (!data) return null;
  const tz = data.series.timezone;
  const pts = data.series.points;
  const end = pts.length ? localParts(pts[pts.length - 1].time, tz).date : localParts(data.fetchedAt, tz).date;
  const inRange = new Set(datesEnding(end, range));
  const days = dailyStats(toLocalHours(pts.map((p) => ({ time: p.time, value: seriesValue(p, metric, scale) })), tz).filter((h) => inRange.has(h.date)));
  return new Map(days.filter((x) => x.mean !== null && !x.partial).map((x) => [x.date, x.mean as number]));
}

export function CompareView() {
  const params = useSearchParams();
  const [scale] = useAqiScale();
  const [mode] = useDataSource();
  const now = useNow(60_000);
  const { favorites } = useFavorites();
  const [rangeParam, setRange] = useUrlParam<RangeParam>("range", RANGES, "7");
  const range = Number(rangeParam) as 7 | 30 | 90;
  const [metric, setMetric] = useUrlParam<Metric>("metric", METRICS, "aqi");

  const slugs = useMemo(() => parseCitiesParam(params.get("cities"), (s) => parseCitySlug(s) !== null), [params]);
  const refs = useMemo(
    () => slugs.map((s) => compareCityFromSlug(s, favorites.find((f) => f.slug === s)?.name)).filter((c): c is CompareCityRef => c !== null),
    [slugs, favorites],
  );

  const setSlugs = useCallback((next: string[]) => {
    const q = new URLSearchParams(window.location.search);
    if (next.length) q.set("cities", serializeCities(next));
    else q.delete("cities");
    const qs = q.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs.replace(/%2C/g, ",")}` : ""}`);
  }, []);
  // After a card or the search box disappears, keep keyboard focus in the city picker.
  const chooseRef = useRef<HTMLElement>(null);
  const focusPicker = () =>
    requestAnimationFrame(() => {
      const section = chooseRef.current;
      (section?.querySelector<HTMLElement>("input[role=combobox]") ?? section)?.focus();
    });
  const add = (slug: string) => {
    if (slugs.includes(slug) || slugs.length >= MAX_COMPARE) return;
    setSlugs([...slugs, slug]);
    if (slugs.length + 1 >= MAX_COMPARE) focusPicker();
  };
  const remove = (slug: string) => {
    setSlugs(slugs.filter((s) => s !== slug));
    focusPicker();
  };

  // Fixed number of hook calls (one per slot); empty slots pass null.
  const s0 = useCompareCity(refs[0] ?? null, range);
  const s1 = useCompareCity(refs[1] ?? null, range);
  const s2 = useCompareCity(refs[2] ?? null, range);
  const s3 = useCompareCity(refs[3] ?? null, range);
  const slots = [s0, s1, s2, s3].filter((s) => s.city !== null);

  const unit = metric === "aqi" ? SCALE_SHORT[scale] : `${POLLUTANT_INFO[metric].short} µg/m³`;
  const unitName = metric === "aqi" ? SCALE_SHORT[scale] : `${POLLUTANT_INFO[metric].short} (µg/m³)`;

  // The headline in effect per city (station median / nearest station / model), as on the city page.
  const heads = new Map<string, HeadlineSource>();
  for (const s of slots) {
    if (s.air.data) heads.set(s.city!.slug, computeHeadline(s.air.data, s.near.data, s.near.error, scale, mode, now));
  }
  const ranking = rankCleanest(slots.map((s) => ({ id: s.city!.slug, name: s.city!.name, value: heads.get(s.city!.slug)?.value ?? null })));
  const rankOf = (slug: string) => {
    const i = ranking.findIndex((r) => r.id === slug);
    return i < 0 ? null : i + 1;
  };

  // Daily overlay
  const daily = slots.map((s, slot) => ({ s, slot, days: cityDays(s, metric, scale, range) }));
  const dates = [...new Set(daily.flatMap((d) => (d.days ? [...d.days.keys()] : [])))].sort();
  const dailySeries: ChartSeries[] = daily.filter((d) => d.days && d.days.size).map((d) => ({ key: `c${d.slot}`, name: d.s.city!.name, slot: d.slot }));
  const dailyRows: ChartRow[] = dates.map((date) => {
    const row: ChartRow = { x: date, label: dateLabel(date, dates.length > 14) };
    for (const d of daily) row[`c${d.slot}`] = d.days?.get(date) ?? null;
    return row;
  });
  const summary = compareSummary(
    daily.filter((d) => d.days).map((d) => ({ name: d.s.city!.name, days: d.days! })),
    range,
    unitName,
  );

  // 48 h official forecast overlay, aligned on hours from now (cities can be in different time zones).
  const fcSeries: ChartSeries[] = [];
  const fcRows: ChartRow[] = Array.from({ length: FORECAST_HOURS + 1 }, (_, h) => ({ x: h, label: `+${h} h` }));
  slots.forEach((s, slot) => {
    const f = s.forecast.data;
    if (!f) return;
    const now = Date.parse(f.now);
    let any = false;
    for (const p of f.official.points) {
      const h = Math.round((Date.parse(p.time) - now) / HOUR);
      if (h < 0 || h > FORECAST_HOURS) continue;
      const v = seriesValue(p, metric, scale);
      fcRows[h][`c${slot}`] = v;
      if (v !== null) any = true;
    }
    if (any) fcSeries.push({ key: `c${slot}`, name: s.city!.name, slot });
  });

  const pieceErrors = slots.flatMap((s) => [
    ...(s.history.error && !s.history.data ? [{ key: `${s.city!.slug}-h`, name: s.city!.name, what: "history", err: s.history.error, retry: () => void s.history.mutate() }] : []),
    ...(s.forecast.error && !s.forecast.data ? [{ key: `${s.city!.slug}-f`, name: s.city!.name, what: "forecast", err: s.forecast.error, retry: () => void s.forecast.mutate() }] : []),
  ]);

  const favChoices = favorites.filter((f) => !slugs.includes(f.slug));

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Compare cities</h1>
          <p className="text-sm text-muted">
            {MIN_COMPARE}–{MAX_COMPARE} places side by side. The link keeps your selection.
          </p>
        </div>
        <AqiScaleToggle />
      </header>

      <section ref={chooseRef} tabIndex={-1} aria-label="Choose cities" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 outline-none">
        {slugs.length < MAX_COMPARE ? (
          <>
            <div className="max-w-md">
              <CitySearch label="Add a city to compare" onPick={(p) => add(makeCitySlug(p.name, p.latitude, p.longitude))} />
            </div>
            {favChoices.length ? (
              <div className="flex flex-wrap items-center gap-1.5 text-sm">
                <span className="text-xs text-muted">From favorites:</span>
                {favChoices.map((f) => (
                  <button key={f.slug} type="button" onClick={() => add(f.slug)} className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-surface-2">
                    + {f.name}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted">Maximum of {MAX_COMPARE} cities. Remove one to add another.</p>
        )}
      </section>

      {slots.length === 0 ? (
        <EmptyState title="Pick cities to compare">Search for a city above{favorites.length ? " or add one of your favorites" : ""}. Add at least two.</EmptyState>
      ) : (
        <>
          {slots.length < MIN_COMPARE ? <p className="text-sm text-muted">Add one more city to compare.</p> : null}
          <div className={`grid gap-4 sm:grid-cols-2 ${slots.length > 2 ? "xl:grid-cols-4" : ""}`}>
            {slots.map((s, slot) => (
              <CompareCardSlot
                key={s.city!.slug}
                d={s}
                slot={slot}
                scale={scale}
                headline={heads.get(s.city!.slug) ?? null}
                rank={rankOf(s.city!.slug)}
                onRemove={() => remove(s.city!.slug)}
              />
            ))}
          </div>

          {ranking.length >= MIN_COMPARE ? (
            <section aria-labelledby="ranking-title" className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
              <h2 id="ranking-title" className="font-semibold">
                Right now, cleanest to most polluted
              </h2>
              <ol className="flex flex-col gap-1.5" data-testid="compare-ranking">
                {ranking.map((r, i) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="w-5 font-mono text-muted">{i + 1}.</span>
                    <span className="font-medium">{r.name}</span>
                    <span className="font-mono">{formatIndex(r.value, scale)}</span>
                    <CategoryBadge category={getCategory(r.value, scale)} size="sm" />
                    <span className="text-xs text-muted">{heads.get(r.id) ? sourceLabel(heads.get(r.id)!) : ""}</span>
                  </li>
                ))}
              </ol>
              {ranking.length < slots.length ? <p className="text-xs text-muted">Cities still loading or without a current value are not ranked.</p> : null}
            </section>
          ) : null}

          {slots.length >= MIN_COMPARE ? (
            <section aria-labelledby="trend-title" className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 id="trend-title" className="font-semibold">
                  Over time
                </h2>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted">Show</span>
                    <select value={metric} onChange={(e) => setMetric(e.target.value as Metric)} className="rounded-lg border border-border bg-surface px-2 py-1 text-sm" data-testid="compare-metric">
                      <option value="aqi">{SCALE_SHORT[scale]}</option>
                      {POLLUTANT_ORDER.map((p) => (
                        <option key={p} value={p}>
                          {POLLUTANT_INFO[p].short} (µg/m³)
                        </option>
                      ))}
                    </select>
                  </label>
                  <div role="radiogroup" aria-label="Range" className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
                    {RANGES.map((r) => (
                      <button
                        key={r}
                        type="button"
                        role="radio"
                        aria-checked={rangeParam === r}
                        onClick={() => setRange(r)}
                        className={`rounded-md px-3 py-1.5 font-medium ${rangeParam === r ? "bg-text text-bg" : "text-muted hover:text-text"}`}
                      >
                        {r} days
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {summary.length ? (
                <ul className="flex flex-col gap-1 text-sm" data-testid="compare-summary">
                  {summary.map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
              ) : null}

              <StaleNotice
                meta={combineStale(...slots.flatMap((s) => [staleMetaOf(s.history.data), staleMetaOf(s.forecast.data)]))}
                timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
                onRetry={() =>
                  slots.forEach((s) => {
                    void s.history.mutate();
                    void s.forecast.mutate();
                  })
                }
              />
              {pieceErrors.map((e) => (
                <ErrorState key={e.key} compact title={`Couldn't load ${e.what} for ${e.name}`} message={errorMessage(e.err)} onRetry={e.retry} />
              ))}

              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">
                  Daily mean {unit}, last {range} days
                </h3>
                {dailySeries.length ? (
                  <CompareLineChart
                    rows={dailyRows}
                    series={dailySeries}
                    unit={unit}
                    xLabel="Local date"
                    summary={`Daily mean ${unit} for ${dailySeries.map((s) => s.name).join(", ")} over the last ${range} days. ${summary.join(" ")}`}
                  />
                ) : (
                  <p className="text-sm text-muted">Loading history…</p>
                )}
                <p className="text-xs text-muted">Each city&rsquo;s own local days; days with fewer than 18 hours of data are left out.</p>
              </div>

              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-semibold">Official forecast, next {FORECAST_HOURS} h ({unit})</h3>
                {fcSeries.length ? (
                  <CompareLineChart
                    rows={fcRows}
                    series={fcSeries}
                    unit={unit}
                    xLabel="Hours from now"
                    summary={`Hourly official CAMS forecast of ${unit} for the next ${FORECAST_HOURS} hours for ${fcSeries.map((s) => s.name).join(", ")}.`}
                  />
                ) : (
                  <p className="text-sm text-muted">Loading forecast…</p>
                )}
                <p className="text-xs text-muted">Aligned on hours from each city&rsquo;s current hour. Source: Open-Meteo (CAMS).</p>
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function CompareCardSlot({
  d,
  slot,
  scale,
  headline,
  rank,
  onRemove,
}: {
  d: CompareCityData;
  slot: number;
  scale: AqiScale;
  headline: HeadlineSource | null;
  rank: number | null;
  onRemove: () => void;
}) {
  const colors = useSeriesColors();
  return <CompareCard d={d} scale={scale} headline={headline} rank={rank} color={colors[slot]} dash={SERIES_DASH[slot]} onRemove={onRemove} />;
}
