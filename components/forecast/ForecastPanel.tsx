"use client";

import { useMemo } from "react";
import useSWR from "swr";

import { CategoryBadge, CategorySwatch } from "@/components/CategoryBadge";
import { ForecastChart, type ForecastRow } from "@/components/forecast/ForecastChart";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { getCategory } from "@/lib/aqi-categories";
import { apiFetch, errorMessage } from "@/lib/fetcher";
import { agreement, cleanestWindows, dailyRanges } from "@/lib/forecast-insights";
import { formatInZone, formatLocalDate } from "@/lib/format";
import type { AqiScale } from "@/types/air";
import type { ForecastResponse, MetricsPayload, ModelPayload } from "@/types/api";

type OkModel = Extract<ModelPayload, { status: "ok" }>;

function verdictLine(m: OkModel): { text: string; good: boolean } {
  const b = m.backtest;
  const beatP = b.model.mae < b.persistence.mae;
  const beatS = b.model.mae < b.seasonalNaive.mae;
  if (beatP && beatS) return { text: "On the held-out last 48 hours, the model's error was lower than both simple baselines.", good: true };
  if (!beatP && !beatS)
    return { text: "On this backtest the model did NOT beat either simple baseline. Treat its line as illustrative only.", good: false };
  return {
    text: `On this backtest the model beat ${beatP ? "persistence" : "seasonal-naive"} but did NOT beat ${beatP ? "seasonal-naive" : "persistence"}.`,
    good: false,
  };
}

function biasNote(m: OkModel): string | null {
  if (m.intervals.some((b) => b.q90 < 0)) return "In recent backtests the model over-predicted, so its 80% range sits below its own line for some horizons.";
  if (m.intervals.some((b) => b.q10 > 0)) return "In recent backtests the model under-predicted, so its 80% range sits above its own line for some horizons.";
  return null;
}

const fmtM = (x: MetricsPayload) => `${x.mae.toFixed(1)} / ${x.rmse.toFixed(1)}`;

export default function ForecastPanel({ lat, lon, scale }: { lat: number; lon: number; scale: AqiScale }) {
  const { data, error, isLoading, isValidating, mutate } = useSWR<ForecastResponse, Error>(
    `/api/forecast?lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`,
    apiFetch,
    { revalidateOnFocus: false, refreshInterval: 15 * 60 * 1000, keepPreviousData: true },
  );

  const view = useMemo(() => {
    if (!data) return null;
    const tz = data.official.timezone;
    const nowMs = Date.parse(data.now);
    const off = data.official.points.map((p) => ({
      time: p.time,
      t: Date.parse(p.time),
      value: scale === "us" ? p.usAqi : p.euAqi,
      pm25Sub: (scale === "us" ? p.usSubIndices : p.euSubIndices)?.pm2_5 ?? null,
    }));
    const model = data.model.status === "ok" ? data.model : null;
    const modelByT = new Map(
      (model?.points ?? []).map((p) => [
        Date.parse(p.time),
        scale === "us" ? { v: p.us, lo: p.usLo, hi: p.usHi } : { v: p.eu, lo: p.euLo, hi: p.euHi },
      ]),
    );
    const rows: ForecastRow[] = off.map((o) => {
      const m = modelByT.get(o.t);
      return {
        t: o.t,
        official: o.value,
        officialPm25: o.pm25Sub,
        model: m?.v ?? null,
        band: m && m.lo !== null && m.hi !== null ? [Math.min(m.lo, m.hi), Math.max(m.lo, m.hi)] : null,
      };
    });
    const next48 = off.filter((o) => o.t > nowMs && o.t <= nowMs + 48 * 3600_000);
    const agree = model
      ? agreement(
          next48.map((o) => o.pm25Sub),
          next48.map((o) => modelByT.get(o.t)?.v ?? null),
        )
      : null;
    const windows = cleanestWindows(
      off.filter((o) => o.t >= nowMs).map((o) => ({ time: o.time, value: o.value })),
      48,
      3,
      3,
    );
    const daily = dailyRanges(
      off.map((o) => ({ time: o.time, value: o.value })),
      tz,
    );
    const valid = off.filter((o) => o.value !== null);
    const peak = valid.reduce<(typeof valid)[number] | null>((a, b) => (!a || (b.value ?? 0) > (a.value ?? 0) ? b : a), null);
    const summary = valid.length
      ? `Official ${scale === "us" ? "US" : "European"} AQI forecast for the next ${Math.round((off[off.length - 1].t - nowMs) / 3600_000)} hours: from ${Math.min(...valid.map((v) => v.value!))} to ${Math.max(...valid.map((v) => v.value!))}, highest around ${formatInZone(peak!.t, tz, { weekday: "long", hour: "2-digit", minute: "2-digit" })} local time.${model ? " The AirIQ trend model covers the first 48 hours for PM2.5." : ""}`
      : "No forecast values available.";
    return { tz, nowMs, rows, agree, windows, daily, model, summary, hasValues: valid.length > 0 };
  }, [data, scale]);

  const unit = scale === "us" ? "US AQI" : "EU AQI";

  return (
    <section aria-labelledby="forecast-title" className="flex flex-col gap-5">
      <h2 id="forecast-title" className="text-lg font-semibold">
        Forecast
      </h2>

      {error && !data ? (
        <ErrorState title="Couldn't load the forecast" message={errorMessage(error)} onRetry={() => void mutate()} retrying={isValidating} />
      ) : isLoading && !data ? (
        <div className="flex flex-col gap-4" aria-busy="true">
          <Skeleton className="h-80 rounded-2xl" label="Loading forecast" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl" />
            ))}
          </div>
        </div>
      ) : !view || !view.hasValues ? (
        <EmptyState title="No forecast for this location">Open-Meteo returned no forecast values.</EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          {error ? (
            <ErrorState compact title="Refresh failed, showing the last loaded forecast" message={errorMessage(error)} onRetry={() => void mutate()} retrying={isValidating} />
          ) : null}

          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
            <h3 className="font-semibold">Next 5 days, hourly ({unit})</h3>
            <ForecastChart rows={view.rows} nowMs={view.nowMs} scale={scale} tz={view.tz} summary={view.summary} />
            <p className="text-xs text-muted">
              Times are local to the city ({view.tz}). The official forecast covers all pollutants; the trend model only extrapolates PM2.5 from the
              last 28 days, so compare it with the dotted PM2.5 line.
            </p>
          </div>

          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Daily forecast range">
            {view.daily.map((d) => {
              const cat = getCategory(d.mean, scale);
              return (
                <li key={d.date} className="relative flex flex-col gap-1 overflow-hidden rounded-2xl border border-border bg-surface p-3">
                  <span aria-hidden className={`absolute inset-x-0 top-0 h-1.5 aqi-pattern-${cat.pattern}`} style={{ backgroundColor: cat.color }} />
                  <p className="pt-1 text-sm font-semibold">{formatLocalDate(d.date)}</p>
                  <p className="font-mono text-2xl font-bold">{Math.round(d.mean)}</p>
                  <p className="text-xs text-muted">
                    min {Math.round(d.min)} · max {Math.round(d.max)}
                    {d.n < 24 ? ` · ${d.n} h` : ""}
                  </p>
                  <CategoryBadge category={cat} size="sm" />
                </li>
              );
            })}
          </ul>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
              <h3 className="font-semibold">Best time outside (next 48 h)</h3>
              {view.windows.length ? (
                <ol className="flex flex-col gap-2">
                  {view.windows.map((w) => {
                    const cat = getCategory(w.max, scale);
                    return (
                      <li key={w.start} className="flex flex-wrap items-center gap-2 text-sm">
                        <CategorySwatch category={cat} />
                        <span className="font-medium">
                          {formatInZone(w.start, view.tz, { weekday: "short", hour: "2-digit", minute: "2-digit" })}–
                          {formatInZone(Date.parse(w.end) + 3600_000, view.tz, { hour: "2-digit", minute: "2-digit" })}
                        </span>
                        <span className="text-muted">
                          {unit} {w.min}–{w.max} ({cat.label} at worst)
                        </span>
                      </li>
                    );
                  })}
                </ol>
              ) : (
                <p className="text-sm text-muted">No complete 3-hour window in the official forecast.</p>
              )}
              {view.windows.length && view.windows.every((w) => getCategory(w.min, scale).rank >= 3) ? (
                <p role="note" className="text-sm font-medium text-danger">
                  Even the cleanest hours in the next 48 h are forecast as “{getCategory(Math.min(...view.windows.map((w) => w.min)), scale).label}” or
                  worse. There is no good window to be outside; these are only the least-bad hours.
                </p>
              ) : null}
              <p className="text-xs text-muted">
                The 3 cleanest 3-hour windows in the official forecast. Personal health advice arrives in Phase 5.
              </p>
            </div>

            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
              <h3 className="font-semibold">AirIQ trend model vs official</h3>
              {view.model ? (
                <>
                  {view.agree ? (
                    <p className="text-sm">
                      Average difference over the next {view.agree.n} h:{" "}
                      <strong className="font-mono">{view.agree.mad.toFixed(1)}</strong> {unit} points (model vs official PM2.5 sub-index).{" "}
                      {view.agree.text}
                    </p>
                  ) : (
                    <p className="text-sm text-muted">No overlapping hours to compare.</p>
                  )}
                  <BacktestTable model={view.model} />
                </>
              ) : data?.model.status === "insufficient" ? (
                <p className="text-sm">
                  <strong>Not enough data for a trend model</strong>: {data.model.reason}. The official forecast above is unaffected.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function BacktestTable({ model }: { model: OkModel }) {
  const v = verdictLine(model);
  const bias = biasNote(model);
  const b = model.backtest;
  const best = Math.min(b.model.mae, b.persistence.mae, b.seasonalNaive.mae);
  const row = (name: string, m: MetricsPayload, note: string) => (
    <tr className="border-t border-border">
      <th scope="row" className="py-1 pr-2 text-left font-medium">
        {name}
        <span className="block text-[11px] font-normal text-muted">{note}</span>
      </th>
      <td className={`py-1 text-right font-mono ${m.mae === best ? "font-bold" : ""}`}>{fmtM(m)}</td>
    </tr>
  );
  return (
    <div className="flex flex-col gap-2">
      <p className={`text-sm font-medium ${v.good ? "" : "text-danger"}`}>{v.text}</p>
      <table className="w-full text-sm">
        <caption className="pb-1 text-left text-xs text-muted">
          Backtest: trained on {b.trainHours} h, predicted the last {b.holdout} h ({b.model.n} comparable hours). PM2.5 error, MAE / RMSE in µg/m³; lower is
          better.
        </caption>
        <tbody>
          {row("AirIQ trend model", b.model, `Holt-Winters, α ${model.params.alpha} β ${model.params.beta} γ ${model.params.gamma} φ ${model.params.phi}`)}
          {row("Persistence", b.persistence, "Last value carried forward")}
          {row("Seasonal-naive", b.seasonalNaive, "Same hour, previous day")}
        </tbody>
      </table>
      <p className="text-xs text-muted">
        80% range from backtest residuals (10th–90th percentile) per horizon:{" "}
        {model.intervals.map((i) => `${i.from}–${i.to} h: ${i.q10 >= 0 ? "+" : ""}${i.q10.toFixed(1)} to ${i.q90 >= 0 ? "+" : ""}${i.q90.toFixed(1)} µg/m³`).join("; ")}.
      </p>
      {bias ? <p className="text-xs">{bias}</p> : null}
      <p className="text-xs text-muted">
        This compares the model with simple baselines only. It is not ranked against the official forecast, which uses weather and emissions data the
        model does not have.
      </p>
    </div>
  );
}
