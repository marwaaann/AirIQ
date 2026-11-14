/**
 * Alert rules: schemas, evaluation, hysteresis and quiet hours.
 * Pure module (relative imports only) so it runs under `node --test`.
 *
 * Episodes: a rule fires once when its value goes ABOVE the threshold and is
 * then "active". It re-arms only when
 *   - current trigger: the reading falls below 90% of the threshold;
 *   - forecast trigger: no forecast hour in the window exceeds the threshold.
 * Quiet hours (city local time, may cross midnight) suppress the browser
 * notification but the event is still logged, marked as suppressed.
 *
 * Current-reading rules use the headline in effect (station median, nearest
 * station or model, see lib/headline-source.ts). The event records which
 * source fired it. Values above the index top (e.g. US AQI 650) are compared
 * as computed and shown as "500+ (computed 650)".
 */

import { z } from "./zod.ts";

import { formatIndex, INDEX_TOP, isBeyondIndex, SCALE_NAME } from "./aqi-categories.ts";
import { localParts, WEEKDAY_SHORT } from "./time.ts";

export const ALERT_SCALES = ["us", "eu", "in"] as const;
export type AlertScale = (typeof ALERT_SCALES)[number];

export const ALERT_METRICS = ["aqi", "pm2_5", "pm10", "nitrogen_dioxide", "ozone"] as const;
export type AlertMetric = (typeof ALERT_METRICS)[number];
export const FORECAST_HOURS = [6, 12, 24, 48] as const;
export const REARM_FRACTION = 0.9;
export const MAX_EVENTS = 100;

const METRIC_SHORT: Record<AlertMetric, string> = {
  aqi: "AQI",
  pm2_5: "PM2.5",
  pm10: "PM10",
  nitrogen_dioxide: "NO₂",
  ozone: "O₃",
};

/* ------------------------------------------------------------------------- */
/* Schemas (used to validate everything read back from localStorage)          */
/* ------------------------------------------------------------------------- */

export const AlertCitySchema = z.object({
  name: z.string().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().min(1).max(64),
  slug: z.string().min(1).max(160),
});

export const QuietHoursSchema = z.object({
  start: z.number().int().min(0).max(23),
  end: z.number().int().min(0).max(23),
});

export const AlertTriggerSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("current") }),
  z.object({ type: z.literal("forecast"), hours: z.union([z.literal(6), z.literal(12), z.literal(24), z.literal(48)]) }),
]);

export const AlertRuleSchema = z.object({
  id: z.string().min(1).max(64),
  city: AlertCitySchema,
  metric: z.enum(ALERT_METRICS),
  scale: z.enum(ALERT_SCALES),
  threshold: z.number().int().min(1).max(1000),
  trigger: AlertTriggerSchema,
  quietHours: QuietHoursSchema.nullable(),
  enabled: z.boolean(),
  createdAt: z.string(),
});
export type AlertRule = z.infer<typeof AlertRuleSchema>;

export const RuleStateSchema = z.object({
  active: z.boolean(),
  episodeStartedAt: z.string().nullable(),
  lastValue: z.number().nullable(),
  lastEvaluatedAt: z.string().nullable(),
});
export type RuleState = z.infer<typeof RuleStateSchema>;

export const AlertEventSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  citySlug: z.string(),
  cityName: z.string(),
  kind: z.enum(["current", "forecast"]),
  metric: z.enum(ALERT_METRICS),
  scale: z.enum(ALERT_SCALES),
  threshold: z.number(),
  value: z.number(),
  title: z.string(),
  message: z.string(),
  /** Forecast only: first exceeding hour and the exceeding span (UTC ISO, end exclusive). */
  spanStart: z.string().nullable(),
  spanEnd: z.string().nullable(),
  createdAt: z.string(),
  suppressed: z.boolean(),
  read: z.boolean(),
  /** Which data fired it, e.g. "Stations (median of 18)" or "Model (Open-Meteo)". Absent on events from before Phase 9. */
  source: z.string().max(160).optional(),
});
export type AlertEvent = z.infer<typeof AlertEventSchema>;

/**
 * Lenient array schema: keeps valid items and drops malformed ones, so one
 * corrupted entry never wipes out the rest.
 */
export function lenientArray<T>(item: z.ZodType<T>, max: number) {
  return z.array(z.unknown()).transform((items) =>
    items
      .map((i) => item.safeParse(i))
      .filter((r): r is { success: true; data: T } => r.success)
      .map((r) => r.data)
      .slice(0, max),
  );
}

export const RulesStorageSchema = lenientArray(AlertRuleSchema, 50);
export const EventsStorageSchema = lenientArray(AlertEventSchema, MAX_EVENTS);
export const RuleStatesStorageSchema = z.record(z.string(), z.unknown()).transform((rec) => {
  const out: Record<string, RuleState> = {};
  for (const [k, v] of Object.entries(rec)) {
    const p = RuleStateSchema.safeParse(v);
    if (p.success) out[k] = p.data;
  }
  return out;
});

export const INITIAL_STATE: RuleState = { active: false, episodeStartedAt: null, lastValue: null, lastEvaluatedAt: null };

/* ------------------------------------------------------------------------- */
/* Readings                                                                   */
/* ------------------------------------------------------------------------- */

type SubIdx = Partial<Record<string, number>>;

export interface ReadingSource {
  /** UTC ISO */
  time: string;
  usAqi: number | null;
  euAqi: number | null;
  inAqi?: number | null;
  usSubIndices?: SubIdx;
  euSubIndices?: SubIdx;
  inSubIndices?: SubIdx;
  /** Label of the data behind the overall index, recorded on fired events. */
  sourceLabel?: string;
  /** Per-scale labels when the scales come from different sources (station US AQI, model EU AQI…). */
  sourceLabels?: Partial<Record<AlertScale, string>>;
}

/** The rule's value from a reading: overall AQI or the pollutant's sub-index, ON THE RULE'S SCALE. */
export function metricValue(src: ReadingSource, metric: AlertMetric, scale: AlertScale): number | null {
  const overall = scale === "us" ? src.usAqi : scale === "eu" ? src.euAqi : src.inAqi;
  const subs = scale === "us" ? src.usSubIndices : scale === "eu" ? src.euSubIndices : src.inSubIndices;
  const v = metric === "aqi" ? overall : subs?.[metric];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function metricLabel(metric: AlertMetric, scale: AlertScale): string {
  const s = SCALE_NAME[scale];
  return metric === "aqi" ? s : `${METRIC_SHORT[metric]} (${s} sub-index)`;
}

/** "231", or "500+ (computed 650)" above the index top. */
export function alertValueText(v: number, scale: AlertScale): string {
  return isBeyondIndex(v, scale) ? `${formatIndex(v, scale)} (computed ${Math.round(v)}, beyond the ${INDEX_TOP[scale]} top of the index)` : String(Math.round(v));
}

/* ------------------------------------------------------------------------- */
/* Quiet hours                                                                */
/* ------------------------------------------------------------------------- */

/** [start, end) in local hours; crosses midnight when start > end; start === end means none. */
export function inQuietHours(hour: number, q: { start: number; end: number } | null): boolean {
  if (!q || q.start === q.end) return false;
  return q.start < q.end ? hour >= q.start && hour < q.end : hour >= q.start || hour < q.end;
}

/* ------------------------------------------------------------------------- */
/* Formatting (city local time)                                               */
/* ------------------------------------------------------------------------- */

function hm(ms: number, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString().slice(11, 16);
  }
}

/** "Wed 14:00–18:00" or "Wed 22:00–Thu 02:00" (end exclusive). */
export function formatSpan(startMs: number, endMs: number, timeZone: string): string {
  const s = localParts(startMs, timeZone);
  const e = localParts(endMs, timeZone);
  const startTxt = `${WEEKDAY_SHORT[s.weekday]} ${hm(startMs, timeZone)}`;
  const endTxt = e.date === s.date ? hm(endMs, timeZone) : `${WEEKDAY_SHORT[e.weekday]} ${hm(endMs, timeZone)}`;
  return `${startTxt}–${endTxt}`;
}

/* ------------------------------------------------------------------------- */
/* Evaluation                                                                 */
/* ------------------------------------------------------------------------- */

const HOUR = 3600_000;

export interface ForecastSpan {
  start: number;
  /** Exclusive */
  end: number;
  max: number;
}

/** First run of consecutive forecast hours above the threshold within (now, now + hours]. */
export function forecastExceedance(
  points: readonly ReadingSource[],
  rule: Pick<AlertRule, "metric" | "scale" | "threshold">,
  now: number,
  hours: number,
): { span: ForecastSpan | null; anyExceed: boolean } {
  const pts = points
    .map((p) => ({ t: Date.parse(p.time), v: metricValue(p, rule.metric, rule.scale) }))
    .filter((p) => p.t > now && p.t <= now + hours * HOUR)
    .sort((a, b) => a.t - b.t);
  const firstIdx = pts.findIndex((p) => p.v !== null && p.v > rule.threshold);
  if (firstIdx < 0) return { span: null, anyExceed: false };
  let end = firstIdx;
  while (end + 1 < pts.length && pts[end + 1].v !== null && (pts[end + 1].v as number) > rule.threshold && pts[end + 1].t - pts[end].t === HOUR) end++;
  const run = pts.slice(firstIdx, end + 1);
  return {
    span: { start: run[0].t, end: run[run.length - 1].t + HOUR, max: Math.max(...run.map((r) => r.v as number)) },
    anyExceed: true,
  };
}

export interface Evaluation {
  events: AlertEvent[];
  state: RuleState;
}

export function evaluateRule(
  rule: AlertRule,
  current: ReadingSource | null,
  forecast: readonly ReadingSource[] | null,
  now: number,
  state: RuleState = INITIAL_STATE,
): Evaluation {
  const nowIso = new Date(now).toISOString();
  if (!rule.enabled) return { events: [], state };
  const tz = rule.city.timezone;
  const label = metricLabel(rule.metric, rule.scale);
  const suppressed = inQuietHours(localParts(now, tz).hour, rule.quietHours);
  const base = {
    ruleId: rule.id,
    citySlug: rule.city.slug,
    cityName: rule.city.name,
    metric: rule.metric,
    scale: rule.scale,
    threshold: rule.threshold,
    createdAt: nowIso,
    suppressed,
    read: false,
  };

  if (rule.trigger.type === "current") {
    const v = current ? metricValue(current, rule.metric, rule.scale) : null;
    if (v === null) return { events: [], state: { ...state, lastEvaluatedAt: nowIso } };
    const next: RuleState = { ...state, lastValue: v, lastEvaluatedAt: nowIso };
    if (!state.active && v > rule.threshold) {
      const at = current ? hm(Date.parse(current.time), tz) : "";
      const src = rule.metric === "aqi" ? (current?.sourceLabels?.[rule.scale] ?? current?.sourceLabel) : "Model (Open-Meteo)";
      return {
        events: [
          {
            ...base,
            id: `${rule.id}-${now}`,
            kind: "current",
            value: v,
            title: `${rule.city.name}: ${label} ${formatIndex(v, rule.scale)} (above ${rule.threshold})`,
            message: `${label} is ${alertValueText(v, rule.scale)} in ${rule.city.name}, above your threshold of ${rule.threshold} (current reading, ${at} local time${src ? `; source: ${src}` : ""}).`,
            spanStart: null,
            spanEnd: null,
            ...(src ? { source: src } : {}),
          },
        ],
        state: { ...next, active: true, episodeStartedAt: nowIso },
      };
    }
    if (state.active && v < REARM_FRACTION * rule.threshold) {
      return { events: [], state: { ...next, active: false, episodeStartedAt: null } };
    }
    return { events: [], state: next };
  }

  // Forecast trigger
  if (!forecast || forecast.length === 0) return { events: [], state: { ...state, lastEvaluatedAt: nowIso } };
  const { span, anyExceed } = forecastExceedance(forecast, rule, now, rule.trigger.hours);
  const next: RuleState = { ...state, lastValue: span ? span.max : null, lastEvaluatedAt: nowIso };
  if (!state.active && span) {
    const when = formatSpan(span.start, span.end, tz);
    return {
      events: [
        {
          ...base,
          id: `${rule.id}-${now}`,
          kind: "forecast",
          value: span.max,
          title: `${rule.city.name}: ${label} forecast above ${rule.threshold}`,
          message: `Forecast: ${label} above ${rule.threshold} in ${rule.city.name} on ${when} local time (official model forecast; it may under-estimate where stations read higher).`,
          spanStart: new Date(span.start).toISOString(),
          spanEnd: new Date(span.end).toISOString(),
          source: "Model forecast (CAMS via Open-Meteo)",
        },
      ],
      state: { ...next, active: true, episodeStartedAt: nowIso },
    };
  }
  if (state.active && !anyExceed) return { events: [], state: { ...next, active: false, episodeStartedAt: null } };
  return { events: [], state: next };
}

export interface CityEvaluation {
  /** Next per-rule states, or null when nothing may be written (stale data). */
  states: Record<string, RuleState> | null;
  events: AlertEvent[];
  skipped: "stale" | null;
}

/**
 * Evaluate one city's rules. If either input came from the offline cache
 * (`stale`), nothing is evaluated and nothing is recorded: no events, no
 * state changes, so an episode is never opened or closed on old data.
 */
export function evaluateCityRules(
  rules: readonly AlertRule[],
  current: ReadingSource | null,
  forecast: readonly ReadingSource[] | null,
  now: number,
  prev: Readonly<Record<string, RuleState>>,
  stale: boolean,
): CityEvaluation {
  if (stale) return { states: null, events: [], skipped: "stale" };
  const states: Record<string, RuleState> = { ...prev };
  const events: AlertEvent[] = [];
  for (const rule of rules) {
    const res = evaluateRule(rule, current, forecast, now, prev[rule.id] ?? INITIAL_STATE);
    states[rule.id] = res.state;
    events.push(...res.events);
  }
  return { states, events, skipped: null };
}

/** Newest first, capped at MAX_EVENTS. */
export function appendEvents(log: readonly AlertEvent[], events: readonly AlertEvent[]): AlertEvent[] {
  return [...events, ...log].slice(0, MAX_EVENTS);
}
