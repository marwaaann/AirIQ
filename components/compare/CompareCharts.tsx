"use client";

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { SERIES_DASH, useChartColors, useSeriesColors } from "@/components/charts/chart-kit";
import { formatLocalDate } from "@/lib/format";

export interface ChartSeries {
  key: string;
  name: string;
  /** Index into the fixed series palette (stable per URL slot, never by rank). */
  slot: number;
}

export type ChartRow = Record<string, number | string | null> & { x: string | number; label: string };

const fmt = (v: number) => (v >= 100 ? String(Math.round(v)) : v.toFixed(1));

function EndLabel({ name, color, last }: { name: string; color: string; last: number }) {
  // Recharts calls this for every point; draw the city name only at the last one.
  return function Render(props: { x?: number | string; y?: number | string; index?: number; value?: unknown }) {
    if (props.index !== last || typeof props.x !== "number" || typeof props.y !== "number" || typeof props.value !== "number") return null;
    return (
      <text x={props.x + 6} y={props.y + 4} fontSize={11} fontWeight={600} fill="currentColor">
        <tspan fill={color}>● </tspan>
        {name}
      </text>
    );
  };
}

/** Overlay line chart, one line per city with its own color AND dash pattern. */
export function CompareLineChart({ rows, series, unit, summary, xLabel }: { rows: ChartRow[]; series: ChartSeries[]; unit: string; summary: string; xLabel: string }) {
  const c = useChartColors();
  const colors = useSeriesColors();
  const lastIndex = (key: string) => {
    for (let i = rows.length - 1; i >= 0; i--) if (typeof rows[i][key] === "number") return i;
    return -1;
  };
  return (
    <figure className="flex flex-col gap-2">
      <div role="img" aria-label={summary} className="h-72 w-full text-text">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 8, right: 84, bottom: 0, left: -12 }} accessibilityLayer>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} axisLine={{ stroke: c.grid }} interval="preserveStartEnd" minTickGap={16} />
            <YAxis tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: c.muted, strokeDasharray: "3 3" }}
              content={({ active, payload, label }) =>
                active && payload?.length ? (
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
                    <p className="font-semibold">{String(label)}</p>
                    {series.map((s) => {
                      const v = (payload[0].payload as ChartRow)[s.key];
                      return (
                        <p key={s.key} className="flex items-center gap-1.5">
                          <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: colors[s.slot] }} />
                          {s.name}: <strong>{typeof v === "number" ? fmt(v) : "n/a"}</strong>
                        </p>
                      );
                    })}
                    <p className="text-muted">{unit}</p>
                  </div>
                ) : null
              }
            />
            <Legend wrapperStyle={{ fontSize: 12 }} formatter={(value: string) => <span style={{ color: c.text }}>{value}</span>} />
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={colors[s.slot]}
                strokeWidth={2}
                strokeDasharray={SERIES_DASH[s.slot] || undefined}
                dot={false}
                activeDot={{ r: 4, stroke: c.surface, strokeWidth: 2 }}
                connectNulls={false}
                isAnimationActive={false}
                label={EndLabel({ name: s.name, color: colors[s.slot], last: lastIndex(s.key) })}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left">
            <caption className="sr-only">{summary}</caption>
            <thead className="text-muted">
              <tr>
                <th scope="col">{xLabel}</th>
                {series.map((s) => (
                  <th key={s.key} scope="col">
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={String(r.x)} className="border-t border-border">
                  <th scope="row" className="font-normal">
                    {r.label}
                  </th>
                  {series.map((s) => (
                    <td key={s.key} className="font-mono">
                      {typeof r[s.key] === "number" ? fmt(r[s.key] as number) : "n/a"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export function dateLabel(date: string, many: boolean): string {
  return formatLocalDate(date, many ? { day: "numeric", month: "short" } : { weekday: "short", day: "numeric" });
}
