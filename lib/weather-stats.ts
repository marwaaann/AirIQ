/**
 * PM2.5 vs weather statistics for the Weather tab.
 *
 * - Hourly PM2.5 and weather are aligned on identical UTC hours; an hour is
 *   used for a variable only when both PM2.5 and that variable are present.
 * - Correlations use Spearman's rank correlation on DAILY values (local days):
 *   mean PM2.5 vs the daily mean of each weather variable, or the daily total
 *   for precipitation. Days need MIN_HOURS_PER_DAY paired hours.
 * - Nothing is interpolated, and every result reports its sample size.
 *
 * Pure module (relative imports only) so it runs under `node --test`.
 */

import { localParts } from "./time.ts";

export const MIN_HOURS_PER_DAY = 18;
/** Insight lines need at least this many days... */
export const MIN_INSIGHT_DAYS = 14;
/** ...and |r| at or above this (the "moderate" cutoff). */
export const INSIGHT_MIN_ABS_R = 0.2;
/** Daily precipitation total at or above this counts as a rain day (Open-Meteo's 0.1 mm resolution). */
export const RAIN_DAY_MM = 0.1;
export const MIN_RAIN_GROUP_DAYS = 3;
/** Hours with wind below this have no meaningful direction and are left out of the wind rose. */
export const CALM_KMH = 1;
/** Wind-rose sectors with fewer hours than this are greyed and labelled "few hours". */
export const MIN_SECTOR_HOURS = 6;

export const WEATHER_VARS = ["windSpeed", "humidity", "temperature", "pressure", "boundaryLayerHeight", "precipitation"] as const;
export type WeatherVar = (typeof WEATHER_VARS)[number];

export const WEATHER_VAR_INFO: Record<WeatherVar, { label: string; unit: string; daily: "mean" | "total"; noun: string }> = {
  windSpeed: { label: "Wind speed", unit: "km/h", daily: "mean", noun: "wind speed" },
  humidity: { label: "Humidity", unit: "%", daily: "mean", noun: "humidity" },
  temperature: { label: "Temperature", unit: "°C", daily: "mean", noun: "temperature" },
  pressure: { label: "Surface pressure", unit: "hPa", daily: "mean", noun: "surface pressure" },
  boundaryLayerHeight: { label: "Boundary layer height", unit: "m", daily: "mean", noun: "boundary layer height (mixing height)" },
  precipitation: { label: "Precipitation (daily total)", unit: "mm", daily: "total", noun: "rainfall" },
};

export interface PmHour {
  /** UTC ISO. */
  time: string;
  pm25: number | null;
}

export interface WeatherHour {
  time: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: number | null;
  pressure: number | null;
  precipitation: number | null;
  boundaryLayerHeight: number | null;
}

export interface AlignedHour extends WeatherHour {
  pm25: number;
  date: string;
}

export interface Alignment {
  hours: AlignedHour[];
  /** PM2.5 hours with a value but no weather row at the same hour. */
  droppedNoWeather: number;
  /** Hours with weather but missing PM2.5. */
  droppedNoPm: number;
}

const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

/** Join on identical UTC hours (compared as epoch ms, so ISO formatting differences do not matter). */
export function alignHours(pm: readonly PmHour[], weather: readonly WeatherHour[], timeZone: string): Alignment {
  const byTime = new Map<number, WeatherHour>();
  for (const w of weather) byTime.set(Date.parse(w.time), w);
  const hours: AlignedHour[] = [];
  let droppedNoWeather = 0;
  const pmValid = new Set<number>();
  for (const p of pm) {
    const t = Date.parse(p.time);
    if (!finite(p.pm25)) continue;
    pmValid.add(t);
    const w = byTime.get(t);
    if (!w) {
      droppedNoWeather++;
      continue;
    }
    hours.push({ ...w, time: p.time, pm25: p.pm25, date: localParts(t, timeZone).date });
  }
  let droppedNoPm = 0;
  for (const w of weather) if (!pmValid.has(Date.parse(w.time))) droppedNoPm++;
  return { hours, droppedNoWeather, droppedNoPm };
}

/* ------------------------------------------------------------------------- */
/* Spearman                                                                   */
/* ------------------------------------------------------------------------- */

/** 1-based ranks with ties given their average rank. */
export function ranks(values: readonly number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[order[k][1]] = avg;
    i = j + 1;
  }
  return out;
}

function pearson(x: readonly number[], y: readonly number[]): number | undefined {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx;
    const dy = y[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx === 0 || syy === 0) return undefined;
  const r = sxy / Math.sqrt(sxx * syy);
  return Math.max(-1, Math.min(1, r));
}

/**
 * Spearman's rho (Pearson on average ranks, so ties are handled exactly).
 * Returns undefined, never NaN, when fewer than 3 pairs exist, the lengths
 * differ, or either series is constant.
 */
export function spearman(x: readonly number[], y: readonly number[]): number | undefined {
  if (x.length !== y.length || x.length < 3) return undefined;
  if (!x.every(Number.isFinite) || !y.every(Number.isFinite)) return undefined;
  return pearson(ranks(x), ranks(y));
}

export type Strength = "weak" | "moderate" | "strong";
/** |r| < 0.2 weak, 0.2–0.5 moderate, > 0.5 strong. */
export function strengthOf(r: number): Strength {
  const a = Math.abs(r);
  if (a < 0.2) return "weak";
  if (a <= 0.5) return "moderate";
  return "strong";
}

/** Ordinary least squares y = a + b·x for the scatter trend line; undefined if x is constant. */
export function linearFit(x: readonly number[], y: readonly number[]): { intercept: number; slope: number } | undefined {
  const n = x.length;
  if (n < 2 || n !== y.length) return undefined;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i] - mx) * (y[i] - my);
    sxx += (x[i] - mx) ** 2;
  }
  if (sxx === 0) return undefined;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/* ------------------------------------------------------------------------- */
/* Daily pairs                                                                */
/* ------------------------------------------------------------------------- */

export interface DailyPair {
  date: string;
  /** Mean PM2.5 over the paired hours. */
  pm25: number;
  /** Daily mean (or total for precipitation) of the weather variable. */
  value: number;
  hours: number;
}

/**
 * Per local day, the hours where both PM2.5 and `v` exist. Days with fewer
 * than `minHours` paired hours are dropped. Precipitation is summed; other
 * variables are averaged.
 */
export function dailyPairs(hours: readonly AlignedHour[], v: WeatherVar, minHours = MIN_HOURS_PER_DAY): DailyPair[] {
  const days = new Map<string, { pm: number; val: number; n: number }>();
  for (const h of hours) {
    const x = h[v];
    if (!finite(x)) continue;
    const d = days.get(h.date) ?? { pm: 0, val: 0, n: 0 };
    d.pm += h.pm25;
    d.val += x;
    d.n++;
    days.set(h.date, d);
  }
  const total = WEATHER_VAR_INFO[v].daily === "total";
  return [...days.entries()]
    .filter(([, d]) => d.n >= minHours)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => ({ date, pm25: d.pm / d.n, value: total ? d.val : d.val / d.n, hours: d.n }));
}

export interface Correlation {
  variable: WeatherVar;
  /** undefined when it cannot be computed (too few days or a constant series). */
  r: number | undefined;
  strength: Strength | undefined;
  days: number;
  /** Paired hours behind those days. */
  hours: number;
}

export function correlations(hours: readonly AlignedHour[]): Correlation[] {
  return WEATHER_VARS.map((variable) => {
    const pairs = dailyPairs(hours, variable);
    const r = spearman(
      pairs.map((p) => p.value),
      pairs.map((p) => p.pm25),
    );
    return { variable, r, strength: r === undefined ? undefined : strengthOf(r), days: pairs.length, hours: pairs.reduce((a, p) => a + p.hours, 0) };
  });
}

/* ------------------------------------------------------------------------- */
/* Wind rose                                                                  */
/* ------------------------------------------------------------------------- */

export const SECTOR_NAMES = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"] as const;

/** 16 sectors of 22.5°, sector 0 centred on north (348.75° to 11.25°). Direction is where the wind blows FROM. */
export function sectorOf(deg: number): number {
  const d = ((deg % 360) + 360) % 360;
  return Math.floor((d + 11.25) / 22.5) % 16;
}

export interface Sector {
  index: number;
  name: (typeof SECTOR_NAMES)[number];
  /** Centre direction in degrees. */
  center: number;
  hours: number;
  meanPm25: number | null;
  lowCount: boolean;
}

export interface WindRose {
  sectors: Sector[];
  /** Hours used (with direction and wind at least CALM_KMH). */
  hours: number;
  calmHours: number;
}

export function windRose(hours: readonly AlignedHour[], minHours = MIN_SECTOR_HOURS): WindRose {
  const sum = new Array<number>(16).fill(0);
  const cnt = new Array<number>(16).fill(0);
  let calmHours = 0;
  let used = 0;
  for (const h of hours) {
    if (!finite(h.windDirection) || !finite(h.windSpeed)) continue;
    if (h.windSpeed < CALM_KMH) {
      calmHours++;
      continue;
    }
    const s = sectorOf(h.windDirection);
    sum[s] += h.pm25;
    cnt[s]++;
    used++;
  }
  return {
    sectors: SECTOR_NAMES.map((name, index) => ({
      index,
      name,
      center: index * 22.5,
      hours: cnt[index],
      meanPm25: cnt[index] ? sum[index] / cnt[index] : null,
      lowCount: cnt[index] < minHours,
    })),
    hours: used,
    calmHours,
  };
}

/* ------------------------------------------------------------------------- */
/* Dry vs rain days                                                           */
/* ------------------------------------------------------------------------- */

export interface RainGroup {
  days: number;
  meanPm25: number;
}
export interface RainComparison {
  dry: RainGroup;
  wet: RainGroup;
}

/** Mean daily PM2.5 on dry days vs days with ≥ RAIN_DAY_MM; null unless both groups have MIN_RAIN_GROUP_DAYS days. */
export function rainComparison(pairs: readonly DailyPair[], minDays = MIN_RAIN_GROUP_DAYS): RainComparison | null {
  const dry = pairs.filter((p) => p.value < RAIN_DAY_MM);
  const wet = pairs.filter((p) => p.value >= RAIN_DAY_MM);
  if (dry.length < minDays || wet.length < minDays) return null;
  const mean = (g: readonly DailyPair[]) => g.reduce((a, p) => a + p.pm25, 0) / g.length;
  return { dry: { days: dry.length, meanPm25: mean(dry) }, wet: { days: wet.length, meanPm25: mean(wet) } };
}

/* ------------------------------------------------------------------------- */
/* Insights                                                                   */
/* ------------------------------------------------------------------------- */

export const CAUSATION_NOTE = "Correlation does not prove cause.";
export const NO_RELATIONSHIP = "No clear relationship found in this period.";

/**
 * Up to 4 lines, strongest first, only for relationships with |r| ≥ 0.2 over
 * at least 14 days, always followed by the causation note. Otherwise a
 * single "no clear relationship" line.
 */
export function weatherInsights(cors: readonly Correlation[], max = 4): string[] {
  const ok = cors
    .filter((c): c is Correlation & { r: number; strength: Strength } => c.r !== undefined && c.strength !== undefined)
    .filter((c) => Math.abs(c.r) >= INSIGHT_MIN_ABS_R && c.days >= MIN_INSIGHT_DAYS)
    .sort((a, b) => Math.abs(b.r) - Math.abs(a.r))
    .slice(0, max);
  if (!ok.length) return [NO_RELATIONSHIP];
  const lines = ok.map((c) => {
    const info = WEATHER_VAR_INFO[c.variable];
    const dir = c.r > 0 ? "higher" : "lower";
    return `Days with higher ${info.noun} tended to have ${dir} PM2.5 (${c.strength}, Spearman r = ${formatR(c.r)}, ${c.days} days).`;
  });
  return [...lines, CAUSATION_NOTE];
}

export function formatR(r: number): string {
  const s = Math.abs(r).toFixed(2);
  return r < 0 ? `−${s}` : s;
}
