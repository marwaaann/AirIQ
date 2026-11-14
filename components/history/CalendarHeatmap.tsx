"use client";

import { useState } from "react";

import { CategorySwatch } from "@/components/CategoryBadge";
import { categoriesFor, formatIndex, getCategory, POLLUTANT_INFO } from "@/lib/aqi-categories";
import { formatLocalDate } from "@/lib/format";
import type { DayStat } from "@/lib/history-stats";
import { PARTIAL_DAY_MIN_HOURS } from "@/lib/history-stats";
import { WEEKDAY_SHORT, weekdayOf } from "@/lib/time";
import type { AqiScale } from "@/types/air";

interface Cell {
  date: string;
  stat: DayStat | null;
}

function describe(cell: Cell, scale: AqiScale): string {
  const label = formatLocalDate(cell.date, { weekday: "long", day: "numeric", month: "long" });
  const s = cell.stat;
  if (!s || s.mean === null) return `${label}: no data`;
  const cat = getCategory(s.mean, scale);
  return `${label}: average ${formatIndex(s.mean, scale)} (${cat.label}), max ${formatIndex(s.max ?? 0, scale)}${s.dominant ? `, mainly ${POLLUTANT_INFO[s.dominant].short}` : ""}, ${s.validHours} of 24 hours${s.partial ? ", partial day" : ""}`;
}

/**
 * One cell per local day (columns = weeks, rows = Mon…Sun), colored and
 * patterned by the daily-mean category. Cells are buttons so the tooltip is
 * reachable by keyboard; partial days get a dashed outline and reduced fill.
 */
export function CalendarHeatmap({ dates, days, scale }: { dates: readonly string[]; days: readonly DayStat[]; scale: AqiScale }) {
  const [active, setActive] = useState<string | null>(null);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const cells: Cell[] = dates.map((date) => ({ date, stat: byDate.get(date) ?? null }));

  // Pad the first week so rows line up with weekdays.
  const lead = cells.length ? weekdayOf(cells[0].date) : 0;
  const padded: (Cell | null)[] = [...Array.from({ length: lead }, () => null), ...cells];
  const weeks: (Cell | null)[][] = [];
  for (let i = 0; i < padded.length; i += 7) weeks.push(padded.slice(i, i + 7));
  const activeCell = cells.find((c) => c.date === active) ?? null;
  const cats = categoriesFor(scale);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        <div className="grid shrink-0 grid-rows-7 gap-1 pt-0 text-[10px] leading-4 text-muted" aria-hidden>
          {WEEKDAY_SHORT.map((d) => (
            <span key={d} className="h-5">
              {d}
            </span>
          ))}
        </div>
        <div role="group" aria-label="Daily average AQI calendar, one button per day" className="flex gap-1">
          {weeks.map((week, wi) => (
            <div key={wi} className="grid grid-rows-7 gap-1">
              {Array.from({ length: 7 }, (_, di) => {
                const cell = week[di];
                if (!cell) return <span key={di} className="h-5 w-5" aria-hidden />;
                const s = cell.stat;
                const cat = s && s.mean !== null ? getCategory(s.mean, scale) : null;
                const text = describe(cell, scale);
                return (
                  <button
                    key={cell.date}
                    type="button"
                    aria-label={text}
                    onMouseEnter={() => setActive(cell.date)}
                    onMouseLeave={() => setActive((a) => (a === cell.date ? null : a))}
                    onFocus={() => setActive(cell.date)}
                    onBlur={() => setActive((a) => (a === cell.date ? null : a))}
                    className={`relative h-5 w-5 rounded-[4px] ${
                      cat ? `aqi-pattern-${cat.pattern}` : "bg-surface-2"
                    } ${s?.partial ? "opacity-60 outline-2 outline-dashed outline-offset-[-2px] outline-text/70" : "ring-1 ring-black/10"}`}
                    style={cat ? { backgroundColor: cat.color } : undefined}
                  >
                    {!cat ? (
                      <span aria-hidden className="absolute inset-0 flex items-center justify-center text-[9px] text-muted">
                        –
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      <p className="min-h-10 text-sm" aria-live="polite">
        {activeCell ? describe(activeCell, scale) : <span className="text-muted">Hover or focus a day for details.</span>}
      </p>

      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted" aria-label="Calendar legend">
        {cats.map((c) => (
          <li key={c.key} className="inline-flex items-center gap-1">
            <CategorySwatch category={c} className="h-3 w-3" /> {c.label}
          </li>
        ))}
        <li className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-3 w-3 rounded-[3px] bg-surface-2 opacity-60 outline-1 outline-dashed outline-text" />
          Partial day (&lt;{PARTIAL_DAY_MIN_HOURS} h of data)
        </li>
        <li className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-3 w-3 rounded-[3px] bg-surface-2 ring-1 ring-black/10" />
          No data
        </li>
      </ul>
    </div>
  );
}
