"use client";

import { CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from "recharts";

import { useChartColors } from "@/components/charts/chart-kit";
import { formatLocalDate } from "@/lib/format";
import { WEATHER_VAR_INFO, formatR, linearFit, type Correlation, type DailyPair, type WeatherVar } from "@/lib/weather-stats";

const fmt = (v: number) => (Math.abs(v) >= 100 ? String(Math.round(v)) : v.toFixed(1));

/** Daily mean PM2.5 against one weather variable, with a least-squares trend line. */
export function WeatherScatter({ pairs, variable, correlation }: { pairs: readonly DailyPair[]; variable: WeatherVar; correlation: Correlation | undefined }) {
  const c = useChartColors();
  const info = WEATHER_VAR_INFO[variable];
  const xs = pairs.map((p) => p.value);
  const fit = linearFit(
    xs,
    pairs.map((p) => p.pm25),
  );
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const rText = correlation?.r !== undefined ? `Spearman r = ${formatR(correlation.r)} (${correlation.strength})` : "Correlation not computable";
  const summary = `Scatter plot of daily mean PM2.5 against daily ${info.daily === "total" ? "total" : "mean"} ${info.noun} for ${pairs.length} days. ${rText}.`;

  return (
    <figure className="flex flex-col gap-2">
      <div role="img" aria-label={summary} className="h-64 w-full sm:h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart margin={{ top: 8, right: 12, bottom: 18, left: -8 }}>
            <CartesianGrid stroke={c.grid} strokeDasharray="3 3" />
            <XAxis
              type="number"
              dataKey="value"
              domain={["auto", "auto"]}
              tick={{ fill: c.muted, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: c.grid }}
              tickFormatter={(v: number) => fmt(v)}
              label={{ value: `${info.label} (${info.unit})`, position: "insideBottom", offset: -12, fill: c.muted, fontSize: 11 }}
            />
            <YAxis type="number" dataKey="pm25" tick={{ fill: c.muted, fontSize: 11 }} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmt(v)} />
            <Tooltip
              cursor={{ strokeDasharray: "3 3", stroke: c.muted }}
              content={({ active, payload }) => {
                const p = active ? (payload?.[0]?.payload as DailyPair | undefined) : undefined;
                return p ? (
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
                    <p className="font-semibold">{formatLocalDate(p.date, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</p>
                    <p>
                      PM2.5: <strong>{fmt(p.pm25)}</strong> µg/m³
                    </p>
                    <p>
                      {info.label}: <strong>{fmt(p.value)}</strong> {info.unit}
                    </p>
                    <p className="text-muted">{p.hours} paired hours</p>
                  </div>
                ) : null;
              }}
            />
            {fit && xMax > xMin ? (
              <ReferenceLine
                segment={[
                  { x: xMin, y: fit.intercept + fit.slope * xMin },
                  { x: xMax, y: fit.intercept + fit.slope * xMax },
                ]}
                stroke={c.model}
                strokeWidth={2}
                strokeDasharray="6 4"
                ifOverflow="extendDomain"
              />
            ) : null}
            <Scatter data={[...pairs]} fill={c.official} fillOpacity={0.75} stroke={c.surface} strokeWidth={1.5} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: c.official }} /> One day (daily mean PM2.5, µg/m³)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-5 border-t-2 border-dashed" style={{ borderColor: c.model }} /> Least-squares trend line
        </span>
        <span>
          {rText} · {pairs.length} days
        </span>
      </figcaption>
      <div className="sr-only">
        <table>
          <caption>{summary}</caption>
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">PM2.5 µg/m³</th>
              <th scope="col">
                {info.label} ({info.unit})
              </th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((p) => (
              <tr key={p.date}>
                <th scope="row">{p.date}</th>
                <td>{fmt(p.pm25)}</td>
                <td>{fmt(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
