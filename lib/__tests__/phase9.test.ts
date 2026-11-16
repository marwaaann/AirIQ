import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateRule, metricLabel, metricValue, type AlertRule, type ReadingSource } from "../alerts.ts";
import { checkGrounding } from "../assistant/grounding-check.ts";
import { runTool, type AssistantDataLayer } from "../assistant/tools.ts";
import { getCategory } from "../aqi-categories.ts";
import { blendHeat, GAP_KM, MIN_STATIONS_FOR_BLEND } from "../heat-blend.ts";
import { episodeActions, healthAdvice } from "../health-advice.ts";
import { HEALTH_RULES } from "../health-rules.ts";
import { selectHeadline, sourceLabel, type NearbyStation } from "../headline-source.ts";
import { PROFILE_IDS, PROFILES } from "../profiles.ts";
import type { AirResponse, NearbyStationsResponse, StationNaqiResponse } from "../../types/api.ts";

const NOW = Date.parse("2026-11-14T16:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

/* ------------------------------------------------------------------------- */
/* Heatmap blending                                                           */
/* ------------------------------------------------------------------------- */

describe("heatmap blending", () => {
  const grid = [
    { lat: 28.6, lon: 77.2, value: 177 },
    { lat: 28.6, lon: 77.4, value: 177 },
    { lat: 29.5, lon: 77.2, value: 150 }, // ~100 km north: a gap
  ];
  const stations = Array.from({ length: 5 }, (_, i) => ({ lat: 28.6 + i * 0.02, lon: 77.2 + i * 0.03, value: 300 + i * 10 }));

  it("Model only uses the grid", () => {
    const r = blendHeat({ mode: "model", stations, grid, stationsComparable: true });
    assert.equal(r.driver, "model");
    assert.ok(r.samples.every((s) => s.source === "model"));
  });
  it("Stations only uses the stations, and says when there are none", () => {
    const r = blendHeat({ mode: "stations", stations, grid, stationsComparable: true });
    assert.equal(r.driver, "stations");
    assert.equal(r.samples.length, 5);
    assert.equal(blendHeat({ mode: "stations", stations: [], grid, stationsComparable: true }).driver, "none");
  });
  it(`Blended: ≥ ${MIN_STATIONS_FOR_BLEND} fresh stations drive the surface; the model fills only the gaps (> ${GAP_KM} km)`, () => {
    const r = blendHeat({ mode: "blended", stations, grid, stationsComparable: true });
    assert.equal(r.driver, "mixed");
    const model = r.samples.filter((s) => s.source === "model");
    assert.deepEqual(model.map((m) => m.lat), [29.5]);
    assert.match(r.note, /model grid fills areas more than 15 km/);
  });
  it("Blended falls back to the model with fewer than 5 stations, and says why", () => {
    const r = blendHeat({ mode: "blended", stations: stations.slice(0, 4), grid, stationsComparable: true });
    assert.equal(r.driver, "model");
    assert.match(r.note, /at least 5 fresh stations in view \(4 here\)/);
  });
  it("never blends station US AQI into another scale or a pollutant layer", () => {
    const r = blendHeat({ mode: "blended", stations, grid, stationsComparable: false });
    assert.equal(r.driver, "model");
    assert.match(r.note, /not blended/);
  });
  it("keeps beyond-index station values (no clipping)", () => {
    const r = blendHeat({ mode: "stations", stations: [{ lat: 1, lon: 1, value: 650 }], grid: [], stationsComparable: true });
    assert.equal(r.samples[0].value, 650);
  });
});

/* ------------------------------------------------------------------------- */
/* Health rules: Hazardous and beyond-index get the strongest guidance         */
/* ------------------------------------------------------------------------- */

const pollutants = { pm2_5: 400, pm10: 500, nitrogen_dioxide: 40, sulphur_dioxide: 10, ozone: 20, carbon_monoxide: 900 };

describe("health rules table", () => {
  it("has a headline for every scale × audience × rank (0–5)", () => {
    for (const scale of ["us", "eu", "in"] as const) {
      for (const audience of ["general", "sensitive"] as const) {
        for (let rank = 0; rank <= 5; rank++) {
          const found = HEALTH_RULES.some((r) => r.group === "headline" && r.when.scale === scale && r.when.audience === audience && r.when.ranks?.includes(rank));
          assert.ok(found, `${scale}/${audience}/${rank}`);
        }
      }
    }
  });
  it("NAQI headlines cite CPCB and NAQI activity rows say they apply EPA guidance by rank", () => {
    const head = HEALTH_RULES.filter((r) => r.group === "headline" && r.when.scale === "in");
    assert.ok(head.every((r) => /CPCB/.test(r.basis)));
    const act = HEALTH_RULES.filter((r) => r.group === "activity" && r.when.scale === "in");
    assert.ok(act.length > 0 && act.every((r) => /applied by AirIQ to the NAQI category/.test(r.basis)));
  });
  it("beyond-index (US 650) gives exactly the Hazardous guidance for every profile", () => {
    for (const profile of PROFILE_IDS) {
      const base = { scale: "us" as const, dominant: "pm2_5" as const, pollutants, profile, localHour: 9 };
      const haz = healthAdvice({ ...base, aqi: 400 });
      const beyond = healthAdvice({ ...base, aqi: 650 });
      assert.equal(haz.rank, 5);
      assert.equal(beyond.rank, 5);
      assert.equal(beyond.category.key, "beyond-index");
      assert.equal(beyond.headline.text, haz.headline.text, profile);
      assert.deepEqual(
        beyond.activity.map((g) => g.items.map((i) => i.id)),
        haz.activity.map((g) => g.items.map((i) => i.id)),
      );
    }
  });
  it("NAQI Severe and beyond (612) map to the strongest rows on that scale", () => {
    for (const profile of PROFILE_IDS) {
      const a = healthAdvice({ aqi: 612, scale: "in", dominant: "pm2_5", pollutants, profile, localHour: 9 });
      assert.equal(a.rank, 5);
      assert.match(a.headline.text, /^Severe/);
      const ex = a.activity.find((g) => g.kind === "exercise")?.items[0];
      assert.ok(ex && /outdoors/i.test(ex.text), `${profile}: ${ex?.text}`);
    }
  });
  it("episode actions: the top outdoor-activity row plus the respirator row for particles", () => {
    const a = healthAdvice({ aqi: 320, scale: "us", dominant: "pm2_5", pollutants, profile: "general", localHour: 9 });
    const acts = episodeActions(a);
    assert.equal(acts.length, 2);
    assert.equal(acts[0].text, "Avoid all physical activity outdoors.");
    assert.match(acts[1].text, /N95 or P100 respirator/);
    assert.ok(acts.every((x) => x.basis.length > 0));
  });
  it("NAQI-aware default alert thresholds", () => {
    assert.equal(PROFILES.general.defaultThreshold.in, 200);
    assert.equal(PROFILES.respiratory.defaultThreshold.in, 100);
    assert.equal(getCategory(PROFILES.general.defaultThreshold.in + 1, "in").key, "poor");
  });
});

/* ------------------------------------------------------------------------- */
/* Alerts: headline source, NAQI, values above 500                             */
/* ------------------------------------------------------------------------- */

const rule = (over: Partial<AlertRule> = {}): AlertRule => ({
  id: "r1",
  city: { name: "Delhi", latitude: 28.61, longitude: 77.21, timezone: "Asia/Kolkata", slug: "delhi-28.61-77.21" },
  metric: "aqi",
  scale: "us",
  threshold: 300,
  trigger: { type: "current" },
  quietHours: null,
  enabled: true,
  createdAt: "2026-11-14T00:00:00Z",
  ...over,
});

describe("alerts with the headline in effect", () => {
  it("fire on a beyond-index value, show 500+ with the computed number, and record the source", () => {
    const reading: ReadingSource = { time: ago(20), usAqi: 650, euAqi: 120, inAqi: 640, sourceLabels: { us: "Stations (median of 18)", in: "Model (Open-Meteo)" } };
    const ev = evaluateRule(rule(), reading, null, NOW).events[0];
    assert.ok(ev);
    assert.equal(ev.value, 650);
    assert.equal(ev.title, "Delhi: US AQI 500+ (above 300)");
    assert.match(ev.message, /US AQI is 500\+ \(computed 650, beyond the 500 top of the index\)/);
    assert.match(ev.message, /source: Stations \(median of 18\)/);
    assert.equal(ev.source, "Stations (median of 18)");
  });
  it("NAQI rules read the NAQI value and label it", () => {
    const reading: ReadingSource = { time: ago(20), usAqi: 177, euAqi: 65, inAqi: 304, sourceLabels: { in: "Station: Murthal (5 km)" } };
    assert.equal(metricValue(reading, "aqi", "in"), 304);
    assert.equal(metricLabel("aqi", "in"), "India NAQI");
    const ev = evaluateRule(rule({ scale: "in", threshold: 200 }), reading, null, NOW).events[0];
    assert.equal(ev.source, "Station: Murthal (5 km)");
    assert.equal(ev.scale, "in");
  });
  it("stale station data (older than 3 h) falls back to the model, and the event says so", () => {
    const stale: NearbyStation[] = ["a", "b", "c"].map((id) => ({
      id,
      name: id,
      source: "waqi",
      aqi: 400,
      aqiBasis: "reported",
      latitude: 0,
      longitude: 0,
      distanceKm: 3,
      observedAt: ago(200),
    }));
    const h = selectHeadline({ scale: "us", mode: "auto", now: NOW, model: { value: 320, usAqi: 320, time: ago(30) }, stations: stale, stationStatus: "ok" });
    assert.equal(h.source, "model");
    const ev = evaluateRule(rule(), { time: ago(30), usAqi: h.value, euAqi: null, sourceLabels: { us: sourceLabel(h) } }, null, NOW).events[0];
    assert.equal(ev.value, 320);
    assert.equal(ev.source, "Model (Open-Meteo)");
  });
  it("pollutant sub-index rules are model-based and say so", () => {
    const ev = evaluateRule(rule({ metric: "pm2_5", threshold: 100 }), { time: ago(30), usAqi: 300, euAqi: null, usSubIndices: { pm2_5: 250 }, sourceLabels: { us: "Stations (median of 9)" } }, null, NOW).events[0];
    assert.equal(ev.source, "Model (Open-Meteo)");
  });
});

/* ------------------------------------------------------------------------- */
/* Assistant: station summary, discrepancy, NAQI, beyond index, grounding      */
/* ------------------------------------------------------------------------- */

function air(usAqi: number, inAqi: number | null = 300): AirResponse {
  return {
    current: {
      source: "open-meteo",
      latitude: 28.61,
      longitude: 77.21,
      time: ago(30),
      timezone: "Asia/Kolkata",
      utcOffsetSeconds: 19800,
      usAqi,
      euAqi: 65,
      uvIndex: 0,
      pollutants: { pm2_5: 60.8, pm10: 78, nitrogen_dioxide: 52.9, sulphur_dioxide: 29.7, ozone: 36, carbon_monoxide: 789 },
      usSubIndices: { pm2_5: usAqi },
      euSubIndices: { pm2_5: 65 },
      dominantUs: "pm2_5",
      dominantEu: "pm2_5",
      inAqi,
      inSubIndices: inAqi === null ? {} : { pm2_5: inAqi },
      dominantIn: inAqi === null ? null : "pm2_5",
      inReason: inAqi === null ? "Not enough data: NAQI needs PM2.5 or PM10 with at least 16 hours in the last 24." : null,
    },
    epa: { aqi2024: usAqi, aqi2012: usAqi, dominant: "pm2_5", subIndices: {}, pm25Mean24h: 60 },
    recent: { latitude: 28.61, longitude: 77.21, timezone: "Asia/Kolkata", utcOffsetSeconds: 19800, points: [] },
    fetchedAt: new Date(NOW).toISOString(),
  };
}

const NOT_CONFIGURED_NAQI: StationNaqiResponse = {
  status: "not-configured",
  method: null,
  value: null,
  count: 0,
  checked: 0,
  median: null,
  nearest: null,
  highest: null,
  latestObservedAt: null,
  note: "Station concentrations (OpenAQ) are not configured on this server.",
  source: "none",
  radiusKm: 15,
  stations: [],
  fetchedAt: new Date(NOW).toISOString(),
};

function nearby(values: number[]): NearbyStationsResponse {
  return {
    status: "ok",
    source: "waqi",
    radiusKm: 15,
    fetchedAt: new Date(NOW).toISOString(),
    stations: values.map((v, i) => ({
      id: `waqi-${i}`,
      name: i === values.length - 1 ? "Anand Vihar, Delhi, Delhi, India" : `Station ${i}, Delhi`,
      source: "waqi",
      aqi: v,
      aqiBasis: "reported",
      latitude: 28.6,
      longitude: 77.2,
      distanceKm: 2 + i,
      observedAt: ago(40),
    })),
  };
}

function deps(usAqi: number, stations: number[] | "error", inAqi: number | null = 300): AssistantDataLayer {
  return {
    geocode: async () => [],
    currentAir: async () => air(usAqi, inAqi),
    airSeries: async () => ({ latitude: 0, longitude: 0, timezone: "Asia/Kolkata", utcOffsetSeconds: 19800, points: [] }),
    sunTimes: async () => null,
    nearbyStations: async () => {
      if (stations === "error") throw new Error("feed down");
      return nearby(stations);
    },
    stationNaqi: async () => NOT_CONFIGURED_NAQI,
    now: () => NOW,
  };
}

describe("assistant tools with ground stations", () => {
  it("get_current_aqi returns the station headline, the summary, the model value and the discrepancy", async () => {
    const r = await runTool("get_current_aqi", { lat: 28.61, lon: 77.21, city: "Delhi" }, deps(177, [205, 231, 260, 440]));
    const res = r.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(res.headline.source, "stations-median");
    assert.equal(res.headline.aqi.value, 246);
    assert.equal(res.stations.freshStationsWithin15km, 4);
    assert.equal(res.stations.medianAqi, 246);
    assert.deepEqual(res.stations.highest.name, "Anand Vihar");
    assert.equal(res.stations.highest.aqi, 440);
    assert.equal(res.model.usAqi.value, 177);
    assert.equal(res.stations.stationVsModelPercent, 39);
    // Phase 9b: stations drive the headline and no station-based NAQI exists (no OpenAQ key):
    // the model NAQI is only a labelled estimate, never the city's NAQI.
    assert.equal(res.indiaNaqi.basis, "unavailable");
    assert.equal(res.indiaNaqi.value, null);
    assert.equal(res.indiaNaqi.label, "India NAQI from stations unavailable");
    assert.equal(res.indiaNaqi.modelNaqiEstimate.value, 300);
    assert.match(res.indiaNaqi.modelNaqiEstimate.label, /likely lower than station readings/);
    assert.match(res.indiaNaqi.computedBy, /may differ from CPCB/);
    assert.match(r.summary, /headline from Stations \(median of 4\)/);
  });
  it("flags beyond-index values with display 500+", async () => {
    const r = await runTool("get_current_aqi", { lat: 28.61, lon: 77.21 }, deps(520, [610, 650, 700], 640));
    const res = r.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.deepEqual({ v: res.headline.aqi.value, d: res.headline.aqi.display, b: res.headline.aqi.beyondIndex }, { v: 650, d: "500+", b: true });
    assert.equal(res.model.usAqi.display, "500+");
    assert.equal(res.indiaNaqi.modelNaqiEstimate.display, "500+");
  });
  it("a failing station feed falls back to the model with a note, never an error", async () => {
    const r = await runTool("get_current_aqi", { lat: 28.61, lon: 77.21 }, deps(177, "error"));
    const res = r.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(r.ok, true);
    assert.equal(res.headline.source, "model");
    assert.match(res.stations.note, /No nearby station data/);
  });
  it("get_health_advice uses the headline in effect and states its source", async () => {
    const r = await runTool("get_health_advice", { lat: 28.61, lon: 77.21, profile: "athlete" }, deps(177, [205, 231, 260, 440]));
    const res = r.result as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    assert.equal(res.aqi, 246);
    assert.equal(res.aqiSource, "Stations (median of 4)");
    assert.equal(res.modelValue, 177);
    assert.equal(res.category, "Very Unhealthy");
  });
  it("NAQI advice reports 'not enough data' instead of guessing", async () => {
    const r = await runTool("get_health_advice", { lat: 28.61, lon: 77.21, scale: "in" }, deps(177, [], null));
    assert.equal((r.result as { status: string }).status, "no_data");
    assert.match(String((r.result as { note: string }).note), /16 hours/);
  });
  it("the numeric guard accepts station median, highest, model and NAQI figures, and 500+", async () => {
    const r = await runTool("get_current_aqi", { lat: 28.61, lon: 77.21 }, deps(177, [205, 231, 260, 440]));
    const ok = checkGrounding(
      "The median of 4 stations is US AQI 246 (Very Unhealthy); the highest is Anand Vihar at AQI 440, while the model estimate is AQI 177. The model estimate of India NAQI is 300, likely lower than station readings.",
      [r.result],
      "Is it safe to run?",
    );
    assert.deepEqual(ok.unsupported, []);
    const beyond = await runTool("get_current_aqi", { lat: 28.61, lon: 77.21 }, deps(520, [610, 650, 700], 640));
    assert.deepEqual(checkGrounding("The stations report US AQI 500+ (beyond the index; computed 650).", [beyond.result], "q").unsupported, []);
    // Phase 9b: the restricted model NAQI quoted as the city's NAQI is rejected.
    assert.deepEqual(checkGrounding("Delhi's India NAQI is 300 (Very poor).", [r.result], "q").unsupported, ["300"]);
    const bad = checkGrounding("The median of the stations is US AQI 999.", [r.result], "q");
    assert.deepEqual(bad.unsupported, ["999"]);
    // A distance is not an AQI: "AQI 5" must not be supported by distanceKm 5.
    assert.deepEqual(checkGrounding("The nearest station shows AQI 5.", [r.result], "q").unsupported, ["5"]);
  });
});
