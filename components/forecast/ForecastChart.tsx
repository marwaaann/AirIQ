"use client";

import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { categoryBands, niceYMax, useChartColors } from "@/components/charts/chart-kit";
import { getCategory } from "@/lib/aqi-categories";
import { formatInZone } from "@/lib/format";
import type { AqiScale } from "@/types/air";

export interface ForecastRow {
  t: number;
  official: number | null;
  officialPm25: number | null;
  model: number | null;
  band: [number, number] | null;
}

function TooltipBody({ row, scale, tz }: { row: ForecastRow; scale: AqiScale; tz: string }) {
  const unit = scale === "us" ? "US AQI" : "EU AQI";
  const cat = row.official !== null ? getCategory(row.official, scale) : null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold">{formatInZone(row.t, tz, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} local</p>
      <p>
        Official: <strong>{row.official ?? "n/a"}</strong> {unit}
        {cat ? ` (${cat.label})` : ""}
      </p>
      <p>Official PM2.5 sub-index: {row.officialPm25 ?? "n/a"}</p>
      {row.model !== null ? (
        <p>
          AirIQ trend model (PM2.5): <strong>{row.model}</strong>
          {row.band ? ` · 80% range ${row.band[0]}–${row.band[1]}` : ""}
        </p>
      ) : null}
    </div>
  );
}

export function ForecastChart({ rows, nowMs, scale, tz, summary }: { rows: ForecastRow[]; nowMs: number; scale: AqiScale; tz: string; summary: string }) {
  const c = useChartColors();
  const dataMax = Math.max(0, ...rows.flatMap((r) => [r.official ?? 0, r.officialPm25 ?? 0, r.model ?? 0, r.band?.[1] ?? 0]));
  const yMax = niceYMax(dataMax, scale);
  const t0 = rows[0]?.t ?? nowMs;
  const t1 = rows[rows.length - 1]?.t ?? nowMs;
  // A tick every 12 h keeps labels readable on mobile.
  const ticks: number[] = [];
  for (let t = t0; t <= t1; t += 12 * 3600_000) ticks.push(t);

  return (
    <figure className="flex flex-col gap-2">
      <div role="img" aria-label={summary} className="h-72 w-full sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: -12 }} accessibilityLayer>
            {categoryBands(scale, yMax, c.bandOpacity)}
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={[t0, t1]}
              ticks={ticks}
              tickFormatter={(t: number) => formatInZone(t, tz, { weekday: "short", hour: "2-digit", minute: "2-digit" })}
              tick={{ fill: c.muted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: c.grid }}
              minTickGap={20}
            />
            <YAxis domain={[0, yMax]} tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
            <Tooltip
              cursor={{ stroke: c.muted, strokeDasharray: "3 3" }}
              content={({ active, payload }) => (active && payload?.[0] ? <TooltipBody row={payload[0].payload as ForecastRow} scale={scale} tz={tz} /> : null)}
            />
            <Area dataKey="band" stroke="none" fill={c.model} fillOpacity={0.18} connectNulls={false} isAnimationActive={false} name="Model 80% range" />
            <Line dataKey="officialPm25" stroke={c.sub} strokeWidth={1.4} strokeDasharray="2 3" dot={false} connectNulls={false} isAnimationActive={false} name="Official PM2.5 sub-index" />
            <Line dataKey="official" stroke={c.official} strokeWidth={2.4} dot={false} connectNulls={false} isAnimationActive={false} name="Official (CAMS via Open-Meteo)" />
            <Line dataKey="model" stroke={c.model} strokeWidth={2.2} strokeDasharray="7 4" dot={false} connectNulls={false} isAnimationActive={false} name="AirIQ trend model" />
            <ReferenceLine x={nowMs} stroke={c.now} strokeWidth={2} label={{ value: "Now", fill: c.now, fontSize: 11, position: "insideTopLeft" }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-6" style={{ backgroundColor: c.official }} /> Official (CAMS via Open-Meteo)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden width="24" height="4">
            <line x1="0" y1="2" x2="24" y2="2" stroke={c.model} strokeWidth="2.5" strokeDasharray="7 4" />
          </svg>
          AirIQ trend model (PM2.5 only, 48 h)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-6 rounded-sm" style={{ backgroundColor: c.model, opacity: 0.25 }} /> Model 80% range
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg aria-hidden width="24" height="4">
            <line x1="0" y1="2" x2="24" y2="2" stroke={c.sub} strokeWidth="2" strokeDasharray="2 3" />
          </svg>
          Official PM2.5 sub-index
        </span>
      </figcaption>
    </figure>
  );
}
