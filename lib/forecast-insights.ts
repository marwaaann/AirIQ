/**
 * Helpers for the forecast view. Pure module (relative imports only).
 */

import { euPm25Index, pm25Index, trailingMean } from "./aqi.ts";
import { localParts } from "./time.ts";

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export interface TimedValue {
  /** UTC ISO */
  time: string;
  value: number | null;
}

export interface DailyRange {
  date: string;
  min: number;
  mean: number;
  max: number;
  /** Valid hours in this local day. */
  n: number;
}

/** min / mean / max per true local day. Days with no valid hours are omitted. */
export function dailyRanges(points: readonly TimedValue[], timeZone: string): DailyRange[] {
  const by = new Map<string, number[]>();
  for (const p of points) {
    if (!isNum(p.value)) continue;
    const d = localParts(p.time, timeZone).date;
    const arr = by.get(d);
    if (arr) arr.push(p.value);
    else by.set(d, [p.value]);
  }
  return [...by.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, v]) => ({
      date,
      min: Math.min(...v),
      max: Math.max(...v),
      mean: v.reduce((a, b) => a + b, 0) / v.length,
      n: v.length,
    }));
}

export interface CleanWindow {
  start: string;
  /** UTC ISO of the last hour in the window. */
  end: string;
  min: number;
  max: number;
  mean: number;
  hours: number;
}

/**
 * The `count` cleanest non-overlapping windows of `length` consecutive hours
 * within the first `horizon` points. A window qualifies only if every hour in
 * it has a value (gaps are never bridged).
 */
export function cleanestWindows(points: readonly TimedValue[], horizon = 48, length = 3, count = 3): CleanWindow[] {
  const pts = points.slice(0, horizon);
  const candidates: { i: number; mean: number }[] = [];
  for (let i = 0; i + length <= pts.length; i++) {
    const w = pts.slice(i, i + length).map((p) => p.value);
    if (!w.every(isNum)) continue;
    // Consecutive hours only (no jumps in the timestamp sequence).
    const t0 = Date.parse(pts[i].time);
    const t1 = Date.parse(pts[i + length - 1].time);
    if (t1 - t0 !== (length - 1) * 3600_000) continue;
    candidates.push({ i, mean: (w as number[]).reduce((a, b) => a + b, 0) / length });
  }
  candidates.sort((a, b) => a.mean - b.mean || a.i - b.i);
  const chosen: { i: number; mean: number }[] = [];
  for (const c of candidates) {
    if (chosen.every((x) => c.i + length <= x.i || x.i + length <= c.i)) chosen.push(c);
    if (chosen.length === count) break;
  }
  return chosen
    .sort((a, b) => a.i - b.i)
    .map(({ i, mean }) => {
      const w = pts.slice(i, i + length).map((p) => p.value as number);
      return { start: pts[i].time, end: pts[i + length - 1].time, min: Math.min(...w), max: Math.max(...w), mean, hours: length };
    });
}

export interface Agreement {
  /** Mean absolute difference in index points. */
  mad: number;
  n: number;
  verdict: "close" | "broad" | "divergent";
  text: string;
}

/** Mean |official − model| over hours where both exist. */
export function agreement(official: readonly (number | null)[], model: readonly (number | null)[]): Agreement | null {
  let s = 0;
  let n = 0;
  for (let i = 0; i < Math.min(official.length, model.length); i++) {
    const a = official[i];
    const b = model[i];
    if (!isNum(a) || !isNum(b)) continue;
    s += Math.abs(a - b);
    n++;
  }
  if (n === 0) return null;
  const mad = s / n;
  const verdict = mad < 10 ? "close" : mad < 25 ? "broad" : "divergent";
  const text =
    verdict === "close"
      ? "The official forecast and the trend model closely agree."
      : verdict === "broad"
        ? "They broadly agree, but differ by a category step at times."
        : "They disagree substantially. The official forecast models weather and emissions; the trend model only extrapolates recent patterns.";
  return { mad, n, verdict, text };
}

/**
 * Convert PM2.5 predictions to an index on the given scale, using the same
 * convention as Open-Meteo's sub-indices:
 *   US: EPA index of the trailing 24-h mean (observed tail + predictions),
 *   EU: EEA index of the hourly value.
 */
export function pm25SeriesToIndex(
  observedTail: readonly (number | null)[],
  predictions: readonly number[],
  scale: "us" | "eu",
): (number | null)[] {
  if (scale === "eu") return predictions.map((v) => euPm25Index(v));
  const series: (number | null)[] = [...observedTail.slice(-23), ...predictions];
  const offset = series.length - predictions.length;
  return predictions.map((_, k) => {
    const m = trailingMean(series, offset + k, 24);
    return m === null ? null : pm25Index(m);
  });
}
