/** Display formatting helpers. */

export function formatConcentration(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "n/a";
  return v >= 100 ? Math.round(v).toLocaleString("en-US") : v.toFixed(1);
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "5 minutes ago", "in 2 hours", "just now". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "unknown time";
  const diffSec = Math.round((t - now) / 1000);
  const abs = Math.abs(diffSec);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  return rtf.format(Math.round(diffSec / 86400), "day");
}

/** Local time at the place, e.g. "14:30 IST". Uses the IANA zone from the API. */
export function formatPlaceTime(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      day: "numeric",
      month: "short",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(iso));
  } catch {
    return new Date(iso).toUTCString();
  }
}

export function formatRatio(r: number): string {
  if (r >= 10) return Math.round(r).toString();
  return r.toFixed(1);
}

const localFormatters = new Map<string, Intl.DateTimeFormat>();

/** Format a UTC instant in the CITY's time zone (never the browser's). */
export function formatInZone(iso: string | number, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  const key = `${timeZone}|${JSON.stringify(opts)}`;
  let f = localFormatters.get(key);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone });
    } catch {
      f = new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" });
    }
    localFormatters.set(key, f);
  }
  return f.format(new Date(iso));
}

/** "Mon 3 Nov" for a local "YYYY-MM-DD" date (calendar date, zone-independent). */
export function formatLocalDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}
