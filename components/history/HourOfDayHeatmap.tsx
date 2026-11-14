"use client";

import { formatIndex, getCategory } from "@/lib/aqi-categories";
import type { WeekdayHourCell } from "@/lib/history-stats";
import { formatHour, WEEKDAY_SHORT } from "@/lib/time";
import type { AqiScale } from "@/types/air";

/**
 * Weekday × local hour matrix of average AQI. Colors carry the category
 * pattern too; exact values are in the visually hidden table.
 */
export function HourOfDayHeatmap({ matrix, scale, summary }: { matrix: WeekdayHourCell[][]; scale: AqiScale; summary: string }) {
  return (
    <figure className="flex flex-col gap-2">
      <div role="img" aria-label={summary} className="w-full">
        <div className="grid grid-cols-[2rem_repeat(24,minmax(0,1fr))] gap-[2px] text-[10px] text-muted">
          <span />
          {Array.from({ length: 24 }, (_, h) => (
            <span key={h} className="text-center" aria-hidden>
              {h % 3 === 0 ? h : ""}
            </span>
          ))}
          {matrix.map((row, wd) => (
            <div key={wd} className="contents">
              <span className="pr-1 leading-4" aria-hidden>
                {WEEKDAY_SHORT[wd]}
              </span>
              {row.map((cell) => {
                const cat = cell.mean !== null ? getCategory(cell.mean, scale) : null;
                return (
                  <span
                    key={cell.hour}
                    title={
                      cell.mean !== null
                        ? `${WEEKDAY_SHORT[wd]} ${formatHour(cell.hour)}: average ${formatIndex(cell.mean, scale)} (${cat?.label}), ${cell.n} h`
                        : `${WEEKDAY_SHORT[wd]} ${formatHour(cell.hour)}: no data`
                    }
                    className={`h-4 rounded-[2px] ${cat ? `aqi-pattern-${cat.pattern}` : "bg-surface-2"}`}
                    style={cat ? { backgroundColor: cat.color } : undefined}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <figcaption className="text-xs text-muted">Average AQI by weekday and local hour (0–23). Grey = no data.</figcaption>
      <div className="sr-only">
        <table>
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Weekday</th>
            {Array.from({ length: 24 }, (_, h) => (
              <th key={h} scope="col">
                {formatHour(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.map((row, wd) => (
            <tr key={wd}>
              <th scope="row">{WEEKDAY_SHORT[wd]}</th>
              {row.map((c) => (
                <td key={c.hour}>{c.mean !== null ? formatIndex(c.mean, scale) : "no data"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
        </div>
    </figure>
  );
}
