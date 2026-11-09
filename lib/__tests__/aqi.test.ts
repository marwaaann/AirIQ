import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CO_8H,
  NO2_1H,
  O3_1H,
  SO2_1H,
  cigarettesEquivalent,
  coIndex,
  computeUsAqi,
  computeUsAqiAt,
  computeUsAqiInstant,
  indexFromTable,
  ozoneIndex,
  pm10Index,
  pm25Index,
  trailingMean,
  truncate,
  ugm3ToPpb,
  ugm3ToPpm,
} from "../aqi.ts";
import { getEuCategory, getUsCategory } from "../aqi-categories.ts";

/** ppb/ppm → µg/m³ helpers for building inputs (25 °C). */
const ppbToUg = (mw: number, ppb: number) => (ppb * mw) / 24.45;

describe("truncate", () => {
  it("truncates instead of rounding", () => {
    assert.equal(truncate(35.49, 1), 35.4);
    assert.equal(truncate(54.9, 0), 54);
    assert.equal(truncate(0.0709, 3), 0.07);
  });
  it("is stable against float artefacts", () => {
    assert.equal(truncate(35.4, 1), 35.4);
    assert.equal(truncate(0.07, 3), 0.07);
  });
});

describe("unit conversions", () => {
  it("converts NO2 µg/m³ → ppb at 25 °C", () => {
    assert.ok(Math.abs(ugm3ToPpb("nitrogen_dioxide", 188.16) - 100) < 0.01);
  });
  it("converts O3 µg/m³ → ppm", () => {
    assert.ok(Math.abs(ugm3ToPpm("ozone", 137.42) - 0.07) < 0.0001);
  });
  it("converts CO µg/m³ → ppm", () => {
    assert.ok(Math.abs(ugm3ToPpm("carbon_monoxide", 1145.6) - 1.0) < 0.001);
  });
});

describe("PM2.5 (2024 breakpoints)", () => {
  it("hits band edges exactly", () => {
    assert.equal(pm25Index(0), 0);
    assert.equal(pm25Index(9.0), 50);
    assert.equal(pm25Index(9.1), 51);
    assert.equal(pm25Index(35.4), 100);
    assert.equal(pm25Index(35.5), 101);
    assert.equal(pm25Index(55.4), 150);
    assert.equal(pm25Index(55.5), 151);
    assert.equal(pm25Index(125.4), 200);
    assert.equal(pm25Index(225.4), 300);
    assert.equal(pm25Index(325.4), 500);
  });
  it("interpolates inside a band", () => {
    // (100-51)/(35.4-9.1) * (20-9.1) + 51 = 71.3
    assert.equal(pm25Index(20), 71);
  });
  it("truncates before lookup (9.05 → 9.0 → Good)", () => {
    assert.equal(pm25Index(9.05), 50);
  });
  it("caps at 500 above the table", () => {
    assert.equal(pm25Index(900), 500);
  });
  it("rejects invalid input", () => {
    assert.equal(pm25Index(-1), null);
    assert.equal(pm25Index(Number.NaN), null);
  });
});

describe("PM2.5 (2012 breakpoints)", () => {
  it("uses the 12.0 Good ceiling", () => {
    assert.equal(pm25Index(12.0, "2012"), 50);
    assert.equal(pm25Index(12.1, "2012"), 51);
    assert.equal(pm25Index(150.4, "2012"), 200);
    assert.equal(pm25Index(9.0, "2012"), 38);
  });
});

describe("PM10", () => {
  it("hits band edges", () => {
    assert.equal(pm10Index(54), 50);
    assert.equal(pm10Index(55), 51);
    assert.equal(pm10Index(154), 100);
    assert.equal(pm10Index(254.9), 150);
    assert.equal(pm10Index(604), 500);
  });
});

describe("gas tables (in native units)", () => {
  it("NO2 1-h ppb", () => {
    assert.equal(indexFromTable(53, NO2_1H), 50);
    assert.equal(indexFromTable(100, NO2_1H), 100);
    assert.equal(indexFromTable(360, NO2_1H), 150);
    assert.equal(indexFromTable(2049, NO2_1H), 500);
  });
  it("SO2 1-h ppb", () => {
    assert.equal(indexFromTable(35, SO2_1H), 50);
    assert.equal(indexFromTable(75, SO2_1H), 100);
    assert.equal(indexFromTable(185, SO2_1H), 150);
  });
  it("CO 8-h ppm", () => {
    assert.equal(indexFromTable(4.4, CO_8H), 50);
    assert.equal(indexFromTable(9.4, CO_8H), 100);
    assert.equal(indexFromTable(15.4, CO_8H), 200);
  });
  it("O3 1-h ppm", () => {
    assert.equal(indexFromTable(0.125, O3_1H), 101);
    assert.equal(indexFromTable(0.204, O3_1H), 200);
  });
});

describe("gas indices from µg/m³", () => {
  it("CO: 1150 µg/m³ ≈ 1.004 ppm → 1.0 → 11", () => {
    assert.equal(coIndex(1150), 11);
    // 1145.6 µg/m³ is 0.99997 ppm, which truncates to 0.9 ppm
    assert.equal(coIndex(1145.6), 10);
  });
  it("O3 8-h: 100 µg/m³ ≈ 0.050 ppm → 46", () => {
    assert.equal(ozoneIndex(100), 46);
  });
  it("O3 uses 1-h table when 1-h is high", () => {
    const oneHour = ppbToUg(48, 180); // 0.180 ppm → 151..200 band
    const eightHour = ppbToUg(48, 60); // 0.060 ppm → moderate
    const i = ozoneIndex(eightHour, oneHour);
    assert.ok(i !== null && i > 150 && i <= 200, `got ${i}`);
  });
  it("O3 low 1-h value does not contribute", () => {
    assert.equal(ozoneIndex(100, 100), 46);
  });
});

describe("computeUsAqi", () => {
  it("returns the max sub-index and the dominant pollutant", () => {
    const r = computeUsAqi({ pm2_5: 40, pm10: 50, nitrogen_dioxide: 20, ozone8h: 60 });
    assert.equal(r.dominant, "pm2_5");
    assert.equal(r.aqi, r.subIndices.pm2_5);
    assert.ok((r.subIndices.pm10 ?? 0) < (r.aqi ?? 0));
  });
  it("handles all-null input", () => {
    const r = computeUsAqi({ pm2_5: null, pm10: null });
    assert.equal(r.aqi, null);
    assert.equal(r.dominant, null);
  });
  it("instant variant accepts raw readings", () => {
    const r = computeUsAqiInstant({ pm2_5: 153.2, pm10: 176, ozone: 13, nitrogen_dioxide: 92.5 });
    assert.equal(r.dominant, "pm2_5");
    assert.equal(r.aqi, pm25Index(153.2));
  });
});

describe("trailingMean / computeUsAqiAt", () => {
  it("requires 75% coverage", () => {
    const v: (number | null)[] = [1, 2, null, null];
    assert.equal(trailingMean(v, 3, 4), null);
    assert.equal(trailingMean([1, 2, 3, null], 3, 4), 2);
  });
  it("uses a 24-h mean for PM2.5", () => {
    const n = 30;
    const pm = Array.from({ length: n }, (_, i) => (i < 6 ? 500 : 20));
    const empty = Array.from({ length: n }, () => null);
    const r = computeUsAqiAt(
      { pm2_5: pm, pm10: empty, ozone: empty, carbon_monoxide: empty, nitrogen_dioxide: empty, sulphur_dioxide: empty },
      n - 1,
    );
    // last 24 values are all 20 → index of 20
    assert.equal(r.aqi, pm25Index(20));
  });
});

describe("categories", () => {
  it("maps US AQI to EPA categories", () => {
    assert.equal(getUsCategory(0).key, "good");
    assert.equal(getUsCategory(50).key, "good");
    assert.equal(getUsCategory(51).key, "moderate");
    assert.equal(getUsCategory(150).key, "usg");
    assert.equal(getUsCategory(151).key, "unhealthy");
    assert.equal(getUsCategory(300).key, "very-unhealthy");
    assert.equal(getUsCategory(301).key, "hazardous");
    assert.equal(getUsCategory(999).key, "hazardous");
    assert.equal(getUsCategory(50.4).key, "good");
  });
  it("maps European AQI bands", () => {
    assert.equal(getEuCategory(20).key, "good");
    assert.equal(getEuCategory(20.5).key, "fair");
    assert.equal(getEuCategory(60).key, "moderate");
    assert.equal(getEuCategory(101).key, "extremely-poor");
  });
});

describe("cigarettes equivalent", () => {
  it("uses 22 µg/m³ per cigarette", () => {
    assert.equal(cigarettesEquivalent(44), 2);
    assert.equal(cigarettesEquivalent(0), 0);
    assert.equal(cigarettesEquivalent(-5), 0);
  });
});
