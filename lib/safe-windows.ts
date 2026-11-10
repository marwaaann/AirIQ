/**
 * Safe outdoor window finder over the OFFICIAL hourly forecast.
 * Pure module (relative imports only).
 */

import { addDays, localParts, WEEKDAY_SHORT } from "./time.ts";

export type WindowActivity = "walk" | "exercise" | "windows";

export interface ForecastHour {
  /** UTC ISO start of the hour. */
  time: string;
  value: number | null;
}

export interface SunTimes {
  /** UTC ISO */
  sunrise: string;
  sunset: string;
}

export interface SafeWindow {
  /** UTC ISO start of the first hour. */
  start: string;
  /** UTC ISO end (exclusive: start of the hour after the last one). */
  end: string;
  hours: number;
  min: number;
  max: number;
  mean: number;
  /** Share of the window's hours that start in daylight (null if unknown). */
  daylight: number | null;
  /** e.g. "Tomorrow 06:00–09:00". */
  label: string;
}

export type SafeWindowResult =
  | { status: "ok"; mode: "threshold" | "lowest"; windows: SafeWindow[] }
  | { status: "none"; leastBad: SafeWindow[] }
  | { status: "no-data" };

export interface FindOptions {
  points: readonly ForecastHour[];
  threshold: number;
  timeZone: string;
  activity: WindowActivity;
  minHours: 1 | 2 | 3;
  /** Epoch ms of "now". */
  now: number;
  horizonHours?: number;
  /** Only applies to activity "exercise". */
  daylightOnly?: boolean;
  sun?: readonly SunTimes[] | null;
  maxWindows?: number;
}

const HOUR = 3600_000;

const hm = (ms: number, timeZone: string) => {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
};

/** "Today 06:00–09:00", "Tomorrow 23:00–02:00 (next day)", "Today 05:00–Thu 06:00", "Thu 10:00–12:00". */
export function windowLabel(startMs: number, endMs: number, timeZone: string, nowMs: number): string {
  const today = localParts(nowMs, timeZone).date;
  const s = localParts(startMs, timeZone);
  const dayWord = s.date === today ? "Today" : s.date === addDays(today, 1) ? "Tomorrow" : WEEKDAY_SHORT[s.weekday];
  const e = localParts(endMs, timeZone);
  const endHm = hm(endMs, timeZone);
  if (e.date === s.date) return `${dayWord} ${hm(startMs, timeZone)}–${endHm}`;
  if (e.date === addDays(s.date, 1)) return `${dayWord} ${hm(startMs, timeZone)}–${endHm}${endHm === "00:00" ? " (midnight)" : " (next day)"}`;
  // Spans more than one midnight: name the end day explicitly.
  return `${dayWord} ${hm(startMs, timeZone)}–${WEEKDAY_SHORT[e.weekday]} ${endHm}`;
}

function daylightShare(startMs: number, hours: number, sun: readonly SunTimes[] | null | undefined): number | null {
  if (!sun || sun.length === 0) return null;
  const spans = sun.map((d) => [Date.parse(d.sunrise), Date.parse(d.sunset)] as const);
  let lit = 0;
  for (let k = 0; k < hours; k++) {
    // Count an hour as daylight if its midpoint is between sunrise and sunset.
    const mid = startMs + k * HOUR + HOUR / 2;
    if (spans.some(([a, b]) => mid >= a && mid < b)) lit++;
  }
  return lit / hours;
}

interface Hour {
  t: number;
  v: number | null;
}

function build(run: Hour[], o: FindOptions): SafeWindow {
  const vals = run.map((h) => h.v as number);
  const startMs = run[0].t;
  const endMs = run[run.length - 1].t + HOUR;
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(endMs).toISOString(),
    hours: run.length,
    min: Math.min(...vals),
    max: Math.max(...vals),
    mean: vals.reduce((a, b) => a + b, 0) / vals.length,
    daylight: daylightShare(startMs, run.length, o.sun),
    label: windowLabel(startMs, endMs, o.timeZone, o.now),
  };
}

/** The `count` cleanest non-overlapping windows of exactly `len` consecutive valid hours. */
function lowest(hours: Hour[], len: number, count: number, o: FindOptions): SafeWindow[] {
  const cands: { i: number; mean: number }[] = [];
  for (let i = 0; i + len <= hours.length; i++) {
    const w = hours.slice(i, i + len);
    if (w.some((h) => h.v === null)) continue;
    if (w[len - 1].t - w[0].t !== (len - 1) * HOUR) continue;
    cands.push({ i, mean: w.reduce((a, h) => a + (h.v as number), 0) / len });
  }
  cands.sort((a, b) => a.mean - b.mean || a.i - b.i);
  const chosen: number[] = [];
  for (const c of cands) {
    if (chosen.every((j) => c.i + len <= j || j + len <= c.i)) chosen.push(c.i);
    if (chosen.length === count) break;
  }
  return chosen.sort((a, b) => a - b).map((i) => build(hours.slice(i, i + len), o));
}

export function findSafeWindows(o: FindOptions): SafeWindowResult {
  const horizon = (o.horizonHours ?? 48) * HOUR;
  const startOfHour = Math.floor(o.now / HOUR) * HOUR;
  const hours: Hour[] = o.points
    .map((p) => ({ t: Date.parse(p.time), v: typeof p.value === "number" && Number.isFinite(p.value) ? p.value : null }))
    .filter((h) => h.t >= startOfHour && h.t < startOfHour + horizon)
    .sort((a, b) => a.t - b.t);
  if (!hours.some((h) => h.v !== null)) return { status: "no-data" };
  const maxWindows = o.maxWindows ?? 6;

  if (o.activity === "windows") {
    // Airing out a home: simply the cleanest hours, regardless of threshold.
    const w = lowest(hours, o.minHours, 3, o);
    return w.length ? { status: "ok", mode: "lowest", windows: w } : { status: "no-data" };
  }

  // Daylight-only (exercise): dark hours break a run, so long runs are split
  // into their daylight parts instead of being rejected as "mostly dark".
  const daylightFilter = o.activity === "exercise" && o.daylightOnly && o.sun && o.sun.length > 0;
  const lit = (h: Hour) => !daylightFilter || daylightShare(h.t, 1, o.sun) === 1;

  const runs: Hour[][] = [];
  let cur: Hour[] = [];
  for (const h of hours) {
    const ok = h.v !== null && h.v <= o.threshold && lit(h);
    const contiguous = cur.length === 0 || h.t - cur[cur.length - 1].t === HOUR;
    if (ok && contiguous) cur.push(h);
    else {
      if (cur.length) runs.push(cur);
      cur = ok ? [h] : [];
    }
  }
  if (cur.length) runs.push(cur);

  const windows = runs.filter((r) => r.length >= o.minHours).map((r) => build(r, o));
  if (windows.length) return { status: "ok", mode: "threshold", windows: windows.slice(0, maxWindows) };
  return { status: "none", leastBad: lowest(hours, o.minHours, 3, o) };
}
