import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { euPm25Index, pm25Index } from "../aqi.ts";
import {
  backtest,
  fit,
  forecastFrom,
  metrics,
  persistenceForecast,
  quantile,
  residualIntervals,
  runTrendModel,
  seasonalNaiveForecast,
} from "../forecast-model.ts";
import { agreement, cleanestWindows, dailyRanges, pm25SeriesToIndex } from "../forecast-insights.ts";

/* Synthetic series are used ONLY in tests. */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rand: () => number) {
  const u = Math.max(1e-12, rand());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
const pattern = (h: number) => 40 + 25 * Math.sin((2 * Math.PI * (h - 6)) / 24);

function synthetic(days: number, seed: number, noise = 2) {
  const rand = mulberry32(seed);
  const n = days * 24;
  const hours = Array.from({ length: n }, (_, i) => i % 24);
  let ar = 0;
  const values = hours.map((h) => {
    ar = 0.6 * ar + noise * gaussian(rand);
    return Math.max(0, pattern(h) + ar);
  });
  return { values, hours };
}

describe("model recovers a seasonal pattern", () => {
  it("forecasts the next 24 h close to the true daily cycle", () => {
    const { values, hours } = synthetic(21, 7);
    const f = fit(values, hours);
    assert.ok(f);
    const future = Array.from({ length: 24 }, (_, k) => (hours[hours.length - 1] + 1 + k) % 24);
    const pred = forecastFrom(f.state, f.params, future);
    const truth = future.map(pattern);
    const mae = pred.reduce((s, p, i) => s + Math.abs(p - truth[i]), 0) / 24;
    const mp = pred.reduce((a, b) => a + b, 0) / 24;
    const mt = truth.reduce((a, b) => a + b, 0) / 24;
    const cov = pred.reduce((s, p, i) => s + (p - mp) * (truth[i] - mt), 0);
    const corr = cov / Math.sqrt(pred.reduce((s, p) => s + (p - mp) ** 2, 0) * truth.reduce((s, t) => s + (t - mt) ** 2, 0));
    assert.ok(mae < 5, `MAE ${mae.toFixed(2)}`);
    assert.ok(corr > 0.95, `corr ${corr.toFixed(3)}`);
  });

  it("beats persistence on a strongly seasonal series", () => {
    const { values, hours } = synthetic(21, 11);
    const bt = backtest(values, hours, 48);
    assert.ok(bt);
    assert.ok(bt.model.mae < bt.persistence.mae, `model ${bt.model.mae} vs persistence ${bt.persistence.mae}`);
  });
});

describe("backtest split has no leakage", () => {
  it("predictions do not change when the held-out hours change", () => {
    const { values, hours } = synthetic(14, 3);
    const altered = values.slice();
    for (let i = values.length - 48; i < values.length; i++) altered[i] = 10_000;
    const a = backtest(values, hours, 48);
    const b = backtest(altered, hours, 48);
    assert.ok(a && b);
    assert.deepEqual(a.predictions.model, b.predictions.model);
    assert.deepEqual(a.predictions.persistence, b.predictions.persistence);
    assert.deepEqual(a.predictions.seasonalNaive, b.predictions.seasonalNaive);
    assert.equal(a.trainHours, values.length - 48);
  });

  it("baselines only read training indices", () => {
    const train = [1, 2, 3, null, 5];
    assert.deepEqual(persistenceForecast(train, 3), [5, 5, 5]);
    const t48 = Array.from({ length: 48 }, (_, i) => i);
    const sn = seasonalNaiveForecast(t48, 48);
    assert.equal(sn[0], 24); // h=1 → index 24 (same hour yesterday)
    assert.equal(sn[23], 47); // h=24 → last training hour
    assert.equal(sn[24], 24); // h=25 → index 24 again (the most recent day)
    assert.equal(sn[47], 47);
    assert.ok(sn.every((v) => v !== null && v < 48));
  });

  it("interval origins never use data after themselves", () => {
    const { values, hours } = synthetic(20, 5);
    const a = residualIntervals(values, hours);
    assert.ok(a && a.every((b) => b.n > 0));
  });
});

describe("prediction intervals", () => {
  it("cover roughly 80% of future values on synthetic data", () => {
    let inside = 0;
    let total = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { values, hours } = synthetic(26, seed, 4);
      const trainN = values.length - 48;
      const res = runTrendModel(values.slice(0, trainN), hours.slice(0, trainN), hours.slice(trainN));
      assert.equal(res.status, "ok");
      if (res.status !== "ok") continue;
      res.forecast.forEach((p, i) => {
        const truth = values[trainN + i];
        total++;
        if (truth >= p.lo && truth <= p.hi) inside++;
      });
    }
    const coverage = inside / total;
    assert.ok(coverage > 0.65 && coverage < 0.95, `coverage ${(coverage * 100).toFixed(1)}%`);
  });

  it("quantile interpolates", () => {
    assert.equal(quantile([0, 10], 0.5), 5);
    assert.equal(quantile([1, 2, 3, 4, 5], 0.1), 1.4);
  });
});

describe("insufficient data", () => {
  it("refuses with under 7 days of valid data", () => {
    const { values, hours } = synthetic(6, 1);
    const r = runTrendModel(values, hours, [0, 1]);
    assert.equal(r.status, "insufficient");
  });
  it("refuses when too many hours are missing", () => {
    const { values, hours } = synthetic(20, 1);
    const holey = values.map((v, i) => (i % 3 === 0 ? null : v));
    const r = runTrendModel(holey, hours, [0, 1]);
    assert.equal(r.status, "insufficient");
  });
});

describe("metrics", () => {
  it("MAE and RMSE skip missing and masked hours", () => {
    const m = metrics([1, 2, null, 4], [2, 2, 5, 8], [true, true, true, false]);
    assert.equal(m.n, 2);
    assert.equal(m.mae, 0.5);
    assert.ok(Math.abs(m.rmse - Math.SQRT1_2) < 1e-12);
  });
});

describe("European PM2.5 index (matches Open-Meteo samples)", () => {
  it("uses hourly EEA 2024 bands", () => {
    assert.equal(euPm25Index(2.5), 10);
    assert.equal(euPm25Index(7.3), 25);
    assert.equal(euPm25Index(20.9), 43);
    assert.equal(euPm25Index(140), 100);
    assert.equal(euPm25Index(205.8), 126);
    assert.equal(euPm25Index(-1), null);
  });
});

describe("forecast helpers", () => {
  const t0 = Date.parse("2026-11-10T00:00:00Z");
  const pts = (vals: (number | null)[]) => vals.map((value, i) => ({ time: new Date(t0 + i * 3600_000).toISOString(), value }));

  it("cleanest windows skip gaps and do not overlap", () => {
    // Index 3 is missing: windows 1–3, 2–4 and 3–5 must never be chosen,
    // even though 10,10 around the gap would be the cleanest hours.
    const vals = [50, 10, 10, null, 10, 10, 60, 20, 20, 20, 70, 30, 30, 30];
    const w = cleanestWindows(pts(vals), 48, 3, 3);
    const starts = w.map((x) => (Date.parse(x.start) - t0) / 3600_000);
    // Means: 7–9 → 20, 0–2 → 23.3, 4–6 → 26.7 (starts right after the gap).
    assert.deepEqual(starts, [0, 4, 7]);
    assert.ok(starts.every((s) => s + 2 < 3 || s > 3), "no window spans the gap");
    for (let i = 1; i < starts.length; i++) assert.ok(starts[i] >= starts[i - 1] + 3, "non-overlapping");
  });

  it("daily ranges use the local day", () => {
    const r = dailyRanges(pts([1, 2, 3]), "Asia/Kolkata");
    assert.deepEqual(r, [{ date: "2026-11-10", min: 1, mean: 2, max: 3, n: 3 }]);
  });

  it("agreement reports mean absolute difference", () => {
    const a = agreement([10, 20, null], [14, 16, 5]);
    assert.ok(a);
    assert.equal(a.mad, 4);
    assert.equal(a.n, 2);
    assert.equal(a.verdict, "close");
  });

  it("converts PM2.5 to US AQI with a trailing 24 h mean", () => {
    const tail = Array.from({ length: 23 }, () => 20);
    const idx = pm25SeriesToIndex(tail, [20, 20], "us");
    assert.deepEqual(idx, [pm25Index(20), pm25Index(20)]);
    assert.deepEqual(pm25SeriesToIndex([], [7.3], "eu"), [25]);
  });
});
