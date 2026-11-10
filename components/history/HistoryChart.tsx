"use client";

import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { categoryBands, niceYMax, useChartColors } from "@/components/charts/chart-kit";
import { getCategory, POLLUTANT_INFO, type PollutantKey } from "@/lib/aqi-categories";
import { formatLocalDate } from "@/lib/format";
import type { DayStat } from "@/lib/history-stats";
import type { AqiScale } from "@/types/air";

export type HistoryMetric = "aqi" | PollutantKey;

interface Row {
  date: string;
  label: string;
  mean: number | null;
  max: number | null;
  validHours: number;
  partial: boolean;
  dominant: string | null;
}

const fmt = (v: number | null, metric: HistoryMetric) =>
  v === null ? "n/a" : metric === "aqi" ? String(Math.round(v)) : v >= 100 ? String(Math.round(v)) : v.toFixed(1);

function TooltipBody({ row, metric, scale }: { row: Row; metric: HistoryMetric; scale: AqiScale }) {
  const unit = metric === "aqi" ? (scale === "us" ? "US AQI" : "EU AQI") : "µg/m³";
  const cat = metric === "aqi" && row.mean !== null ? getCategory(row.mean, scale) : null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold">{formatLocalDate(row.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>
      <p>
        Mean: <strong>{fmt(row.mean, metric)}</strong> {unit}
        {cat ? ` (${cat.label})` : ""}
      </p>
      <p>
        Max: <strong>{fmt(row.max, metric)}</strong> {unit}
      </p>
      {metric === "aqi" ? <p>Main pollutant: {row.dominant ?? "n/a"}</p> : null}
      <p className={row.partial ? "text-danger" : "text-muted"}>
        {row.validHours} of 24 hours{row.partial ? " (partial day)" : ""}
      </p>
    </div>
  );
}

export function HistoryChart({ days, metric, scale }: { days: readonly DayStat[]; metric: HistoryMetric; scale: AqiScale }) {
  const c = useChartColors();
  const rows: Row[] = days.map((d) => ({
    date: d.date,
    label: formatLocalDate(d.date, days.length > 14 ? { day: "numeric", month: "short" } : { weekday: "short", day: "numeric" }),
    mean: d.mean,
    max: d.max,
    validHours: d.validHours,
    partial: d.partial,
    dominant: d.dominant ? POLLUTANT_INFO[d.dominant].short : null,
  }));
  const dataMax = Math.max(0, ...rows.map((r) => r.max ?? 0));
  const yMax = metric === "aqi" ? niceYMax(dataMax, scale) : Math.ceil(Math.max(dataMax, POLLUTANT_INFO[metric].who.value) * 1.1);
  const unit = metric === "aqi" ? (scale === "us" ? "US AQI" : "EU AQI") : `${POLLUTANT_INFO[metric].short} µg/m³`;
  const withMean = rows.filter((r) => r.mean !== null);
  const summary = withMean.length
    ? `Daily ${metric === "aqi" ? "AQI" : POLLUTANT_INFO[metric].short} over ${rows.length} days, ${unit}: daily means range from ${fmt(Math.min(...withMean.map((r) => r.mean!)), metric)} to ${fmt(Math.max(...withMean.map((r) => r.mean!)), metric)}. ${rows.length - withMean.length} days have no data.`
    : "No data for this period.";

  return (
    <figure className="flex flex-col gap-2">
      <div role="img" aria-label={summary} className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} accessibilityLayer>
            {metric === "aqi" ? categoryBands(scale, yMax, c.bandOpacity) : null}
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.grid }} interval="preserveStartEnd" minTickGap={14} />
            <YAxis domain={[0, yMax]} tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
            {metric !== "aqi" ? (
              <ReferenceLine
                y={POLLUTANT_INFO[metric].who.value}
                stroke={c.now}
                strokeDasharray="6 4"
                label={{ value: `WHO ${POLLUTANT_INFO[metric].who.averaging}`, fill: c.muted, fontSize: 10, position: "insideTopRight" }}
              />
            ) : null}
            <Tooltip
              cursor={{ stroke: c.muted, strokeDasharray: "3 3" }}
              content={({ active, payload }) =>
                active && payload?.[0] ? <TooltipBody row={payload[0].payload as Row} metric={metric} scale={scale} /> : null
              }
            />
            <Line
              type="monotone"
              dataKey="mean"
              name="Daily mean"
              stroke={c.official}
              strokeWidth={2.2}
              dot={{ r: rows.length > 40 ? 0 : 2.5, fill: c.official }}
              activeDot={{ r: 5 }}
              connectNulls={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="max"
              name="Daily max"
              stroke="transparent"
              dot={{ r: 3, fill: c.surface, stroke: c.muted, strokeWidth: 1.5 }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-5" style={{ backgroundColor: c.official }} /> Daily mean
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: c.muted }} /> Daily max
        </span>
        <span>Gaps = days without data. Times are local to the city.</span>
      </figcaption>
      <div className="sr-only">
        <table>
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Mean</th>
            <th scope="col">Max</th>
            <th scope="col">Hours covered</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.date}>
              <th scope="row">{r.date}</th>
              <td>{fmt(r.mean, metric)}</td>
              <td>{fmt(r.max, metric)}</td>
              <td>
                {r.validHours}
                {r.partial ? " (partial)" : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
        </div>
    </figure>
  );
}
