import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatIndex } from "../aqi-categories.ts";
import { gaugeFraction } from "../gauge.ts";
import { gaugeCategories, SCALE_MAX } from "../aqi-categories.ts";
import { niceYMax } from "../chart-scale.ts";
import {
  DIVERGENCE_THRESHOLD,
  headlineSubtitle,
  isFresh,
  median,
  selectHeadline,
  shortName,
  sourceLabel,
  summarizeStations,
  type HeadlineInput,
  type NearbyStation,
  type StationNaqiSummary,
} from "../headline-source.ts";
import { boxAround, nearbyList, toNearby } from "../nearby.ts";
import type { Station } from "../../types/air.ts";

const NOW = Date.parse("2026-11-14T16:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

function st(id: string, aqi: number, distanceKm: number, ageMin = 30, name = `Station ${id}`): NearbyStation {
  return { id, name, source: "waqi", aqi, aqiBasis: "reported", latitude: 28.6, longitude: 77.2, distanceKm, observedAt: ago(ageMin) };
}

function input(over: Partial<HeadlineInput> = {}): HeadlineInput {
  return {
    scale: "us",
    mode: "auto",
    now: NOW,
    model: { value: 177, usAqi: 177, time: "2026-11-14T16:00:00.000Z" },
    stations: [],
    stationStatus: "ok",
    ...over,
  };
}

describe("station-first headline (Auto)", () => {
  it("≥ 3 fresh stations within 15 km: the median, with the highest and the count", () => {
    const h = selectHeadline(input({ stations: [st("a", 231, 5), st("b", 440, 11, 50, "Anand Vihar, Delhi"), st("c", 205, 7), st("d", 260, 14)] }));
    assert.equal(h.source, "stations-median");
    assert.equal(h.value, 246); // median of 205, 231, 260, 440
    assert.equal(h.stationCount, 4);
    assert.equal(h.highest?.name, "Anand Vihar, Delhi");
    assert.equal(h.highest?.value, 440);
    assert.equal(h.nearest?.id, "a");
    assert.equal(h.modelValue, 177);
    assert.equal(h.observedAt, ago(30));
    assert.equal(h.stationNote, null);
    assert.equal(h.reason, "Median of 4 stations within 15 km");
  });
  it("one fresh station within 10 km (fewer than 3 in range): that station", () => {
    const h = selectHeadline(input({ stations: [st("m", 187, 5.1, 120, "Murthal, Sonipat, India")] }));
    assert.equal(h.source, "station");
    assert.equal(h.value, 187);
    assert.equal(h.reason, "Nearest station: Murthal, Sonipat, India (5 km)");
  });
  it("a single station 10–15 km away is too far: the model, with a reason", () => {
    const h = selectHeadline(input({ stations: [st("far", 300, 12)] }));
    assert.equal(h.source, "model");
    assert.equal(h.value, 177);
    assert.match(h.stationNote ?? "", /none within 10 km/);
  });
  it("stations older than 3 hours are not used", () => {
    const h = selectHeadline(input({ stations: [st("a", 300, 2, 181), st("b", 310, 3, 200), st("c", 320, 4, 400)] }));
    assert.equal(h.source, "model");
    assert.equal(h.stationCount, 0);
    assert.match(h.stationNote ?? "", /reported in the last 3 hours/);
  });
  it("stations beyond 15 km are ignored", () => {
    const h = selectHeadline(input({ stations: [st("a", 300, 16), st("b", 300, 18), st("c", 300, 25)] }));
    assert.equal(h.source, "model");
    assert.match(h.stationNote ?? "", /no station within 15 km/);
  });
  it("no stations, not configured (token missing) and feed errors all fall back to the model with a visible note", () => {
    assert.match(selectHeadline(input()).stationNote ?? "", /No nearby station data/);
    const missing = selectHeadline(input({ stationStatus: "not-configured" }));
    assert.equal(missing.source, "model");
    assert.match(missing.stationNote ?? "", /not configured/);
    const failed = selectHeadline(input({ stationStatus: "error", stations: [st("a", 300, 2)] }));
    assert.equal(failed.source, "station"); // stations already in hand are still valid…
    const failedEmpty = selectHeadline(input({ stationStatus: "error" }));
    assert.equal(failedEmpty.source, "model"); // …but an empty failed feed says why.
    assert.match(failedEmpty.stationNote ?? "", /unavailable/);
  });
  it("a reading time in the future (bad clock) is not fresh", () => {
    assert.equal(isFresh(new Date(NOW + 2 * 3600_000).toISOString(), NOW), false);
    assert.equal(isFresh(null, NOW), false);
    assert.equal(isFresh(ago(179), NOW), true);
  });
});

describe("data-source modes", () => {
  const stations = [st("a", 231, 5), st("b", 440, 11), st("c", 205, 2)];
  it("Nearest station uses the closest fresh station within 15 km", () => {
    const h = selectHeadline(input({ mode: "station", stations }));
    assert.equal(h.source, "station");
    assert.equal(h.value, 205);
  });
  it("Model only always uses the model but still summarises the stations", () => {
    const h = selectHeadline(input({ mode: "model", stations }));
    assert.equal(h.source, "model");
    assert.equal(h.value, 177);
    assert.equal(h.summary.median, 231);
    assert.match(h.stationNote ?? "", /your data-source setting/);
  });
});

describe("scales", () => {
  const stations = [st("a", 231, 5), st("b", 440, 11), st("c", 205, 2)];
  it("European AQI uses the model (station values are US AQI and are never converted)", () => {
    const h = selectHeadline(input({ scale: "eu", model: { value: 65, usAqi: 177, time: "t" }, stations }));
    assert.equal(h.source, "model");
    assert.equal(h.value, 65);
    assert.match(h.stationNote ?? "", /US AQI scale/);
    assert.equal(h.showDivergenceNote, true);
  });
  it("India NAQI: station-based when OpenAQ concentrations exist; unavailable (not the model) when stations drive the US headline", () => {
    const ref = { id: "openaq-1", name: "Murthal", value: 304, dominant: "pm2_5" as const, distanceKm: 5.1, observedAt: ago(40) };
    const naqi: StationNaqiSummary = {
      status: "ok",
      method: "nearest",
      value: 304,
      count: 1,
      checked: 2,
      median: 304,
      nearest: ref,
      highest: ref,
      latestObservedAt: ago(40),
      note: null,
    };
    const s = selectHeadline(input({ scale: "in", model: { value: 89, usAqi: 150, time: "t" }, stations, stationNaqi: naqi }));
    assert.equal(s.source, "station");
    assert.equal(s.value, 304);
    assert.equal(s.naqiBasis, "stations");
    assert.equal(sourceLabel(s), "Station: Murthal (5 km)");
    // Stations drive the US headline (3 fresh stations) but no station NAQI: unavailable, model only as an estimate.
    const none = { ...naqi, status: "none" as const, method: null, value: null, count: 0, median: null, nearest: null, highest: null, latestObservedAt: null, note: "none" };
    const u = selectHeadline(input({ scale: "in", model: { value: 89, usAqi: 150, time: "t" }, stations, stationNaqi: none }));
    assert.equal(u.source, "unavailable");
    assert.equal(u.value, null);
    assert.equal(u.modelValue, 89);
    // No stations at all: the model NAQI is the headline.
    const m = selectHeadline(input({ scale: "in", model: { value: 89, usAqi: 150, time: "t" }, stationNaqi: none }));
    assert.equal(m.source, "model");
    assert.equal(m.value, 89);
    assert.equal(m.naqiBasis, "model");
    const forcedModel = selectHeadline(input({ scale: "in", mode: "model", model: { value: 89, usAqi: 150, time: "t" }, stationNaqi: naqi }));
    assert.equal(forcedModel.source, "model");
  });
});

describe("station vs model divergence (25%)", () => {
  it("shows the note above 25% either way and not at or below it", () => {
    const at = (stationAqi: number) =>
      selectHeadline(input({ model: { value: 100, usAqi: 100, time: "t" }, stations: [st("a", stationAqi, 2), st("b", stationAqi, 3), st("c", stationAqi, 4)] }));
    assert.equal(DIVERGENCE_THRESHOLD, 0.25);
    assert.equal(at(125).showDivergenceNote, false);
    assert.equal(at(126).showDivergenceNote, true);
    assert.equal(at(74).showDivergenceNote, true);
    assert.equal(at(75).showDivergenceNote, false);
    assert.ok(Math.abs((at(150).divergence as number) - 0.5) < 1e-9);
  });
  it("uses the nearest station when fewer than 3 are fresh", () => {
    const h = selectHeadline(input({ stations: [st("m", 187, 5.1)], model: { value: 150, usAqi: 150, time: "t" } }));
    assert.ok(Math.abs((h.divergence as number) - (187 - 150) / 150) < 1e-9);
    assert.equal(h.showDivergenceNote, false);
  });
  it("no divergence without stations or without a model value", () => {
    assert.equal(selectHeadline(input()).divergence, null);
    assert.equal(selectHeadline(input({ model: { value: null, usAqi: null, time: "t" }, stations: [st("a", 200, 1)] })).divergence, null);
  });
});

describe("subtitle and labels", () => {
  it("formats the station-median subtitle and the model one", () => {
    const h = selectHeadline(input({ stations: [st("a", 231, 5), st("b", 531, 9.2, 30, "Anand Vihar, Delhi, Delhi, India"), st("c", 205, 7)] }));
    const sub = headlineSubtitle(h, () => "18:00 IST", (v) => formatIndex(v, "us"));
    assert.equal(sub, "Median of 3 stations within 15 km · highest 500+ at Anand Vihar (9 km) · latest 18:00 IST");
    const m = selectHeadline(input({ model: { value: 150, usAqi: 150, time: "t" } }));
    assert.equal(headlineSubtitle(m, () => "", (v) => String(v)), "Model estimate: 150");
    assert.equal(sourceLabel(h), "Stations (median of 3)");
    assert.equal(sourceLabel(m), "Model (Open-Meteo)");
    assert.equal(shortName("Major Dhyan Chand National Stadium, Delhi, Delhi, India"), "Major Dhyan Chand National Stadium");
  });
  it("median handles even and odd counts and empty input", () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 2, 3]), 2.5);
    assert.equal(median([]), null);
  });
  it("summary picks the highest, nearest and latest observation", () => {
    const s = summarizeStations([st("a", 100, 3, 90), st("b", 300, 9, 20), st("c", 300, 4, 60)], NOW);
    assert.equal(s.highest?.id, "c"); // tie on value → the nearer one
    assert.equal(s.nearest?.id, "a");
    assert.equal(s.latestObservedAt, ago(20));
  });
});

describe("nearby list normalisation (/api/stations?lat&lon)", () => {
  const station = (id: string, lat: number, lon: number, aqi = 100): Station => ({
    id,
    source: "waqi",
    name: id,
    latitude: lat,
    longitude: lon,
    aqi,
    aqiBasis: "reported",
    dominant: null,
    pm25: null,
    updatedAt: ago(10),
  });
  it("adds distance (0.1 km) and age, filters by radius, sorts nearest first and caps the list", () => {
    const n = toNearby(station("x", 29.0272, 77.0621), 29.0, 77.02);
    assert.equal(n.distanceKm, 5.1); // Murthal from Sonipat's centre
    assert.equal(n.observedAt, ago(10));
    const many = Array.from({ length: 60 }, (_, i) => station(`s${i}`, 28.61 + i * 0.001, 77.21));
    const list = nearbyList([station("far", 29.5, 77.21), ...many], 28.61, 77.21, 15, 40);
    assert.equal(list.length, 40);
    assert.equal(list[0].id, "s0");
    assert.ok(list.every((s, i) => i === 0 || s.distanceKm >= list[i - 1].distanceKm));
    assert.ok(!list.some((s) => s.id === "far"));
  });
  it("boxAround covers the radius and snaps outward to 0.1°", () => {
    const b = boxAround(28.61, 77.21, 15);
    assert.ok(b.south <= 28.61 - 15 / 111 && b.north >= 28.61 + 15 / 111);
    assert.equal(Math.round(b.south * 10), b.south * 10);
  });
});

describe("beyond-index display in the gauge and charts", () => {
  it("gauge pointer pins at the end above the scale and never returns NaN", () => {
    const cats = gaugeCategories("us");
    assert.equal(cats.length, 6); // "Beyond index" is not a gauge band
    assert.equal(gaugeFraction(500, cats, SCALE_MAX.us), 1);
    assert.equal(gaugeFraction(650, cats, SCALE_MAX.us), 1);
    assert.ok(gaugeFraction(499, cats, SCALE_MAX.us) < 1);
    assert.equal(gaugeFraction(Number.NaN, cats, SCALE_MAX.us), 0);
    assert.equal(gaugeFraction(0, cats, SCALE_MAX.us), 0);
    assert.equal(gaugeFraction(650, gaugeCategories("in"), SCALE_MAX.in), 1);
  });
  it("chart y-axis auto-extends past 500 instead of clipping", () => {
    assert.equal(niceYMax(450, "us"), 500);
    assert.equal(niceYMax(650, "us"), 750);
    assert.equal(niceYMax(650, "in"), 750);
    assert.equal(niceYMax(Number.NaN, "us"), 100);
    assert.equal(niceYMax(10, "eu"), 40);
  });
});
