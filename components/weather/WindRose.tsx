"use client";

import { useState } from "react";

import { useChartColors } from "@/components/charts/chart-kit";
import { MIN_SECTOR_HOURS, type WindRose as WindRoseData } from "@/lib/weather-stats";

const SIZE = 280;
const C = SIZE / 2;
const R = 112;

function wedge(centerDeg: number, r: number): string {
  // Compass degrees (0 = north, clockwise) to SVG coordinates.
  const a0 = ((centerDeg - 11.25 + 1) * Math.PI) / 180;
  const a1 = ((centerDeg + 11.25 - 1) * Math.PI) / 180;
  const p = (a: number) => `${C + r * Math.sin(a)},${C - r * Math.cos(a)}`;
  return `M${C},${C} L${p(a0)} A${r},${r} 0 0 1 ${p(a1)} Z`;
}

/** Mean PM2.5 by the direction the wind blows FROM (16 sectors). */
export function WindRose({ rose }: { rose: WindRoseData }) {
  const c = useChartColors();
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...rose.sectors.map((s) => (s.meanPm25 !== null && !s.lowCount ? s.meanPm25 : 0)));
  const ringStep = max > 100 ? 50 : max > 40 ? 20 : max > 20 ? 10 : 5;
  const rings: number[] = [];
  for (let v = ringStep; v <= max; v += ringStep) rings.push(v);
  const scale = (v: number) => (Math.min(v, max) / max) * R;
  const reliable = rose.sectors.filter((s) => !s.lowCount && s.meanPm25 !== null);
  const worst = reliable.reduce<(typeof reliable)[number] | null>((a, s) => (!a || (s.meanPm25 ?? 0) > (a.meanPm25 ?? 0) ? s : a), null);
  const cleanest = reliable.reduce<(typeof reliable)[number] | null>((a, s) => (!a || (s.meanPm25 ?? 0) < (a.meanPm25 ?? 0) ? s : a), null);
  const summary = worst && cleanest
    ? `Wind rose of mean PM2.5 by wind direction over ${rose.hours} hours. Highest when wind comes from ${worst.name} (${worst.meanPm25!.toFixed(1)} µg/m³, ${worst.hours} h); lowest from ${cleanest.name} (${cleanest.meanPm25!.toFixed(1)} µg/m³, ${cleanest.hours} h).`
    : `Wind rose of mean PM2.5 by wind direction: not enough hours per direction.`;
  const h = hover !== null ? rose.sectors[hover] : null;

  return (
    <figure className="flex flex-col items-center gap-2">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[18rem]" role="img" aria-label={summary}>
        <defs>
          <pattern id="rose-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke={c.muted} strokeWidth="1.5" />
          </pattern>
        </defs>
        {rings.map((v) => (
          <g key={v}>
            <circle cx={C} cy={C} r={scale(v)} fill="none" stroke={c.grid} />
            <text x={C + 3} y={C - scale(v) + 10} fontSize="9" fill={c.muted}>
              {v}
            </text>
          </g>
        ))}
        <line x1={C} y1={C - R} x2={C} y2={C + R} stroke={c.grid} />
        <line x1={C - R} y1={C} x2={C + R} y2={C} stroke={c.grid} />
        {rose.sectors.map((s) =>
          s.meanPm25 === null ? null : (
            <path
              key={s.index}
              d={wedge(s.center, Math.max(4, scale(s.meanPm25)))}
              fill={s.lowCount ? "url(#rose-hatch)" : c.official}
              fillOpacity={s.lowCount ? 0.9 : hover === s.index ? 0.95 : 0.75}
              stroke={c.surface}
              strokeWidth={2}
              onMouseEnter={() => setHover(s.index)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{`${s.name}: ${s.meanPm25.toFixed(1)} µg/m³ over ${s.hours} h${s.lowCount ? " (few hours)" : ""}`}</title>
            </path>
          ),
        )}
        {(["N", "E", "S", "W"] as const).map((d, i) => {
          const a = (i * 90 * Math.PI) / 180;
          return (
            <text key={d} x={C + (R + 14) * Math.sin(a)} y={C - (R + 14) * Math.cos(a) + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill={c.text}>
              {d}
            </text>
          );
        })}
      </svg>
      <p className="min-h-4 text-xs" aria-hidden>
        {h && h.meanPm25 !== null ? (
          <>
            From <strong>{h.name}</strong>: {h.meanPm25.toFixed(1)} µg/m³ · {h.hours} h{h.lowCount ? " · few hours, unreliable" : ""}
          </>
        ) : (
          <span className="text-muted">Hover a wedge for details</span>
        )}
      </p>
      <figcaption className="flex flex-col gap-1 text-center text-xs text-muted">
        <span className="inline-flex items-center justify-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-3 rounded-sm" style={{ backgroundColor: c.official, opacity: 0.75 }} /> Mean PM2.5 (µg/m³)
          </span>
          <span className="inline-flex items-center gap-1.5">
            <svg aria-hidden width="12" height="10">
              <rect width="12" height="10" fill="url(#rose-hatch)" />
            </svg>
            Fewer than {MIN_SECTOR_HOURS} h (greyed)
          </span>
        </span>
        <span>
          Direction the wind blows from. {rose.hours} hours used; {rose.calmHours} calm hours (&lt; 1 km/h) left out.
        </span>
      </figcaption>
      <details className="w-full text-xs">
        <summary className="cursor-pointer text-muted">Show as table</summary>
        <table className="mt-2 w-full text-left">
          <caption className="sr-only">{summary}</caption>
          <thead>
            <tr className="text-muted">
              <th scope="col">From</th>
              <th scope="col">Mean PM2.5</th>
              <th scope="col">Hours</th>
            </tr>
          </thead>
          <tbody>
            {rose.sectors.map((s) => (
              <tr key={s.index} className={s.lowCount ? "text-muted" : ""}>
                <th scope="row">{s.name}</th>
                <td className="font-mono">{s.meanPm25 !== null ? s.meanPm25.toFixed(1) : "n/a"}</td>
                <td>
                  {s.hours}
                  {s.lowCount && s.hours > 0 ? " (few hours)" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
