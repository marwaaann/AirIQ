/**
 * Phase 9b: station-based NAQI, the "never contradictory" NAQI rules, the
 * consistency check and older station readings.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkGrounding } from "../assistant/grounding-check.ts";
import {
  adviceBasis,
  haversineKm,
  impliedNaqiRank,
  modelEstimateLine,
  naqiConsistency,
  naqiLabel,
  olderReadingFor,
  olderReadingText,
  pm25ForUsAqi,
  selectHeadline,
  sourceLabel,
  type HeadlineInput,
  type NearbyStation,
} from "../headline-source.ts";
import { pm25Index } from "../aqi.ts";
import { SlidingLimiter, RateLimitWaitError } from "../sliding-limiter.ts";
import {
  chooseStations,
  isCpcbProvider,
  matchStation,
  naqiForStation,
  summarizeStationNaqi,
  type SensorHours,
  type StationCandidate,
  type StationNaqiStation,
  type StationNaqiSummary,
} from "../station-naqi.ts";

const NOW = Date.parse("2026-11-15T16:30:00Z"); // 22:00 IST
const HOUR = 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const hoursAgo = (h: number) => iso(NOW - h * HOUR);

/** `n` hourly values ending at the hour `endH` hours ago (oldest first). */
function hours(parameter: string, units: string, values: readonly number[], endH = 0.5): SensorHours {
  const end = Math.floor((NOW - endH * HOUR) / HOUR) * HOUR;
  return { parameter, units, hours: values.map((value, i) => ({ time: iso(end - (values.length - 1 - i) * HOUR), value })) };
}
const flat = (v: number, n: number) => Array.from({ length: n }, () => v);
const latest = (parameter: string, units: string, value: number, h = 0.5) => ({ parameter, units, value, time: hoursAgo(h) });

describe("per-station NAQI (PM 24-hour means + latest gases)", () => {
  it("computes the PM 24-hour mean sub-index and takes the maximum, CPCB breakpoints", () => {
    const r = naqiForStation(
      [hours("pm25", "µg/m³", flat(180, 24)), hours("pm10", "µg/m³", flat(300, 24))],
      [latest("no2", "µg/m³", 60), latest("co", "mg/m³", 1.5), latest("o3", "µg/m³", 20)],
      NOW,
    );
    assert.equal(r.status, "ok");
    // PM2.5 180 µg/m³ → Very poor band 121–250 → 301–400: 301 + 99/129 × 59 ≈ 346.
    assert.equal(r.concentrations.pm2_5?.subIndex, 346);
    assert.equal(r.concentrations.pm2_5?.basis, "24h-mean");
    assert.equal(r.concentrations.pm2_5?.hours, 24);
    assert.equal(r.concentrations.nitrogen_dioxide?.basis, "latest-hour");
    assert.equal(r.value, 346);
    assert.equal(r.dominant, "pm2_5");
  });
  it("minimum-data rule: PM with fewer than 16 of 24 hours is not used", () => {
    const r = naqiForStation([hours("pm25", "µg/m³", flat(180, 15))], [latest("no2", "µg/m³", 60), latest("so2", "µg/m³", 10)], NOW);
    assert.equal(r.status, "insufficient");
    assert.equal(r.value, null);
    assert.match(r.reason ?? "", /PM2\.5 or PM10/);
    const ok16 = naqiForStation([hours("pm25", "µg/m³", flat(180, 16))], [latest("no2", "µg/m³", 60), latest("so2", "µg/m³", 10)], NOW);
    assert.equal(ok16.status, "ok");
  });
  it("needs at least 3 pollutants including PM", () => {
    const two = naqiForStation([hours("pm25", "µg/m³", flat(180, 24))], [latest("no2", "µg/m³", 60)], NOW);
    assert.equal(two.status, "insufficient");
    assert.match(two.reason ?? "", /at least 3 pollutants \(found 2\)/);
  });
  it("ignores gas readings older than 3 hours and PM data older than 3 hours", () => {
    const oldGas = naqiForStation([hours("pm25", "µg/m³", flat(180, 24))], [latest("no2", "µg/m³", 60, 3.5), latest("so2", "µg/m³", 10)], NOW);
    assert.equal(oldGas.status, "insufficient");
    const oldPm = naqiForStation([hours("pm25", "µg/m³", flat(180, 24), 4)], [latest("no2", "µg/m³", 60), latest("so2", "µg/m³", 10)], NOW);
    assert.equal(oldPm.status, "insufficient");
    assert.match(oldPm.reason ?? "", /older than 3 hours/);
  });
  it("converts ppb/ppm gases and keeps CO in mg/m³", () => {
    const r = naqiForStation(
      [hours("pm25", "µg/m³", flat(40, 24))],
      [latest("no2", "ppb", 100), latest("co", "ppm", 2)],
      NOW,
    );
    // NO2 100 ppb = 188.2 µg/m³ → Poor (181–280 → 201–300): 201 + 99/99 × 7.2 = 208. CO 2 ppm = 2.29 mg/m³ → Moderately polluted.
    assert.equal(r.concentrations.nitrogen_dioxide?.subIndex, 208);
    assert.equal(r.concentrations.carbon_monoxide?.unit, "mg/m³");
    assert.ok(Math.abs((r.concentrations.carbon_monoxide?.value ?? 0) - 2.291) < 0.01);
    assert.equal(r.dominant, "nitrogen_dioxide");
  });
});

function st(id: string, value: number | null, distanceKm: number, ageH = 0.5, status: "ok" | "insufficient" = "ok"): StationNaqiStation {
  return {
    id,
    name: `Station ${id}`,
    provider: "CPCB",
    cpcb: true,
    latitude: 28.6,
    longitude: 77.2,
    distanceKm,
    url: "",
    value,
    dominant: value === null ? null : "pm2_5",
    status: value === null ? "insufficient" : status,
    reason: value === null ? "Not enough data" : null,
    observedAt: hoursAgo(ageH),
    concentrations: {},
  };
}

describe("median NAQI across stations", () => {
  it("≥ 3 stations with enough data: the median, the highest and the count", () => {
    const s = summarizeStationNaqi([st("a", 310, 2), st("b", 350, 4), st("c", 420, 9), st("d", 330, 6), st("e", null, 1)], NOW);
    assert.equal(s.status, "ok");
    assert.equal(s.method, "median");
    assert.equal(s.count, 4);
    assert.equal(s.checked, 5);
    assert.equal(s.value, 340); // median of 310, 330, 350, 420
    assert.equal(s.highest?.value, 420);
    assert.equal(s.nearest?.id, "a"); // nearest WITH enough data (e is closer but insufficient)
  });
  it("fewer than 3: the nearest station with enough data", () => {
    const s = summarizeStationNaqi([st("a", 310, 7), st("b", 250, 3), st("c", null, 1)], NOW);
    assert.equal(s.method, "nearest");
    assert.equal(s.value, 250);
    assert.equal(s.nearest?.id, "b");
  });
  it("none with enough data, or stale: status none with a reason", () => {
    const s = summarizeStationNaqi([st("a", null, 2), st("b", 300, 3, 3.5)], NOW);
    assert.equal(s.status, "none");
    assert.equal(s.value, null);
    assert.match(s.note ?? "", /2 stations within 15 km checked; none has enough data/);
    assert.match(summarizeStationNaqi([], NOW).note ?? "", /No OpenAQ station/);
  });
  it("fetch failures (e.g. rate limit) are an error, not 'none has enough data'", () => {
    const failed = { ...st("a", null, 2, 0.5, "insufficient"), reason: "OpenAQ: rate limit: next slot in 50 s", fetchFailed: true };
    const s = summarizeStationNaqi([failed, st("b", null, 3)], NOW);
    assert.equal(s.status, "error");
    assert.equal(s.value, null);
    assert.match(s.note ?? "", /could not be fetched from OpenAQ for 1 of 2 stations \(rate limit: next slot in 50 s\); .*temporarily unavailable/);
    assert.doesNotMatch(s.note ?? "", /none has enough data/);
    // A partial fetch must not let one station stand in for the city (live Bengaluru: nearest 180 vs median 116).
    const partial = summarizeStationNaqi([failed, st("b", 180, 3), st("c", null, 4)], NOW);
    assert.equal(partial.status, "error");
    assert.equal(partial.value, null);
    // With >= 3 usable stations the median stands even if others failed.
    const enough = summarizeStationNaqi([failed, st("b", 180, 3), st("c", 110, 4), st("d", 116, 5)], NOW);
    assert.equal(enough.status, "ok");
    assert.equal(enough.method, "median");
    assert.equal(enough.value, 116);
    // Without failures, a single usable station is still used as "nearest".
    assert.equal(summarizeStationNaqi([st("b", 300, 3)], NOW).method, "nearest");
  });
});

describe("choosing and matching stations", () => {
  const c = (id: number, provider: string | null, distanceKm: number, isMonitor: boolean | null = true, lastH = 0.5): StationCandidate => ({
    id,
    name: `L${id}`,
    provider,
    isMonitor,
    latitude: 28.6,
    longitude: 77.2,
    distanceKm,
    lastSeen: hoursAgo(lastH),
    pmSensors: [{ id: id * 10, parameter: "pm25", units: "µg/m³" }],
  });
  it("CPCB first, then other monitors, then sensors; fresh only; within 15 km; capped at 15", () => {
    const list = [c(1, "AirNow", 1), c(2, "CPCB", 5), c(3, "Clarity", 0.5, false), c(4, "CPCB", 2), c(5, "CPCB", 16), c(6, "CPCB", 3, true, 4)];
    assert.deepEqual(chooseStations(list, NOW).map((x) => x.id), [4, 2, 1, 3]);
    const many = Array.from({ length: 30 }, (_, i) => c(100 + i, "CPCB", i * 0.4));
    assert.equal(chooseStations(many, NOW).length, 15);
  });
  it("recognises CPCB providers", () => {
    assert.equal(isCpcbProvider("CPCB"), true);
    assert.equal(isCpcbProvider("Central Pollution Control Board"), true);
    assert.equal(isCpcbProvider("AirNow"), false);
    assert.equal(isCpcbProvider(null), false);
  });
  it("matches a WAQI station by coordinates or a shared name word (display only)", () => {
    const waqi = [
      { id: "waqi-1", name: "Anand Vihar, Delhi, Delhi, India", latitude: 28.6469, longitude: 77.3164, aqi: 404, observedAt: null },
      { id: "waqi-2", name: "ITO, Delhi, Delhi, India", latitude: 28.6286, longitude: 77.2410, aqi: 280, observedAt: null },
    ];
    const anand = matchStation({ name: "Anand Vihar, Delhi - DPCC", latitude: 28.6474, longitude: 77.3158 }, waqi, haversineKm);
    assert.equal(anand?.id, "waqi-1");
    // Same name word but 20 km away: no match.
    assert.equal(matchStation({ name: "Anand Vihar", latitude: 28.8, longitude: 77.3 }, waqi, haversineKm), null);
    // Different name, within 0.5 km: same site.
    assert.equal(matchStation({ name: "Income Tax Office", latitude: 28.6290, longitude: 77.2412 }, waqi, haversineKm)?.id, "waqi-2");
    // The city word alone ("Delhi") is not distinctive.
    assert.equal(matchStation({ name: "Delhi Cantt", latitude: 28.62, longitude: 77.22 }, waqi, haversineKm), null);
  });
});

/* ------------------------------------------------------------------------- */
/* Headline: never a contradictory NAQI                                       */
/* ------------------------------------------------------------------------- */

function ws(id: string, aqi: number, distanceKm: number, ageH = 0.5, name = `Station ${id}, Delhi, India`): NearbyStation {
  return { id, name, source: "waqi", aqi, aqiBasis: "reported", latitude: 28.6, longitude: 77.2, distanceKm, observedAt: hoursAgo(ageH) };
}
/** 18 fresh WAQI stations with median 248 (Delhi, 14 Nov 2026 22:38 IST). */
const DELHI = Array.from({ length: 18 }, (_, i) => ws(`d${i}`, i < 9 ? 240 + i : 248 + (i - 9) * 5, 2 + i * 0.6));

function input(over: Partial<HeadlineInput>): HeadlineInput {
  return { scale: "in", mode: "auto", now: NOW, model: { value: 188, usAqi: 174, time: hoursAgo(0.5) }, stations: DELHI, stationStatus: "ok", ...over };
}
const NOT_CONFIGURED: StationNaqiSummary = {
  status: "not-configured",
  method: null,
  value: null,
  count: 0,
  checked: 0,
  median: null,
  nearest: null,
  highest: null,
  latestObservedAt: null,
  note: "not configured",
};

describe("consistency check (model NAQI vs what station US AQI implies)", () => {
  it("inverts the US AQI PM2.5 sub-index", () => {
    for (const c of [5, 20.4, 45, 100, 172.9, 300]) assert.ok(Math.abs((pm25ForUsAqi(pm25Index(c) as number) as number) - c) < 1, `c=${c}`);
    assert.equal(pm25ForUsAqi(-1), null);
  });
  it("Delhi: stations' median US AQI 248 vs model NAQI 188 → warning (Very poor implied vs Moderately polluted)", () => {
    assert.equal(impliedNaqiRank(248), 4); // Very poor
    const c = naqiConsistency(188, 248);
    assert.deepEqual(c, { modelRank: 2, impliedRank: 4, warn: true });
  });
  it("one category apart is not a contradiction; the same or higher is fine", () => {
    assert.equal(naqiConsistency(250, 248)?.warn, false); // Poor vs Very poor
    assert.equal(naqiConsistency(340, 248)?.warn, false);
    assert.equal(naqiConsistency(90, 120)?.warn, false); // Satisfactory vs Moderately polluted
    assert.equal(naqiConsistency(40, 160)?.warn, true); // Good vs Poor (PM2.5 ~ 70 → 201–300)
    assert.equal(naqiConsistency(null, 248), null);
    assert.equal(naqiConsistency(188, null), null);
  });
});

describe("India NAQI headline (Phase 9b)", () => {
  it("Delhi with no station NAQI: unavailable, never the model's 188 as an equal peer, plus the warning", () => {
    const h = selectHeadline(input({ stationNaqi: NOT_CONFIGURED }));
    assert.equal(h.source, "unavailable");
    assert.equal(h.value, null);
    assert.equal(h.naqiBasis, "unavailable");
    assert.equal(h.modelValue, 188);
    assert.equal(h.stationUsAqi, 248);
    assert.equal(naqiLabel(h), "India NAQI from stations unavailable");
    assert.equal(sourceLabel(h), "Station NAQI unavailable");
    assert.equal(modelEstimateLine(h, String), "NAQI 188: model estimate, likely lower than station readings here");
    assert.match(h.stationNote ?? "", /not configured/);
    assert.match(h.consistencyWarning ?? "", /NAQI 188 \(Moderately polluted\) is more than one category below .*median of 18 nearby stations.*US AQI 248.*Very poor/);
    // Advice never rests on the lower model estimate.
    assert.deepEqual(adviceBasis(h), { scale: "us", value: 248, label: "US AQI from stations (station-based NAQI unavailable)" });
  });
  it("Delhi with station NAQI: the median from concentrations, labelled", () => {
    const ref = (id: string, value: number, d: number) => ({ id, name: `S ${id}`, value, dominant: "pm2_5" as const, distanceKm: d, observedAt: hoursAgo(0.5) });
    const sn: StationNaqiSummary = {
      status: "ok",
      method: "median",
      value: 341,
      count: 9,
      checked: 15,
      median: 341,
      nearest: ref("n", 330, 2.4),
      highest: ref("h", 402, 11),
      latestObservedAt: hoursAgo(0.5),
      note: null,
    };
    const h = selectHeadline(input({ stationNaqi: sn }));
    assert.equal(h.source, "stations-median");
    assert.equal(h.value, 341);
    assert.equal(h.stationCount, 9);
    assert.equal(h.highest?.value, 402);
    // The model NAQI is not shown when the stations give the NAQI, so there is nothing to warn about.
    assert.equal(h.consistencyWarning, null);
    assert.equal(naqiLabel(h), "India NAQI, computed by AirIQ from station concentrations (median of 9 stations)");
    // Nearest-station mode uses the nearest station with enough data.
    const n = selectHeadline(input({ mode: "station", stationNaqi: sn }));
    assert.equal(n.source, "station");
    assert.equal(n.value, 330);
    assert.match(naqiLabel(n) ?? "", /nearest station with enough data: S n, 2 km/);
  });
  it("while station NAQI is loading: pending, no value", () => {
    const h = selectHeadline(input({ stationNaqi: null }));
    assert.equal(h.source, "unavailable");
    assert.equal(h.naqiPending, true);
    assert.match(h.stationNote ?? "", /Computing India NAQI/);
  });
  it("no stations near (Sonipat-like): the model NAQI is the headline, labelled model-based, no warning", () => {
    const h = selectHeadline(input({ stations: [], model: { value: 87, usAqi: 145, time: hoursAgo(0.5) }, stationNaqi: NOT_CONFIGURED }));
    assert.equal(h.source, "model");
    assert.equal(h.value, 87);
    assert.equal(naqiLabel(h), "India NAQI, computed by AirIQ from model concentrations");
    assert.equal(h.consistencyWarning, null);
  });
  it("Model only: the model NAQI, still with the warning when stations imply far worse", () => {
    const h = selectHeadline(input({ mode: "model", stationNaqi: NOT_CONFIGURED }));
    assert.equal(h.source, "model");
    assert.equal(h.value, 188);
    assert.match(h.consistencyWarning ?? "", /likely lower than station readings/);
  });
  it("other scales carry no NAQI fields", () => {
    const h = selectHeadline(input({ scale: "us", model: { value: 174, usAqi: 174, time: hoursAgo(0.5) } }));
    assert.equal(h.naqiBasis, null);
    assert.equal(h.consistencyWarning, null);
    assert.equal(naqiLabel(h), null);
  });
});

describe("older station readings (3 h / 12 h edges)", () => {
  const murthal = (ageH: number, distanceKm = 5.1) => ws("m", 187, distanceKm, ageH, "Murthal, Sonipat, India");
  it("exactly 3 h old is still fresh (it is the headline), so no older line", () => {
    assert.equal(olderReadingFor([murthal(3)], NOW, 145), null);
  });
  it("just over 3 h → shown; 12 h → shown; just over 12 h → not shown", () => {
    assert.equal(olderReadingFor([murthal(3 + 1 / 60)], NOW, 145)?.name, "Murthal, Sonipat, India");
    assert.equal(olderReadingFor([murthal(12)], NOW, 145)?.ageHours, 12);
    assert.equal(olderReadingFor([murthal(12 + 1 / 60)], NOW, 145), null);
  });
  it("only within 10 km", () => {
    assert.equal(olderReadingFor([murthal(4.6, 10)], NOW, 145)?.id, "m");
    assert.equal(olderReadingFor([murthal(4.6, 10.1)], NOW, 145), null);
  });
  it("a fresh nearer station hides it; a >12 h nearer station does not", () => {
    assert.equal(olderReadingFor([ws("f", 150, 2, 1), murthal(4.6)], NOW, 145), null);
    assert.equal(olderReadingFor([ws("x", 150, 2, 13), murthal(4.6)], NOW, 145)?.id, "m");
  });
  it("the 25% note: 187 vs 145 (29% above) yes; 180 vs 145 (24%) no", () => {
    assert.equal(olderReadingFor([murthal(4.6)], NOW, 145)?.aboveReference, true);
    assert.equal(olderReadingFor([{ ...murthal(4.6), aqi: 180 }], NOW, 145)?.aboveReference, false);
    assert.equal(olderReadingFor([murthal(4.6)], NOW, null)?.aboveReference, false);
  });
  it("the Sonipat line, on the headline", () => {
    const h = selectHeadline({
      scale: "us",
      mode: "auto",
      now: NOW,
      model: { value: 145, usAqi: 145, time: hoursAgo(0.5) },
      stations: [murthal(4.6)],
      stationStatus: "ok",
    });
    assert.equal(h.source, "model");
    assert.ok(h.olderReading);
    assert.equal(
      olderReadingText(h.olderReading, () => "18:00 IST"),
      "Last reading at Murthal, Sonipat (5.1 km): 187, 18:00 IST (4.6 h ago)",
    );
    assert.equal(h.olderReading.aboveReference, true);
    // On the NAQI scale it is compared with the model's US AQI and prefixed "US AQI".
    const inn = selectHeadline({ scale: "in", mode: "auto", now: NOW, model: { value: 87, usAqi: 145, time: hoursAgo(0.5) }, stations: [murthal(4.6)], stationStatus: "ok", stationNaqi: NOT_CONFIGURED });
    assert.equal(inn.source, "model"); // the 4.6 h old station does not drive the headline
    assert.match(olderReadingText(inn.olderReading!, () => "18:00 IST", true), /: US AQI 187, 18:00 IST/);
    // Model only: no station lines.
    assert.equal(selectHeadline({ scale: "us", mode: "model", now: NOW, model: { value: 145, usAqi: 145, time: "t" }, stations: [murthal(4.6)], stationStatus: "ok" }).olderReading, null);
  });
});

describe("rate limiter", () => {
  it("allows `limit` requests per window, then waits for the oldest to leave; rejects long waits", async () => {
    let t = 0;
    const slept: number[] = [];
    const lim = new SlidingLimiter({ limit: 3, windowMs: 60_000, maxWaitMs: 20_000, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; } });
    await lim.acquire();
    t = 50_000;
    await lim.acquire();
    await lim.acquire();
    assert.equal(lim.used(), 3);
    // Next slot when the request at t=0 leaves the window (t = 60 000): a 10 s wait.
    await lim.acquire();
    assert.equal(t, 60_000);
    assert.ok(slept.length > 0);
    // Now 3 in the window again (50 000, 50 000, 60 000): next slot at 110 000 → 50 s > 20 s → reject.
    await assert.rejects(lim.acquire(), RateLimitWaitError);
  });
  it("backs off after a 429 and honours an aborted signal", async () => {
    let t = 0;
    const lim = new SlidingLimiter({ limit: 50, windowMs: 60_000, maxWaitMs: 20_000, now: () => t, sleep: async (ms) => { t += ms; } });
    lim.backoff(60_000);
    await assert.rejects(lim.acquire(), RateLimitWaitError);
    const ctrl = new AbortController();
    ctrl.abort();
    await assert.rejects(lim.acquire(ctrl.signal), /Abort/);
  });
});

describe("numeric guard: model NAQI never quoted as the city's NAQI when restricted", () => {
  const result = {
    indiaNaqi: {
      basis: "unavailable",
      label: "India NAQI from stations unavailable",
      value: null,
      consistencyWarning: "The model's NAQI 188 (Moderately polluted) is more than one category below…",
      modelNaqiEstimate: { value: 188, display: "188", category: "Moderately polluted", label: "model estimate, likely lower than station readings here" },
    },
    headline: { aqi: { value: 248, display: "248" } },
  };
  it("rejects 'Delhi's NAQI is 188' but accepts it called a model estimate", () => {
    assert.deepEqual(checkGrounding("Delhi's India NAQI is 188 (Moderately polluted).", [result], "q").unsupported, ["188"]);
    assert.deepEqual(checkGrounding("The NAQI is 188.", [result], "q").unsupported, ["188"]);
    assert.deepEqual(
      checkGrounding("Station-based NAQI is unavailable; the model estimate of NAQI 188 is likely lower than station readings. Stations read US AQI 248.", [result], "q").unsupported,
      [],
    );
  });
  it("a station-based NAQI value is accepted as the city's NAQI", () => {
    const ok = { indiaNaqi: { basis: "stations", value: 341, display: "341" } };
    assert.deepEqual(checkGrounding("Delhi's India NAQI is 341 (Very poor), the median of 9 stations.", [ok], "q").unsupported, []);
  });
});
