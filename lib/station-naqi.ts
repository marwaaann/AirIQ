/**
 * India NAQI from a ground station's own hourly concentrations (OpenAQ, which
 * republishes CPCB's real-time station data). Values are converted to µg/m³
 * (gases reported in ppm/ppb are converted at 25 °C), aligned to the 24 hours
 * ending at the station's latest hour, and passed through lib/naqi.ts with
 * CPCB's averaging and minimum-data rules. WAQI index values are NEVER used
 * here: an AQI converted back to a concentration is not a measurement.
 *
 * Pure module (relative imports only).
 */

import { naqiAt, type NaqiHourly, type NaqiPollutant, type NaqiResult } from "./naqi.ts";

const PARAM: Record<string, NaqiPollutant> = {
  pm25: "pm2_5",
  "pm2.5": "pm2_5",
  pm10: "pm10",
  no2: "nitrogen_dioxide",
  so2: "sulphur_dioxide",
  o3: "ozone",
  co: "carbon_monoxide",
  nh3: "ammonia",
};

/** g/mol, for ppm/ppb → µg/m³ at 25 °C, 1 atm (molar volume 24.45 L). */
const MW: Partial<Record<NaqiPollutant, number>> = {
  nitrogen_dioxide: 46.0055,
  sulphur_dioxide: 64.066,
  ozone: 48.0,
  carbon_monoxide: 28.01,
  ammonia: 17.031,
};

export function naqiPollutantFor(parameterName: string): NaqiPollutant | null {
  return PARAM[parameterName.trim().toLowerCase()] ?? null;
}

/** Convert a reading to µg/m³ (CO stays in µg/m³ here; lib/naqi.ts converts it to mg/m³). Null for unknown units. */
export function toUgm3(p: NaqiPollutant, units: string, value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const u = units.trim().toLowerCase().replace("μ", "µ").replace(/\s+/g, "");
  if (u === "µg/m³" || u === "µg/m3" || u === "ug/m3" || u === "ug/m³") return value;
  if (u === "mg/m³" || u === "mg/m3") return value * 1000;
  const mw = MW[p];
  if (!mw) return null;
  if (u === "ppm") return (value * mw * 1000) / 24.45;
  if (u === "ppb") return (value * mw) / 24.45;
  return null;
}

export interface SensorHours {
  /** OpenAQ parameter name, e.g. "pm25". */
  parameter: string;
  units: string;
  /** Hour-ending UTC ISO times and values. */
  hours: readonly { time: string; value: number }[];
}

export interface StationNaqiResult {
  result: NaqiResult;
  /** End of the latest hour used (UTC ISO), or null when there are no readings. */
  observedAt: string | null;
}

const HOUR = 3600_000;

/** NAQI over the 24 hours ending at the latest reading across the station's sensors. */
export function naqiFromSensorHours(sensors: readonly SensorHours[]): StationNaqiResult {
  let latest = -Infinity;
  const parsed: { p: NaqiPollutant; hours: { t: number; v: number }[] }[] = [];
  for (const s of sensors) {
    const p = naqiPollutantFor(s.parameter);
    if (!p) continue;
    const hours: { t: number; v: number }[] = [];
    for (const h of s.hours) {
      const t = Math.floor(Date.parse(h.time) / HOUR) * HOUR;
      const v = toUgm3(p, s.units, h.value);
      if (!Number.isFinite(t) || v === null) continue;
      hours.push({ t, v });
      if (t > latest) latest = t;
    }
    if (hours.length) parsed.push({ p, hours });
  }
  if (!Number.isFinite(latest)) {
    return { result: naqiAt({}, 0), observedAt: null };
  }
  const series: NaqiHourly = {};
  for (const { p, hours } of parsed) {
    const arr: (number | null)[] = Array.from({ length: 24 }, () => null);
    for (const { t, v } of hours) {
      const k = 23 - Math.round((latest - t) / HOUR);
      if (k >= 0 && k < 24) arr[k] = v;
    }
    series[p] = arr;
  }
  return { result: naqiAt(series, 23), observedAt: new Date(latest).toISOString() };
}
