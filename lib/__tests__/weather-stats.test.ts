import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  CAUSATION_NOTE,
  NO_RELATIONSHIP,
  alignHours,
  correlations,
  dailyPairs,
  linearFit,
  rainComparison,
  ranks,
  sectorOf,
  spearman,
  strengthOf,
  weatherInsights,
  windRose,
  type AlignedHour,
  type Correlation,
  type DailyPair,
  type WeatherHour,
} from "../weather-stats.ts";

const close = (a: number | undefined, b: number, eps = 1e-12) => assert.ok(a !== undefined && Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe("spearman", () => {
  it("matches published values", () => {
    // scipy.stats.spearmanr documentation example (includes a tie in y).
    close(spearman([1, 2, 3, 4, 5], [5, 6, 7, 8, 7]), 0.8207826816681233);
    // Wikipedia "Spearman's rank correlation coefficient" IQ vs TV hours: ρ = −29/165.
    close(
      spearman([106, 100, 86, 101, 99, 103, 97, 113, 112, 110], [7, 27, 2, 50, 28, 29, 20, 12, 6, 17]),
      -29 / 165,
    );
  });
  it("is ±1 for any monotone relationship", () => {
    close(spearman([1, 2, 3, 4], [1, 4, 9, 16]), 1);
    close(spearman([1, 2, 3, 4], [100, 10, 1, 0.1]), -1);
  });
  it("gives tied values their average rank", () => {
    assert.deepEqual(ranks([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
    assert.deepEqual(ranks([5, 5, 5]), [2, 2, 2]);
    close(spearman([1, 1, 2, 2], [1, 1, 2, 2]), 1);
  });
  it("returns undefined (never NaN) for a constant series, < 3 pairs or bad input", () => {
    assert.equal(spearman([3, 3, 3, 3], [1, 2, 3, 4]), undefined);
    assert.equal(spearman([1, 2, 3, 4], [7, 7, 7, 7]), undefined);
    assert.equal(spearman([1, 2], [2, 1]), undefined);
    assert.equal(spearman([1, 2, 3], [1, 2]), undefined);
    assert.equal(spearman([1, 2, Number.NaN], [1, 2, 3]), undefined);
  });
  it("labels strength with the 0.2 / 0.5 cutoffs", () => {
    assert.equal(strengthOf(0.19), "weak");
    assert.equal(strengthOf(-0.2), "moderate");
    assert.equal(strengthOf(0.5), "moderate");
    assert.equal(strengthOf(-0.51), "strong");
  });
  it("fits a least-squares trend line", () => {
    const f = linearFit([0, 1, 2, 3], [1, 3, 5, 7]);
    assert.ok(f);
    close(f.slope, 2);
    close(f.intercept, 1);
    assert.equal(linearFit([2, 2, 2], [1, 2, 3]), undefined);
  });
});

describe("wind sector binning", () => {
  it("uses 16 sectors of 22.5° centred on north", () => {
    assert.equal(sectorOf(0), 0);
    assert.equal(sectorOf(11.24), 0);
    assert.equal(sectorOf(11.25), 1);
    assert.equal(sectorOf(22.5), 1);
    assert.equal(sectorOf(180), 8);
    assert.equal(sectorOf(348.74), 15);
    assert.equal(sectorOf(348.75), 0);
    assert.equal(sectorOf(360), 0);
    assert.equal(sectorOf(-10), 0);
    assert.equal(sectorOf(725), 0);
  });
  it("averages PM2.5 per sector, skips calm hours and flags low counts", () => {
    const h = (dir: number, speed: number, pm25: number): AlignedHour => ({ ...wx("2026-01-01T00:00:00Z"), windDirection: dir, windSpeed: speed, pm25, date: "2026-01-01" });
    const hours = [...Array.from({ length: 6 }, (_, i) => h(90, 10, 10 + i)), h(270, 10, 50), h(0, 0.5, 999)];
    const rose = windRose(hours);
    assert.equal(rose.hours, 7);
    assert.equal(rose.calmHours, 1);
    const east = rose.sectors[4];
    assert.equal(east.name, "E");
    assert.equal(east.hours, 6);
    close(east.meanPm25 ?? undefined, 12.5);
    assert.equal(east.lowCount, false);
    assert.equal(rose.sectors[12].lowCount, true);
    assert.equal(rose.sectors[0].meanPm25, null);
  });
});

function wx(time: string, over: Partial<WeatherHour> = {}): WeatherHour {
  return { time, temperature: 20, humidity: 50, windSpeed: 5, windDirection: 90, pressure: 1010, precipitation: 0, boundaryLayerHeight: 500, ...over };
}

describe("alignment and daily pairs", () => {
  it("joins on identical hours and counts what was dropped", () => {
    const pm = [
      { time: "2026-01-01T00:00:00Z", pm25: 10 },
      { time: "2026-01-01T01:00:00.000Z", pm25: 20 },
      { time: "2026-01-01T02:00:00Z", pm25: null },
      { time: "2026-01-01T03:00:00Z", pm25: 30 },
    ];
    const w = [wx("2026-01-01T00:00:00.000Z"), wx("2026-01-01T01:00:00Z"), wx("2026-01-01T02:00:00Z")];
    const a = alignHours(pm, w, "UTC");
    assert.equal(a.hours.length, 2);
    assert.equal(a.droppedNoWeather, 1);
    assert.equal(a.droppedNoPm, 1);
  });
  it("groups by local day, sums precipitation, averages others, drops short days", () => {
    const hours: AlignedHour[] = [];
    for (let i = 0; i < 24; i++) hours.push({ ...wx(""), precipitation: 0.5, temperature: i, pm25: 10, date: "2026-01-01" });
    for (let i = 0; i < 17; i++) hours.push({ ...wx(""), pm25: 99, date: "2026-01-02" });
    const p = dailyPairs(hours, "precipitation");
    assert.equal(p.length, 1);
    close(p[0].value, 12);
    close(dailyPairs(hours, "temperature")[0].value, 11.5);
    assert.equal(p[0].hours, 24);
  });
  it("uses the city's local day, not the UTC day", () => {
    const a = alignHours([{ time: "2026-01-01T20:00:00Z", pm25: 5 }], [wx("2026-01-01T20:00:00Z")], "Asia/Kolkata");
    assert.equal(a.hours[0].date, "2026-01-02");
  });
});

describe("dry vs rain days", () => {
  const day = (value: number, pm25: number): DailyPair => ({ date: "x", value, pm25, hours: 24 });
  it("splits at 0.1 mm and averages each group", () => {
    const r = rainComparison([day(0, 40), day(0.09, 50), day(0, 60), day(0.1, 20), day(5, 10), day(1, 30)]);
    assert.ok(r);
    assert.equal(r.dry.days, 3);
    assert.equal(r.wet.days, 3);
    close(r.dry.meanPm25, 50);
    close(r.wet.meanPm25, 20);
  });
  it("is null unless each group has at least 3 days", () => {
    assert.equal(rainComparison([day(0, 1), day(0, 2), day(0, 3), day(1, 4), day(1, 5)]), null);
  });
});

describe("insights", () => {
  const c = (variable: Correlation["variable"], r: number | undefined, days: number): Correlation => ({
    variable,
    r,
    strength: r === undefined ? undefined : strengthOf(r),
    days,
    hours: days * 24,
  });
  it("lists qualifying relationships strongest first, then the causation note", () => {
    const lines = weatherInsights([c("humidity", 0.3, 20), c("windSpeed", -0.7, 20), c("temperature", 0.9, 13), c("pressure", 0.1, 60)]);
    assert.equal(lines.length, 3);
    assert.match(lines[0], /higher wind speed tended to have lower PM2\.5 \(strong, Spearman r = −0\.70, 20 days\)/);
    assert.match(lines[1], /humidity.*higher PM2\.5 \(moderate/);
    assert.equal(lines.at(-1), CAUSATION_NOTE);
  });
  it("says no clear relationship when nothing meets the cutoffs", () => {
    assert.deepEqual(weatherInsights([c("humidity", 0.19, 60), c("windSpeed", -0.9, 10), c("pressure", undefined, 60)]), [NO_RELATIONSHIP]);
  });
  it("correlations() reports n days per variable and undefined for constant series", () => {
    const hours: AlignedHour[] = [];
    for (let d = 1; d <= 5; d++)
      for (let i = 0; i < 24; i++) hours.push({ ...wx(""), windSpeed: d, pm25: 50 - d, precipitation: 0, date: `2026-01-0${d}` });
    const cs = correlations(hours);
    const wind = cs.find((x) => x.variable === "windSpeed");
    assert.equal(wind?.days, 5);
    close(wind?.r, -1);
    assert.equal(cs.find((x) => x.variable === "precipitation")?.r, undefined);
  });
});
