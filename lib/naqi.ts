/**
 * India National Air Quality Index (NAQI), computed by AirIQ from hourly
 * concentrations. It may differ from CPCB's official bulletin, which uses
 * validated station data.
 *
 * Source (cited in the README and /about):
 *  - CPCB, "About National Air Quality Index" (breakpoint table, averaging
 *    periods, worked example: PM2.5 31 → 51, 45 → 75, 60 → 100):
 *    https://web.archive.org/web/20160804011654/http://cpcb.nic.in:80/About_AQI.pdf
 *  - CPCB, "National Air Quality Index" report (2014), section 3.7 (minimum
 *    data rules) and Table 3.12 (health statements):
 *    https://web.archive.org/web/20160417204306/http://www.cpcb.nic.in/FINAL-REPORT_AQI_.pdf
 *
 * Rules implemented:
 *  - Sub-index I = (IHI − ILO)/(BHI − BLO) × (C − BLO) + ILO, rounded.
 *  - Averaging: 24-hour means for PM10, PM2.5, NO2, SO2 and NH3; 8-hour means
 *    for CO and O3 (CO in mg/m³, everything else in µg/m³).
 *  - A 24-hour sub-index needs at least 16 hours of data (CPCB). For 8-hour
 *    means AirIQ applies the same two-thirds rule: at least 6 of 8 hours.
 *  - The overall index needs sub-indices for at least three pollutants, one of
 *    them PM2.5 or PM10; otherwise the data are "insufficient" (CPCB).
 *  - Overall NAQI = the highest sub-index; that pollutant is the dominant one.
 *  - Severe is open-ended in CPCB's table ("250+" for PM2.5). AirIQ continues
 *    the Very-poor segment's slope, so Severe spans 401–500 over the same
 *    concentration width as Very poor (PM2.5 251–380, PM10 431–510, the values
 *    common NAQI calculators use). Above that the line keeps going: the value
 *    is kept, shown as "500+" and flagged "Severe, beyond index".
 *  - O3: CPCB marks the Very-poor/Severe ozone breakpoints (748 µg/m³) as
 *    1-hour values. AirIQ applies the whole table to the 8-hour mean; this only
 *    matters above 208 µg/m³ (8-hour), which Open-Meteo data rarely reach.
 *
 * Pure module (relative imports only) so it runs under `node --test`.
 */

export type NaqiPollutant = "pm10" | "pm2_5" | "nitrogen_dioxide" | "sulphur_dioxide" | "carbon_monoxide" | "ozone" | "ammonia";

export const NAQI_POLLUTANTS: readonly NaqiPollutant[] = ["pm2_5", "pm10", "nitrogen_dioxide", "sulphur_dioxide", "ozone", "carbon_monoxide", "ammonia"];

export const NAQI_SHORT: Record<NaqiPollutant, string> = {
  pm2_5: "PM2.5",
  pm10: "PM10",
  nitrogen_dioxide: "NO₂",
  sulphur_dioxide: "SO₂",
  ozone: "O₃",
  carbon_monoxide: "CO",
  ammonia: "NH₃",
};

export interface NaqiBand {
  cLow: number;
  cHigh: number;
  iLow: number;
  iHigh: number;
}

const INDEX_BANDS: readonly (readonly [number, number])[] = [
  [0, 50],
  [51, 100],
  [101, 200],
  [201, 300],
  [301, 400],
  [401, 500],
];

/**
 * Concentration ranges exactly as printed in CPCB's table (Good … Very poor),
 * plus the open-ended Severe lower bound. µg/m³, except CO in mg/m³.
 */
const PRINTED: Record<NaqiPollutant, { ranges: readonly (readonly [number, number])[]; severeFrom: number }> = {
  pm10: { ranges: [[0, 50], [51, 100], [101, 250], [251, 350], [351, 430]], severeFrom: 431 },
  pm2_5: { ranges: [[0, 30], [31, 60], [61, 90], [91, 120], [121, 250]], severeFrom: 251 },
  nitrogen_dioxide: { ranges: [[0, 40], [41, 80], [81, 180], [181, 280], [281, 400]], severeFrom: 401 },
  ozone: { ranges: [[0, 50], [51, 100], [101, 168], [169, 208], [209, 748]], severeFrom: 749 },
  carbon_monoxide: { ranges: [[0, 1.0], [1.1, 2.0], [2.1, 10], [10, 17], [17, 34]], severeFrom: 34 },
  sulphur_dioxide: { ranges: [[0, 40], [41, 80], [81, 380], [381, 800], [801, 1600]], severeFrom: 1601 },
  ammonia: { ranges: [[0, 200], [201, 400], [401, 800], [801, 1200], [1200, 1800]], severeFrom: 1801 },
};

function buildTable(p: NaqiPollutant): NaqiBand[] {
  const { ranges, severeFrom } = PRINTED[p];
  const bands: NaqiBand[] = ranges.map(([cLow, cHigh], i) => ({ cLow, cHigh, iLow: INDEX_BANDS[i][0], iHigh: INDEX_BANDS[i][1] }));
  const vp = ranges[ranges.length - 1];
  // Severe: same concentration width as Very poor (continues its slope).
  bands.push({ cLow: severeFrom, cHigh: severeFrom + (vp[1] - vp[0]), iLow: 401, iHigh: 500 });
  return bands;
}

export const NAQI_TABLE: Record<NaqiPollutant, readonly NaqiBand[]> = Object.fromEntries(
  NAQI_POLLUTANTS.map((p) => [p, buildTable(p)]),
) as unknown as Record<NaqiPollutant, readonly NaqiBand[]>;

/** Averaging period (hours) per pollutant. */
export const NAQI_AVERAGING: Record<NaqiPollutant, 24 | 8> = {
  pm10: 24,
  pm2_5: 24,
  nitrogen_dioxide: 24,
  sulphur_dioxide: 24,
  ammonia: 24,
  carbon_monoxide: 8,
  ozone: 8,
};

/** Minimum hours of data in each averaging window. */
export const NAQI_MIN_HOURS: Record<24 | 8, number> = { 24: 16, 8: 6 };

export const NAQI_MIN_POLLUTANTS = 3;

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/**
 * Sub-index for an averaged concentration (µg/m³; CO in mg/m³). Above the
 * Severe band the value continues linearly (> 500, "beyond index").
 */
export function naqiSubIndex(p: NaqiPollutant, c: number): number | null {
  if (!isNum(c) || c < 0) return null;
  const table = NAQI_TABLE[p];
  const last = table.length - 1;
  for (let k = 0; k <= last; k++) {
    const b = table[k];
    if (c <= b.cHigh || k === last) {
      const v = b.iLow + ((b.iHigh - b.iLow) / (b.cHigh - b.cLow)) * (c - b.cLow);
      // Concentrations in the small gaps between printed ranges (e.g. 30.5 for PM2.5) take the band's floor.
      const bounded = k === last ? Math.max(b.iLow, v) : Math.min(b.iHigh, Math.max(b.iLow, v));
      return Math.round(bounded);
    }
  }
  return null;
}

export interface NaqiAverage {
  /** Window mean (µg/m³; CO in mg/m³). */
  value: number;
  /** Hours with data in the window. */
  hours: number;
  window: 24 | 8;
}

export type NaqiStatus = "ok" | "insufficient";

export interface NaqiResult {
  /** Overall NAQI (may exceed 500: beyond index). Null when data are insufficient. */
  aqi: number | null;
  dominant: NaqiPollutant | null;
  subIndices: Partial<Record<NaqiPollutant, number>>;
  averages: Partial<Record<NaqiPollutant, NaqiAverage>>;
  status: NaqiStatus;
  /** Plain-language reason when insufficient. */
  reason: string | null;
}

/** Hourly concentrations, oldest first, in µg/m³ (CO too: converted to mg/m³ here). */
export type NaqiHourly = Partial<Record<NaqiPollutant, readonly (number | null | undefined)[]>>;

/** Mean of the `window` hours ending at `idx` (inclusive), or null below the minimum hours. */
export function windowMean(values: readonly (number | null | undefined)[], idx: number, window: 24 | 8): { mean: number; n: number } | null {
  if (idx < 0 || idx >= values.length) return null;
  let sum = 0;
  let n = 0;
  for (let i = Math.max(0, idx - window + 1); i <= idx; i++) {
    const v = values[i];
    if (isNum(v) && v >= 0) {
      sum += v;
      n++;
    }
  }
  return n >= NAQI_MIN_HOURS[window] ? { mean: sum / n, n } : null;
}

/** Combine averaged concentrations into the overall NAQI with CPCB's minimum-pollutant rule. */
export function naqiFromAverages(averages: Partial<Record<NaqiPollutant, NaqiAverage>>): NaqiResult {
  const subIndices: Partial<Record<NaqiPollutant, number>> = {};
  for (const p of NAQI_POLLUTANTS) {
    const a = averages[p];
    if (!a) continue;
    const i = naqiSubIndex(p, a.value);
    if (i !== null) subIndices[p] = i;
  }
  const keys = Object.keys(subIndices) as NaqiPollutant[];
  const hasPm = subIndices.pm2_5 !== undefined || subIndices.pm10 !== undefined;
  if (keys.length < NAQI_MIN_POLLUTANTS || !hasPm) {
    const reason = !hasPm
      ? "Not enough data: NAQI needs PM2.5 or PM10 with at least 16 hours in the last 24."
      : `Not enough data: NAQI needs at least ${NAQI_MIN_POLLUTANTS} pollutants (found ${keys.length}).`;
    return { aqi: null, dominant: null, subIndices, averages, status: "insufficient", reason };
  }
  let aqi = -Infinity;
  let dominant: NaqiPollutant | null = null;
  for (const p of keys) {
    const v = subIndices[p] as number;
    if (v > aqi) {
      aqi = v;
      dominant = p;
    }
  }
  return { aqi, dominant, subIndices, averages, status: "ok", reason: null };
}

/** NAQI at hour `idx` of an hourly series, with CPCB's averaging periods and minimum-data rules. */
export function naqiAt(h: NaqiHourly, idx: number): NaqiResult {
  const averages: Partial<Record<NaqiPollutant, NaqiAverage>> = {};
  for (const p of NAQI_POLLUTANTS) {
    const values = h[p];
    if (!values) continue;
    const window = NAQI_AVERAGING[p];
    const m = windowMean(values, idx, window);
    if (!m) continue;
    // Open-Meteo reports CO in µg/m³; CPCB's CO breakpoints are in mg/m³.
    const value = p === "carbon_monoxide" ? m.mean / 1000 : m.mean;
    averages[p] = { value, hours: m.n, window };
  }
  return naqiFromAverages(averages);
}

/** NAQI for every hour of a series (null where the minimum-data rules are not met). */
export function naqiSeries(h: NaqiHourly, length: number): NaqiResult[] {
  return Array.from({ length }, (_, i) => naqiAt(h, i));
}
