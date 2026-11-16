/**
 * Parsing OpenAQ v3 responses for station-based NAQI. Tested against
 * responses recorded from live calls (lib/__tests__/fixtures/openaq-*.json).
 *
 * Pure module (relative imports only) so it runs under `node --test`.
 */

import { haversineKm } from "./headline-source.ts";
import { OpenAqHourItemSchema, OpenAqLatestItemSchema, OpenAqLocationSchema } from "./schemas.ts";
import { naqiPollutantFor, type LatestReading, type SensorHours, type StationCandidate } from "./station-naqi.ts";

export interface SensorInfo {
  id: number;
  parameter: string;
  units: string;
}

export interface ParsedLocation extends StationCandidate {
  /** Every NAQI-relevant sensor (PM and gases), by id. */
  sensors: SensorInfo[];
  url: string;
}

const results = (body: unknown): unknown[] =>
  body && typeof body === "object" && Array.isArray((body as { results?: unknown }).results) ? (body as { results: unknown[] }).results : [];

/** /v3/locations?coordinates=…&radius=… → stations with coordinates, their NAQI sensors and distance from (lat, lon). */
export function parseLocations(body: unknown, lat: number, lon: number): ParsedLocation[] {
  const out: ParsedLocation[] = [];
  for (const raw of results(body)) {
    const p = OpenAqLocationSchema.safeParse(raw);
    if (!p.success) continue;
    const l = p.data;
    const la = l.coordinates.latitude;
    const lo = l.coordinates.longitude;
    if (la === null || lo === null) continue;
    const sensors: SensorInfo[] = l.sensors
      .filter((s) => naqiPollutantFor(s.parameter.name) !== null)
      .map((s) => ({ id: s.id, parameter: s.parameter.name.toLowerCase(), units: s.parameter.units }));
    const pmSensors = sensors.filter((s) => (s.parameter === "pm25" || s.parameter === "pm10") && /g\/m/i.test(s.units));
    out.push({
      id: l.id,
      name: l.name || l.locality || `OpenAQ location ${l.id}`,
      provider: l.provider?.name ?? null,
      isMonitor: l.isMonitor ?? null,
      latitude: la,
      longitude: lo,
      distanceKm: Math.round(haversineKm(lat, lon, la, lo) * 10) / 10,
      lastSeen: l.datetimeLast?.utc ?? null,
      pmSensors,
      sensors,
      url: `https://explore.openaq.org/locations/${l.id}`,
    });
  }
  return out;
}

export interface CurrentSensors {
  /** PM2.5/PM10 sensors to fetch hourly data for (one per parameter, µg/m³). */
  pm: SensorInfo[];
  /** Latest gas readings that may be used (one per parameter). */
  gases: LatestReading[];
  /** Why a gas reading was left out, e.g. "co: unit label ppb not trusted for CPCB data". */
  skipped: string[];
}

const GAS = new Set(["no2", "so2", "co", "o3"]);
const isMass = (units: string) => /g\/m/i.test(units);

/**
 * Which of a location's sensors to use, from its /latest response.
 *
 * Found in live data (15 Nov 2026): CPCB locations list two sensors per
 * parameter, a legacy one whose latest reading is from 2018/2020 and the
 * current one, so per parameter the sensor with the NEWEST reading is used.
 * The current CPCB gas sensors are often labelled "ppb" while their values
 * are in CPCB's own units (CO "0.57 ppb" is physically impossible; it is
 * mg/m³). Because the unit cannot be trusted, ppb/ppm-labelled gas readings
 * from CPCB-sourced stations are skipped, not converted. For other providers
 * ppb/ppm is converted, but impossible values (CO below 20 ppb) are skipped.
 */
export function pickCurrentSensors(sensors: readonly SensorInfo[], latestBody: unknown, cpcb: boolean): CurrentSensors {
  const byId = new Map(sensors.map((s) => [s.id, s]));
  const newest = new Map<string, { s: SensorInfo; value: number; t: number; time: string }>();
  for (const raw of results(latestBody)) {
    const p = OpenAqLatestItemSchema.safeParse(raw);
    if (!p.success) continue;
    const s = byId.get(p.data.sensorsId);
    const t = Date.parse(p.data.datetime.utc);
    if (!s || !Number.isFinite(t) || !Number.isFinite(p.data.value)) continue;
    const prev = newest.get(s.parameter);
    if (!prev || t > prev.t || (t === prev.t && s.id > prev.s.id)) newest.set(s.parameter, { s, value: p.data.value, t, time: p.data.datetime.utc });
  }
  const pm: SensorInfo[] = [];
  const gases: LatestReading[] = [];
  const skipped: string[] = [];
  for (const [param, n] of newest) {
    if (param === "pm25" || param === "pm10") {
      if (isMass(n.s.units)) pm.push(n.s);
      continue;
    }
    if (!GAS.has(param)) continue;
    if (!isMass(n.s.units)) {
      if (cpcb) {
        skipped.push(`${param}: unit label "${n.s.units}" not trusted for CPCB data`);
        continue;
      }
      if (param === "co" && n.s.units.toLowerCase() === "ppb" && n.value < 20) {
        skipped.push(`${param}: ${n.value} ppb is not a plausible CO value`);
        continue;
      }
    }
    gases.push({ parameter: param, units: n.s.units, value: n.value, time: n.time });
  }
  return { pm, gases, skipped };
}

/** /v3/sensors/{id}/hours → hour-ending times and values. Negative values (instrument faults) are dropped later by toUgm3. */
export function parseHours(body: unknown, sensor: SensorInfo): SensorHours {
  const hours: { time: string; value: number }[] = [];
  for (const raw of results(body)) {
    const p = OpenAqHourItemSchema.safeParse(raw);
    if (!p.success || !Number.isFinite(p.data.value)) continue;
    hours.push({ time: p.data.period.datetimeTo.utc, value: p.data.value });
  }
  return { parameter: sensor.parameter, units: sensor.units, hours };
}
