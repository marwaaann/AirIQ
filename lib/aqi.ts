/**
 * US EPA AQI calculation.
 *
 * Inputs are concentrations in µg/m³ (Open-Meteo's unit for every pollutant,
 * including CO). Gases are converted to ppb/ppm at 25 °C and 1 atm, the EPA
 * reference conditions.
 *
 * Breakpoints: EPA Technical Assistance Document for the Reporting of Daily
 * Air Quality (EPA-454/B-24-002, May 2024), which lowered the PM2.5 "Good"
 * ceiling from 12.0 to 9.0 µg/m³. The 2012 PM2.5 table is kept as an option
 * because many published indices still use it. Open-Meteo's `us_aqi` uses
 * the 2024 table (verified: PM2.5 sub-indices match exactly); its ozone
 * sub-index can differ because of a different 8-hour window convention.
 *
 * Pure module (relative imports only) so it can run under `node --test`.
 */

import { PM25_PER_CIGARETTE, type PollutantKey } from "./aqi-categories.ts";

export interface Breakpoint {
  cLow: number;
  cHigh: number;
  iLow: number;
  iHigh: number;
}

type Table = readonly Breakpoint[];

const bp = (cLow: number, cHigh: number, iLow: number, iHigh: number): Breakpoint => ({ cLow, cHigh, iLow, iHigh });

/** PM2.5, 24-hour, µg/m³ (2024 revision). */
export const PM25_2024: Table = [
  bp(0.0, 9.0, 0, 50),
  bp(9.1, 35.4, 51, 100),
  bp(35.5, 55.4, 101, 150),
  bp(55.5, 125.4, 151, 200),
  bp(125.5, 225.4, 201, 300),
  bp(225.5, 325.4, 301, 500),
];

/** PM2.5, 24-hour, µg/m³ (2012 table, superseded but still widely used). */
export const PM25_2012: Table = [
  bp(0.0, 12.0, 0, 50),
  bp(12.1, 35.4, 51, 100),
  bp(35.5, 55.4, 101, 150),
  bp(55.5, 150.4, 151, 200),
  bp(150.5, 250.4, 201, 300),
  bp(250.5, 350.4, 301, 400),
  bp(350.5, 500.4, 401, 500),
];

/** PM10, 24-hour, µg/m³. */
export const PM10: Table = [
  bp(0, 54, 0, 50),
  bp(55, 154, 51, 100),
  bp(155, 254, 101, 150),
  bp(255, 354, 151, 200),
  bp(355, 424, 201, 300),
  bp(425, 604, 301, 500),
];

/** O3, 8-hour, ppm. Not defined above 0.200 ppm (1-hour table takes over). */
export const O3_8H: Table = [
  bp(0.0, 0.054, 0, 50),
  bp(0.055, 0.07, 51, 100),
  bp(0.071, 0.085, 101, 150),
  bp(0.086, 0.105, 151, 200),
  bp(0.106, 0.2, 201, 300),
];

/** O3, 1-hour, ppm. Only defined from AQI 101 upward. */
export const O3_1H: Table = [
  bp(0.125, 0.164, 101, 150),
  bp(0.165, 0.204, 151, 200),
  bp(0.205, 0.404, 201, 300),
  bp(0.405, 0.604, 301, 500),
];

/** CO, 8-hour, ppm. */
export const CO_8H: Table = [
  bp(0.0, 4.4, 0, 50),
  bp(4.5, 9.4, 51, 100),
  bp(9.5, 12.4, 101, 150),
  bp(12.5, 15.4, 151, 200),
  bp(15.5, 30.4, 201, 300),
  bp(30.5, 50.4, 301, 500),
];

/** SO2, 1-hour, ppb (values ≥305 ppb are formally 24-hour). */
export const SO2_1H: Table = [
  bp(0, 35, 0, 50),
  bp(36, 75, 51, 100),
  bp(76, 185, 101, 150),
  bp(186, 304, 151, 200),
  bp(305, 604, 201, 300),
  bp(605, 1004, 301, 500),
];

/** NO2, 1-hour, ppb. */
export const NO2_1H: Table = [
  bp(0, 53, 0, 50),
  bp(54, 100, 51, 100),
  bp(101, 360, 101, 150),
  bp(361, 649, 151, 200),
  bp(650, 1249, 201, 300),
  bp(1250, 2049, 301, 500),
];

/** Molecular weights (g/mol) for µg/m³ → ppb conversion. */
export const MOLECULAR_WEIGHT = {
  ozone: 48.0,
  nitrogen_dioxide: 46.0055,
  sulphur_dioxide: 64.066,
  carbon_monoxide: 28.01,
} as const;

/** Molar volume of an ideal gas at 25 °C, 1 atm (L/mol). */
const MOLAR_VOLUME = 24.45;

export type GasKey = keyof typeof MOLECULAR_WEIGHT;

/** µg/m³ → ppb at 25 °C. */
export function ugm3ToPpb(gas: GasKey, ugm3: number): number {
  return (ugm3 * MOLAR_VOLUME) / MOLECULAR_WEIGHT[gas];
}

/** µg/m³ → ppm at 25 °C. */
export function ugm3ToPpm(gas: GasKey, ugm3: number): number {
  return ugm3ToPpb(gas, ugm3) / 1000;
}

/** Truncate (not round) to `decimals`, as EPA requires. */
export function truncate(value: number, decimals: number): number {
  const f = 10 ** decimals;
  // Small epsilon guards against floating-point artefacts like 35.4 → 35.39999.
  return Math.floor(value * f + 1e-9) / f;
}

/**
 * Linear interpolation inside the matching breakpoint. Concentrations that fall
 * in the small gaps between truncated bands (e.g. 9.05 before truncation) are
 * handled by truncating first.
 *
 * Above the top band the EPA index is undefined. AirIQ extends the top band's
 * line instead of clipping, so an extreme reading keeps its size (e.g. PM2.5
 * 400 µg/m³ → 649). The UI shows any value above 500 as "500+" with the
 * computed number in its label ("beyond index").
 */
export function indexFromTable(c: number, table: Table): number | null {
  if (!Number.isFinite(c) || c < 0) return null;
  const top = table[table.length - 1];
  if (c > top.cHigh) return Math.round(((top.iHigh - top.iLow) / (top.cHigh - top.cLow)) * (c - top.cLow) + top.iLow);
  for (const b of table) {
    if (c >= b.cLow && c <= b.cHigh) {
      return Math.round(((b.iHigh - b.iLow) / (b.cHigh - b.cLow)) * (c - b.cLow) + b.iLow);
    }
  }
  // Inside a truncation gap (only possible if caller did not truncate): use the next band's floor.
  const next = table.find((b) => c < b.cLow);
  return next ? next.iLow : null;
}

export type Pm25Edition = "2024" | "2012";

export interface SubIndexOptions {
  pm25Edition?: Pm25Edition;
}

/**
 * Concentrations already averaged per EPA rules (µg/m³):
 * PM 24-h mean, O3 8-h mean (+ optional 1-h), CO 8-h mean, NO2/SO2 1-h.
 */
export interface AveragedConcentrations {
  pm2_5?: number | null;
  pm10?: number | null;
  ozone8h?: number | null;
  ozone1h?: number | null;
  carbon_monoxide?: number | null;
  nitrogen_dioxide?: number | null;
  sulphur_dioxide?: number | null;
}

const isNum = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function pm25Index(ugm3: number, edition: Pm25Edition = "2024"): number | null {
  return indexFromTable(truncate(ugm3, 1), edition === "2024" ? PM25_2024 : PM25_2012);
}

export function pm10Index(ugm3: number): number | null {
  return indexFromTable(truncate(ugm3, 0), PM10);
}

/** O3 index: max of 8-hour (≤0.200 ppm) and 1-hour (≥0.125 ppm) indices. */
export function ozoneIndex(o3_8h_ugm3: number | null, o3_1h_ugm3: number | null = null): number | null {
  const candidates: number[] = [];
  if (isNum(o3_8h_ugm3)) {
    const ppm = truncate(ugm3ToPpm("ozone", o3_8h_ugm3), 3);
    if (ppm <= 0.2) {
      const i = indexFromTable(ppm, O3_8H);
      if (i !== null) candidates.push(i);
    }
  }
  const oneHour = isNum(o3_1h_ugm3) ? o3_1h_ugm3 : null;
  if (oneHour !== null) {
    const ppm = truncate(ugm3ToPpm("ozone", oneHour), 3);
    if (ppm >= 0.125) {
      const i = indexFromTable(ppm, O3_1H);
      if (i !== null) candidates.push(i);
    }
  }
  // 8-hour above table and no 1-hour data: fall back to the 1-hour table with the 8-h value.
  if (candidates.length === 0 && isNum(o3_8h_ugm3)) {
    const ppm = truncate(ugm3ToPpm("ozone", o3_8h_ugm3), 3);
    const i = indexFromTable(ppm, O3_1H);
    if (i !== null) candidates.push(i);
  }
  return candidates.length ? Math.max(...candidates) : null;
}

export function coIndex(ugm3: number): number | null {
  return indexFromTable(truncate(ugm3ToPpm("carbon_monoxide", ugm3), 1), CO_8H);
}

export function no2Index(ugm3: number): number | null {
  return indexFromTable(truncate(ugm3ToPpb("nitrogen_dioxide", ugm3), 0), NO2_1H);
}

export function so2Index(ugm3: number): number | null {
  return indexFromTable(truncate(ugm3ToPpb("sulphur_dioxide", ugm3), 0), SO2_1H);
}

export type SubIndices = Partial<Record<PollutantKey, number>>;

export interface UsAqiResult {
  aqi: number | null;
  dominant: PollutantKey | null;
  subIndices: SubIndices;
}

/** Overall AQI = max of the individual sub-indices. */
export function computeUsAqi(c: AveragedConcentrations, opts: SubIndexOptions = {}): UsAqiResult {
  const sub: SubIndices = {};
  if (isNum(c.pm2_5)) {
    const i = pm25Index(c.pm2_5, opts.pm25Edition);
    if (i !== null) sub.pm2_5 = i;
  }
  if (isNum(c.pm10)) {
    const i = pm10Index(c.pm10);
    if (i !== null) sub.pm10 = i;
  }
  if (isNum(c.ozone8h) || isNum(c.ozone1h)) {
    const i = ozoneIndex(c.ozone8h ?? null, c.ozone1h ?? null);
    if (i !== null) sub.ozone = i;
  }
  if (isNum(c.carbon_monoxide)) {
    const i = coIndex(c.carbon_monoxide);
    if (i !== null) sub.carbon_monoxide = i;
  }
  if (isNum(c.nitrogen_dioxide)) {
    const i = no2Index(c.nitrogen_dioxide);
    if (i !== null) sub.nitrogen_dioxide = i;
  }
  if (isNum(c.sulphur_dioxide)) {
    const i = so2Index(c.sulphur_dioxide);
    if (i !== null) sub.sulphur_dioxide = i;
  }

  let aqi: number | null = null;
  let dominant: PollutantKey | null = null;
  for (const [k, v] of Object.entries(sub) as [PollutantKey, number][]) {
    if (aqi === null || v > aqi) {
      aqi = v;
      dominant = k;
    }
  }
  return { aqi, dominant, subIndices: sub };
}

/** Mean of the last `window` finite values ending at `endIdx` (inclusive). Requires ≥75% coverage. */
export function trailingMean(values: readonly (number | null)[], endIdx: number, window: number): number | null {
  const start = Math.max(0, endIdx - window + 1);
  let sum = 0;
  let n = 0;
  for (let i = start; i <= endIdx; i++) {
    const v = values[i];
    if (isNum(v)) {
      sum += v;
      n++;
    }
  }
  return n >= Math.ceil(window * 0.75) ? sum / n : null;
}

export interface HourlyConcentrations {
  pm2_5: readonly (number | null)[];
  pm10: readonly (number | null)[];
  ozone: readonly (number | null)[];
  carbon_monoxide: readonly (number | null)[];
  nitrogen_dioxide: readonly (number | null)[];
  sulphur_dioxide: readonly (number | null)[];
}

/**
 * EPA-style AQI at hour `idx` of an hourly series, using the proper averaging
 * windows (PM 24 h, O3 8 h + 1 h, CO 8 h, NO2/SO2 1 h).
 */
export function computeUsAqiAt(h: HourlyConcentrations, idx: number, opts: SubIndexOptions = {}): UsAqiResult {
  return computeUsAqi(
    {
      pm2_5: trailingMean(h.pm2_5, idx, 24),
      pm10: trailingMean(h.pm10, idx, 24),
      ozone8h: trailingMean(h.ozone, idx, 8),
      ozone1h: h.ozone[idx] ?? null,
      carbon_monoxide: trailingMean(h.carbon_monoxide, idx, 8),
      nitrogen_dioxide: h.nitrogen_dioxide[idx] ?? null,
      sulphur_dioxide: h.sulphur_dioxide[idx] ?? null,
    },
    opts,
  );
}

/** Instantaneous AQI from a single hourly reading (no averaging available). */
export function computeUsAqiInstant(
  c: Partial<Record<PollutantKey, number | null>>,
  opts: SubIndexOptions = {},
): UsAqiResult {
  return computeUsAqi(
    {
      pm2_5: c.pm2_5,
      pm10: c.pm10,
      ozone8h: c.ozone,
      ozone1h: c.ozone,
      carbon_monoxide: c.carbon_monoxide,
      nitrogen_dioxide: c.nitrogen_dioxide,
      sulphur_dioxide: c.sulphur_dioxide,
    },
    opts,
  );
}

/**
 * European AQI sub-index for PM2.5, matching Open-Meteo's `european_aqi_pm2_5`.
 * It uses the HOURLY concentration with the 2024 EEA bands
 * 0–5 / 5–15 / 15–50 / 50–90 / 90–140 µg/m³ → 0–20 / 20–40 / 40–60 / 60–80 / 80–100,
 * continuing above 140 µg/m³ with the last band's slope (20 points per 50 µg/m³).
 * Verified against 744 hourly Open-Meteo values for Delhi and London (2026-11-10):
 * exact match below 140 µg/m³, within ±1 above.
 */
export const EU_PM25_BANDS: readonly Breakpoint[] = [
  bp(0, 5, 0, 20),
  bp(5, 15, 20, 40),
  bp(15, 50, 40, 60),
  bp(50, 90, 60, 80),
  bp(90, 140, 80, 100),
];

export function euPm25Index(ugm3: number): number | null {
  if (!Number.isFinite(ugm3) || ugm3 < 0) return null;
  const top = EU_PM25_BANDS[EU_PM25_BANDS.length - 1];
  if (ugm3 > top.cHigh) return Math.round(top.iHigh + ((ugm3 - top.cHigh) * 20) / 50);
  const b = EU_PM25_BANDS.find((x) => ugm3 <= x.cHigh) ?? top;
  return Math.round(b.iLow + ((ugm3 - b.cLow) / (b.cHigh - b.cLow)) * (b.iHigh - b.iLow));
}

/**
 * Approximate PM2.5 → cigarettes-per-day equivalence (Berkeley Earth rule of
 * thumb: 22 µg/m³ for 24 h ≈ 1 cigarette). This is a communication aid, not a
 * medical equivalence.
 */
export function cigarettesEquivalent(pm25DailyMean: number): number {
  if (!Number.isFinite(pm25DailyMean) || pm25DailyMean <= 0) return 0;
  return pm25DailyMean / PM25_PER_CIGARETTE;
}

/** How many times above (or below, <1) the WHO guideline a value is. */
export function whoRatio(value: number, guideline: number): number {
  return guideline > 0 ? value / guideline : 0;
}
