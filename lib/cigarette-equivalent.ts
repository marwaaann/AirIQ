/**
 * Cigarette equivalent of PM2.5 exposure (Berkeley Earth rule of thumb:
 * breathing 22 µg/m³ of PM2.5 for 24 hours ≈ smoking 1 cigarette).
 *
 * A communication aid for the size of an exposure, NOT a medical measurement
 * or a statement of health risk.
 *
 * Pure module (relative imports only) so it runs under `node --test`.
 */

import { cigarettesEquivalent } from "./aqi.ts";
import { PM25_PER_CIGARETTE } from "./aqi-categories.ts";

export { PM25_PER_CIGARETTE };

export const CIGARETTE_SOURCE = {
  name: "Berkeley Earth",
  title: "Air Pollution and Cigarette Equivalence",
  url: "https://berkeleyearth.org/air-pollution-and-cigarette-equivalence/",
} as const;

export const CIGARETTE_DISCLAIMER =
  "An approximation for communicating exposure, not a medical measurement or a statement of your health risk.";

/** A 24-hour window needs at least this many valid hourly PM2.5 values. */
export const MIN_VALID_HOURS = 18;
const HOUR_MS = 3_600_000;

export interface PmHour {
  /** UTC ISO. */
  time: string;
  pm25: number | null;
}

export type WindowResult =
  | { ok: true; meanPm25: number; cigarettes: number; validHours: number; start: string; end: string }
  | { ok: false; validHours: number; start: string; end: string };

/**
 * The 24 hours ending at `endMs` (inclusive): points with endMs − 24 h < t ≤ endMs.
 * Not snapped to UTC hours, so cities with :30 or :45 offsets (whose hourly
 * points fall at :30 / :15 UTC) keep their latest reading. Mean of the valid
 * values, converted to cigarettes, when at least MIN_VALID_HOURS are valid.
 */
export function windowEquivalent(points: readonly PmHour[], endMs: number): WindowResult {
  const endHour = endMs;
  const startExclusive = endMs - 24 * HOUR_MS;
  const seen = new Set<number>();
  let sum = 0;
  for (const p of points) {
    const t = Date.parse(p.time);
    if (!(t > startExclusive && t <= endHour) || seen.has(t)) continue;
    if (typeof p.pm25 !== "number" || !Number.isFinite(p.pm25) || p.pm25 < 0) continue;
    seen.add(t);
    sum += p.pm25;
  }
  const validHours = seen.size;
  const start = new Date(startExclusive).toISOString();
  const end = new Date(endHour).toISOString();
  if (validHours < MIN_VALID_HOURS) return { ok: false, validHours, start, end };
  const meanPm25 = sum / validHours;
  return { ok: true, meanPm25, cigarettes: cigarettesEquivalent(meanPm25), validHours, start, end };
}

export type WeekResult =
  | { ok: true; cigarettes: number; days: WindowResult[] }
  | { ok: false; days: WindowResult[]; missingDays: number };

/**
 * Seven consecutive 24-hour windows ending at `endMs`. The 7-day total is the
 * sum of the daily equivalents, and is reported only if every window has
 * enough data (no gap-filling).
 */
export function weekEquivalent(points: readonly PmHour[], endMs: number): WeekResult {
  const days: WindowResult[] = [];
  for (let d = 0; d < 7; d++) days.push(windowEquivalent(points, endMs - d * 24 * HOUR_MS));
  days.reverse();
  const missingDays = days.filter((d) => !d.ok).length;
  if (missingDays) return { ok: false, days, missingDays };
  const cigarettes = days.reduce((a, d) => a + (d.ok ? d.cigarettes : 0), 0);
  return { ok: true, cigarettes, days };
}

/** "≈ 0.4", "≈ 2.3", "≈ 12": one decimal below 10, whole numbers above. */
export function formatCigarettes(n: number): string {
  if (n > 0 && n < 0.1) return "< 0.1";
  return n < 10 ? n.toFixed(1) : String(Math.round(n));
}

export function cigaretteWord(n: number): string {
  return formatCigarettes(n) === "1.0" ? "cigarette" : "cigarettes";
}
