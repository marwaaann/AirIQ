/**
 * History statistics over hourly AQI values bucketed by the city's TRUE local
 * time (see lib/time.ts). Missing hours stay missing: every aggregate reports
 * how many valid hours it used, and nothing is interpolated.
 *
 * Pure module (relative imports only) so it runs under `node --test`.
 */

import { categoriesFor, getCategory, type PollutantKey } from "./aqi-categories.ts";
import { datesEnding, formatHour, localParts } from "./time.ts";

/** Days with fewer valid hours than this are "partial". */
export const PARTIAL_DAY_MIN_HOURS = 18;
/** Hour-of-day / weekday cells need at least this many samples to be reported. */
export const MIN_SAMPLES_PER_HOUR = 3;

export interface LocalHour {
  date: string;
  hour: number;
  weekday: number;
  value: number | null;
  /** Per-pollutant sub-indices on the same scale (for the dominant pollutant). */
  subs?: Partial<Record<PollutantKey, number>>;
}

export interface RawHour {
  /** UTC ISO time. */
  time: string;
  value: number | null;
  subs?: Partial<Record<PollutantKey, number>>;
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Attach true local date/hour/weekday to each hourly value. */
export function toLocalHours(raw: readonly RawHour[], timeZone: string): LocalHour[] {
  return raw.map((r) => {
    const p = localParts(r.time, timeZone);
    return { date: p.date, hour: p.hour, weekday: p.weekday, value: isNum(r.value) ? r.value : null, subs: r.subs };
  });
}

/* ------------------------------------------------------------------------- */
/* Daily                                                                      */
/* ------------------------------------------------------------------------- */

export interface DayStat {
  date: string;
  mean: number | null;
  max: number | null;
  validHours: number;
  /** Hourly slots present in the data for this date (valid or null). */
  totalHours: number;
  partial: boolean;
  /** Pollutant with the highest mean sub-index that day, from the source's sub-indices. */
  dominant: PollutantKey | null;
}

export function dailyStats(hours: readonly LocalHour[]): DayStat[] {
  const byDate = new Map<string, LocalHour[]>();
  for (const h of hours) {
    const arr = byDate.get(h.date);
    if (arr) arr.push(h);
    else byDate.set(h.date, [h]);
  }
  const out: DayStat[] = [];
  for (const [date, hs] of byDate) {
    const vals = hs.map((h) => h.value).filter(isNum);
    const subSum = new Map<PollutantKey, { s: number; n: number }>();
    for (const h of hs) {
      for (const [k, v] of Object.entries(h.subs ?? {}) as [PollutantKey, number][]) {
        if (!isNum(v)) continue;
        const e = subSum.get(k) ?? { s: 0, n: 0 };
        e.s += v;
        e.n += 1;
        subSum.set(k, e);
      }
    }
    let dominant: PollutantKey | null = null;
    let best = -Infinity;
    for (const [k, e] of subSum) {
      const m = e.s / e.n;
      if (m > best) {
        best = m;
        dominant = k;
      }
    }
    out.push({
      date,
      mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      max: vals.length ? Math.max(...vals) : null,
      validHours: vals.length,
      totalHours: hs.length,
      partial: vals.length < PARTIAL_DAY_MIN_HOURS,
      dominant,
    });
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export interface BestWorst {
  best: DayStat | null;
  worst: DayStat | null;
  /** True when no full day existed and partial days had to be used. */
  fromPartial: boolean;
}

/** Best/worst by daily mean. Partial days are excluded unless nothing else qualifies. */
export function bestWorst(days: readonly DayStat[]): BestWorst {
  const withMean = days.filter((d): d is DayStat & { mean: number } => isNum(d.mean));
  const full = withMean.filter((d) => !d.partial);
  const pool = full.length ? full : withMean;
  if (pool.length === 0) return { best: null, worst: null, fromPartial: false };
  let best = pool[0];
  let worst = pool[0];
  for (const d of pool) {
    if (d.mean < best.mean!) best = d;
    if (d.mean > worst.mean!) worst = d;
  }
  return { best, worst, fromPartial: full.length === 0 };
}

/* ------------------------------------------------------------------------- */
/* Period over period                                                         */
/* ------------------------------------------------------------------------- */

export interface PeriodSummary {
  mean: number | null;
  validHours: number;
  expectedHours: number;
}

export interface PeriodChange {
  current: PeriodSummary;
  previous: PeriodSummary;
  absChange: number;
  pctChange: number;
}

function summarize(hours: readonly LocalHour[], dates: ReadonlySet<string>, expectedHours: number): PeriodSummary {
  const vals = hours.filter((h) => dates.has(h.date)).map((h) => h.value).filter(isNum);
  return {
    mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
    validHours: vals.length,
    expectedHours,
  };
}

/** Mean over the `rangeDays` local days ending at `endDate` (inclusive). */
export function periodSummary(hours: readonly LocalHour[], endDate: string, rangeDays: number): PeriodSummary {
  return summarize(hours, new Set(datesEnding(endDate, rangeDays)), rangeDays * 24);
}

/**
 * This period (the `rangeDays` local days ending `endDate`) vs the equal-length
 * period before it. Returns null unless the previous period has ≥75% of its
 * hours and the current one ≥50% (the current one usually ends with a partial
 * "today").
 */
export function periodChange(hours: readonly LocalHour[], endDate: string, rangeDays: number): PeriodChange | null {
  const current = periodSummary(hours, endDate, rangeDays);
  const previous = summarize(
    hours,
    new Set(datesEnding(datesEnding(endDate, rangeDays)[0], rangeDays + 1).slice(0, rangeDays)),
    rangeDays * 24,
  );
  if (current.mean === null || previous.mean === null) return null;
  if (previous.validHours < 0.75 * previous.expectedHours || current.validHours < 0.5 * current.expectedHours) return null;
  const absChange = current.mean - previous.mean;
  return {
    current,
    previous,
    absChange,
    pctChange: previous.mean === 0 ? 0 : (absChange / previous.mean) * 100,
  };
}

/* ------------------------------------------------------------------------- */
/* Hour of day / weekday                                                      */
/* ------------------------------------------------------------------------- */

export interface HourCell {
  hour: number;
  mean: number | null;
  n: number;
}

export function hourOfDayProfile(hours: readonly LocalHour[]): HourCell[] {
  const acc = Array.from({ length: 24 }, () => ({ s: 0, n: 0 }));
  for (const h of hours) {
    if (!isNum(h.value)) continue;
    acc[h.hour].s += h.value;
    acc[h.hour].n += 1;
  }
  return acc.map((a, hour) => ({ hour, mean: a.n >= MIN_SAMPLES_PER_HOUR ? a.s / a.n : null, n: a.n }));
}

/** Highest (or lowest) mean hour among hours with enough samples. */
export function extremeHour(profile: readonly HourCell[], kind: "peak" | "low"): HourCell | null {
  let best: HourCell | null = null;
  for (const c of profile) {
    if (c.mean === null) continue;
    if (!best || (kind === "peak" ? c.mean > best.mean! : c.mean < best.mean!)) best = c;
  }
  return best;
}

export interface WeekdayHourCell {
  weekday: number;
  hour: number;
  mean: number | null;
  n: number;
}

/** 7 × 24 matrix (weekday 0 = Monday). Cells with too few samples have mean null. */
export function weekdayHourMatrix(hours: readonly LocalHour[], minSamples = 1): WeekdayHourCell[][] {
  const acc = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ s: 0, n: 0 })));
  for (const h of hours) {
    if (!isNum(h.value)) continue;
    acc[h.weekday][h.hour].s += h.value;
    acc[h.weekday][h.hour].n += 1;
  }
  return acc.map((row, weekday) =>
    row.map((a, hour) => ({ weekday, hour, mean: a.n >= minSamples ? a.s / a.n : null, n: a.n })),
  );
}

/* ------------------------------------------------------------------------- */
/* Insights                                                                   */
/* ------------------------------------------------------------------------- */

export interface InsightInput {
  scale: "us" | "eu" | "in";
  rangeDays: number;
  days: readonly DayStat[];
  profile: readonly HourCell[];
  change: PeriodChange | null;
}

const round = (v: number) => Math.round(v);

/**
 * 0–3 plain-English statements. Each one is generated only when the data
 * clearly supports it; otherwise it is omitted.
 */
export function buildInsights({ scale, rangeDays, days, profile, change }: InsightInput): string[] {
  const out: string[] = [];
  const valid = profile.filter((c) => c.mean !== null);
  const peak = extremeHour(profile, "peak");
  const low = extremeHour(profile, "low");
  if (peak && low && valid.length >= 12) {
    const overall = valid.reduce((a, c) => a + c.mean!, 0) / valid.length;
    const spread = peak.mean! - low.mean!;
    if (spread >= Math.max(5, 0.15 * overall)) {
      out.push(
        `Air is usually worst around ${formatHour(peak.hour)} local time (average ${round(peak.mean!)}) and cleanest around ${formatHour(low.hour)} (average ${round(low.mean!)}).`,
      );
    }
  }

  if (change) {
    const pct = change.pctChange;
    if (Math.abs(pct) >= 10) {
      out.push(
        `The average over the last ${rangeDays} days is ${Math.abs(round(pct))}% ${pct > 0 ? "higher" : "lower"} than the ${rangeDays} days before (${round(change.current.mean!)} vs ${round(change.previous.mean!)}).`,
      );
    } else if (Math.abs(pct) < 5) {
      out.push(
        `Air quality is about the same as the previous ${rangeDays} days (average ${round(change.current.mean!)} vs ${round(change.previous.mean!)}).`,
      );
    }
  }

  const full = days.filter((d) => !d.partial && d.mean !== null);
  if (full.length >= 3) {
    const cats = categoriesFor(scale);
    const threshold = cats.find((c) => c.rank === 3);
    if (threshold) {
      const bad = full.filter((d) => getCategory(d.mean!, scale).rank >= 3).length;
      out.push(
        bad === 0
          ? `No full day averaged “${threshold.label}” or worse in this period.`
          : `${bad} of ${full.length} full days averaged “${threshold.label}” or worse.`,
      );
    }
  }
  return out.slice(0, 3);
}
