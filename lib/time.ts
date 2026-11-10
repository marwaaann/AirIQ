/**
 * Local-time helpers.
 *
 * Open-Meteo's `timezone=auto` labels every hour with ONE fixed offset (the
 * zone's current offset) rather than true wall-clock time. Verified on
 * 2026-11-10: London returned 24 hourly stamps on 2026-10-25, the day BST
 * ended. AirIQ therefore converts those labels to real UTC with the response's
 * `utc_offset_seconds` (exact, because Open-Meteo applied that same offset) and
 * derives the true local date/hour from UTC with the IANA zone. Pure module.
 */

export interface LocalParts {
  /** Local calendar date "YYYY-MM-DD". */
  date: string;
  /** Local hour 0–23. */
  hour: number;
  /** Day of week, 0 = Monday … 6 = Sunday. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
      });
    } catch {
      // Unknown zone: fall back to UTC rather than the browser's zone.
      f = new Intl.DateTimeFormat("en-CA", {
        timeZone: "UTC",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
      });
    }
    formatters.set(timeZone, f);
  }
  return f;
}

/** Weekday (0 = Monday) of a "YYYY-MM-DD" calendar date. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (js + 6) % 7;
}

/** True local date/hour/weekday of a UTC instant in an IANA time zone. */
export function localParts(utcIso: string | number, timeZone: string): LocalParts {
  const ms = typeof utcIso === "number" ? utcIso : Date.parse(utcIso);
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)?.value ?? "00";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { date, hour: Number(get("hour")) % 24, weekday: weekdayOf(date) };
}

/** Add `n` days to a "YYYY-MM-DD" date. */
export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** The `n` consecutive dates ending at `end` (inclusive), oldest first. */
export function datesEnding(end: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => addDays(end, i - (n - 1)));
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00`;
}
