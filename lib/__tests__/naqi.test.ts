import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { beyondIndexLabel, describeIndex, formatIndex, getInCategory, isBeyondIndex } from "../aqi-categories.ts";
import { pm25SeriesToIndex } from "../forecast-insights.ts";
import {
  NAQI_AVERAGING,
  NAQI_MIN_HOURS,
  NAQI_POLLUTANTS,
  NAQI_TABLE,
  naqiAt,
  naqiFromAverages,
  naqiSubIndex,
  windowMean,
  type NaqiHourly,
} from "../naqi.ts";
import { naqiFromSensorHours, toUgm3 } from "../station-naqi.ts";

const flat = (v: number | null, n = 24) => Array.from({ length: n }, () => v);

describe("NAQI sub-index: CPCB worked example (About_AQI.pdf)", () => {
  it("PM2.5 31 → 51, 45 → 75, 60 → 100", () => {
    assert.equal(naqiSubIndex("pm2_5", 31), 51);
    assert.equal(naqiSubIndex("pm2_5", 45), 75);
    assert.equal(naqiSubIndex("pm2_5", 60), 100);
  });
});

describe("NAQI sub-index: every breakpoint edge from CPCB's table", () => {
  // As printed (Good … Very poor); Severe starts at the open-ended value.
  const printed: Record<string, [number, number][]> = {
    pm10: [[0, 50], [51, 100], [101, 250], [251, 350], [351, 430]],
    pm2_5: [[0, 30], [31, 60], [61, 90], [91, 120], [121, 250]],
    nitrogen_dioxide: [[0, 40], [41, 80], [81, 180], [181, 280], [281, 400]],
    ozone: [[0, 50], [51, 100], [101, 168], [169, 208], [209, 748]],
    carbon_monoxide: [[0, 1.0], [1.1, 2.0], [2.1, 10], [10, 17], [17, 34]],
    sulphur_dioxide: [[0, 40], [41, 80], [81, 380], [381, 800], [801, 1600]],
    ammonia: [[0, 200], [201, 400], [401, 800], [801, 1200], [1200, 1800]],
  };
  const idx = [[0, 50], [51, 100], [101, 200], [201, 300], [301, 400]];
  for (const p of NAQI_POLLUTANTS) {
    it(`${p}: low and high edge of each band map to the band's index range`, () => {
      printed[p].forEach(([lo, hi], k) => {
        // Overlapping printed edges (CO 10, NH3 1200) belong to the lower band.
        const loExpected = k > 0 && printed[p][k - 1][1] === lo ? idx[k - 1][1] : idx[k][0];
        assert.equal(naqiSubIndex(p, lo), loExpected, `${p} ${lo}`);
        assert.equal(naqiSubIndex(p, hi), idx[k][1], `${p} ${hi}`);
      });
    });
  }
  it("Severe continues the Very-poor slope: PM2.5 251–380 and PM10 431–510 span 401–500", () => {
    assert.equal(naqiSubIndex("pm2_5", 251), 401);
    assert.equal(naqiSubIndex("pm2_5", 380), 500);
    assert.equal(naqiSubIndex("pm10", 431), 401);
    assert.equal(naqiSubIndex("pm10", 510), 500);
    assert.deepEqual(NAQI_TABLE.pm2_5[5], { cLow: 251, cHigh: 380, iLow: 401, iHigh: 500 });
  });
  it("concentrations in the gaps between printed ranges take the next band's floor", () => {
    assert.equal(naqiSubIndex("pm2_5", 30.5), 51);
    assert.equal(naqiSubIndex("pm10", 50.4), 51);
  });
  it("rejects negative and non-finite input", () => {
    assert.equal(naqiSubIndex("pm2_5", -1), null);
    assert.equal(naqiSubIndex("pm2_5", Number.NaN), null);
  });
});

describe("NAQI beyond the index", () => {
  it("keeps the computed value above 500 and flags it", () => {
    const v = naqiSubIndex("pm2_5", 450) as number;
    assert.ok(v > 500, String(v));
    assert.equal(v, Math.round(401 + (99 / 129) * (450 - 251)));
    assert.equal(isBeyondIndex(v, "in"), true);
    assert.equal(formatIndex(v, "in"), "500+");
    assert.equal(getInCategory(v).key, "severe");
    assert.match(beyondIndexLabel(v, "in"), /^Severe, beyond index \(computed \d+\)$/);
    assert.match(describeIndex(v, "in"), /India NAQI 500\+/);
  });
  it("499, 500, 501, 650 on each scale", () => {
    for (const scale of ["us", "in"] as const) {
      assert.equal(formatIndex(499, scale), "499");
      assert.equal(formatIndex(500, scale), "500");
      assert.equal(formatIndex(501, scale), "500+");
      assert.equal(formatIndex(650, scale), "500+");
      assert.equal(isBeyondIndex(500, scale), false);
      assert.equal(isBeyondIndex(501, scale), true);
    }
    assert.equal(formatIndex(100, "eu"), "100");
    assert.equal(formatIndex(137, "eu"), "100+");
    assert.equal(formatIndex(null, "us"), "n/a");
    assert.equal(formatIndex(Number.NaN, "us"), "n/a");
  });
  it("NAQI categories at their edges", () => {
    assert.equal(getInCategory(50).key, "good");
    assert.equal(getInCategory(51).key, "satisfactory");
    assert.equal(getInCategory(200).key, "moderately-polluted");
    assert.equal(getInCategory(201).key, "poor");
    assert.equal(getInCategory(400).key, "very-poor");
    assert.equal(getInCategory(401).key, "severe");
    assert.equal(getInCategory(999).key, "severe");
  });
});

describe("NAQI averaging periods and minimum-data rules", () => {
  it("averaging: 24 h for PM, NO2, SO2, NH3; 8 h for CO and O3", () => {
    assert.deepEqual(NAQI_AVERAGING, { pm10: 24, pm2_5: 24, nitrogen_dioxide: 24, sulphur_dioxide: 24, ammonia: 24, carbon_monoxide: 8, ozone: 8 });
    assert.deepEqual(NAQI_MIN_HOURS, { 24: 16, 8: 6 });
  });
  it("a 24-hour mean needs at least 16 hours; an 8-hour mean at least 6", () => {
    const sixteen = [...flat(null, 8), ...flat(40, 16)];
    const fifteen = [...flat(null, 9), ...flat(40, 15)];
    assert.deepEqual(windowMean(sixteen, 23, 24), { mean: 40, n: 16 });
    assert.equal(windowMean(fifteen, 23, 24), null);
    assert.deepEqual(windowMean([...flat(null, 2), ...flat(10, 6)], 7, 8), { mean: 10, n: 6 });
    assert.equal(windowMean([...flat(null, 3), ...flat(10, 5)], 7, 8), null);
  });
  it("uses the trailing window ending at the hour (older hours are ignored)", () => {
    // 24 h of 200 followed by 24 h of 40: at the last hour only the 40s count.
    const pm = [...flat(200, 24), ...flat(40, 24)];
    const r = naqiAt({ pm2_5: pm, nitrogen_dioxide: flat(30, 48), sulphur_dioxide: flat(10, 48) }, 47);
    assert.equal(r.averages.pm2_5?.value, 40);
    assert.equal(r.subIndices.pm2_5, naqiSubIndex("pm2_5", 40));
  });
  it("8-hour means for O3 and CO; CO is converted from µg/m³ to mg/m³", () => {
    const h: NaqiHourly = {
      pm2_5: flat(20),
      ozone: [...flat(10, 16), ...flat(150, 8)],
      carbon_monoxide: [...flat(100, 16), ...flat(2000, 8)],
    };
    const r = naqiAt(h, 23);
    assert.equal(r.averages.ozone?.value, 150);
    assert.equal(r.averages.ozone?.window, 8);
    assert.equal(r.averages.carbon_monoxide?.value, 2.0);
    assert.equal(r.subIndices.carbon_monoxide, 100);
  });
  it("overall NAQI needs three pollutants including PM2.5 or PM10", () => {
    const two = naqiAt({ pm2_5: flat(45), nitrogen_dioxide: flat(30) }, 23);
    assert.equal(two.status, "insufficient");
    assert.equal(two.aqi, null);
    assert.match(two.reason ?? "", /at least 3 pollutants \(found 2\)/);
    const noPm = naqiAt({ nitrogen_dioxide: flat(30), sulphur_dioxide: flat(10), ozone: flat(20) }, 23);
    assert.equal(noPm.status, "insufficient");
    assert.match(noPm.reason ?? "", /PM2\.5 or PM10/);
    const ok = naqiAt({ pm2_5: flat(45), nitrogen_dioxide: flat(30), sulphur_dioxide: flat(10) }, 23);
    assert.equal(ok.status, "ok");
    assert.equal(ok.aqi, 75);
    assert.equal(ok.dominant, "pm2_5");
  });
  it("PM with too few hours does not count towards the three pollutants", () => {
    const pm = [...flat(null, 10), ...flat(45, 14)];
    const r = naqiAt({ pm2_5: pm, nitrogen_dioxide: flat(30), sulphur_dioxide: flat(10), ozone: flat(20) }, 23);
    assert.equal(r.status, "insufficient");
    assert.equal(r.subIndices.pm2_5, undefined);
  });
  it("the dominant pollutant is the highest sub-index", () => {
    const r = naqiFromAverages({
      pm2_5: { value: 45, hours: 24, window: 24 },
      pm10: { value: 300, hours: 24, window: 24 },
      nitrogen_dioxide: { value: 30, hours: 24, window: 24 },
    });
    assert.equal(r.dominant, "pm10");
    assert.equal(r.aqi, naqiSubIndex("pm10", 300));
  });
  it("the forecast model's NAQI uses the PM2.5 24-hour mean of observed + predicted hours", () => {
    const observed = flat(45, 23);
    const out = pm25SeriesToIndex(observed, [45, 45], "in");
    assert.deepEqual(out, [75, 75]);
    // Without enough hours (no observed tail), the first predictions have no NAQI.
    assert.equal(pm25SeriesToIndex([], [45], "in")[0], null);
  });
});

describe("station-based NAQI (OpenAQ concentrations)", () => {
  const t = (h: number) => new Date(Date.UTC(2026, 10, 14, h)).toISOString();
  it("converts units: µg/m³ as is, mg/m³ ×1000, ppb/ppm by molecular weight at 25 °C", () => {
    assert.equal(toUgm3("pm2_5", "µg/m³", 45), 45);
    assert.equal(toUgm3("carbon_monoxide", "mg/m³", 2), 2000);
    assert.ok(Math.abs((toUgm3("nitrogen_dioxide", "ppb", 24.45) as number) - 46.0055) < 1e-6);
    assert.ok(Math.abs((toUgm3("ozone", "ppm", 0.05) as number) - (0.05 * 48 * 1000) / 24.45) < 1e-6);
    assert.equal(toUgm3("pm2_5", "ppb", 10), null);
    assert.equal(toUgm3("pm2_5", "furlongs", 10), null);
  });
  it("aligns sensors on the station's latest hour and applies CPCB's rules", () => {
    const sensors = [
      { parameter: "pm25", units: "µg/m³", hours: Array.from({ length: 24 }, (_, i) => ({ time: t(i), value: 45 })) },
      { parameter: "no2", units: "µg/m³", hours: Array.from({ length: 24 }, (_, i) => ({ time: t(i), value: 30 })) },
      { parameter: "so2", units: "ppb", hours: Array.from({ length: 24 }, (_, i) => ({ time: t(i), value: 3 })) },
      { parameter: "temperature", units: "c", hours: [{ time: t(5), value: 21 }] },
    ];
    const r = naqiFromSensorHours(sensors);
    assert.equal(r.observedAt, t(23));
    assert.equal(r.result.status, "ok");
    assert.equal(r.result.aqi, 75);
  });
  it("is insufficient with fewer than 16 PM hours, and empty input never throws", () => {
    const pm = { parameter: "pm25", units: "µg/m³", hours: Array.from({ length: 10 }, (_, i) => ({ time: t(i + 14), value: 45 })) };
    const gas = (p: string) => ({ parameter: p, units: "µg/m³", hours: Array.from({ length: 24 }, (_, i) => ({ time: t(i), value: 20 })) });
    assert.equal(naqiFromSensorHours([pm, gas("no2"), gas("so2")]).result.status, "insufficient");
    assert.equal(naqiFromSensorHours([]).result.status, "insufficient");
    assert.equal(naqiFromSensorHours([]).observedAt, null);
  });
});
