import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  bestWorst,
  buildInsights,
  dailyStats,
  extremeHour,
  hourOfDayProfile,
  periodChange,
  toLocalHours,
  weekdayHourMatrix,
  type LocalHour,
  type RawHour,
} from "../history-stats.ts";
import { addDays, datesEnding, localParts, weekdayOf } from "../time.ts";

/** Hourly UTC instants starting at `startIso`. */
function hourly(startIso: string, n: number, value: (i: number) => number | null): RawHour[] {
  const t0 = Date.parse(startIso);
  return Array.from({ length: n }, (_, i) => ({ time: new Date(t0 + i * 3600_000).toISOString(), value: value(i) }));
}

describe("local time", () => {
  it("maps UTC to Asia/Kolkata (+05:30) across the date line", () => {
    assert.deepEqual(localParts("2026-11-09T18:30:00Z", "Asia/Kolkata"), { date: "2026-11-10", hour: 0, weekday: 1 });
    assert.deepEqual(localParts("2026-11-09T18:00:00Z", "Asia/Kolkata"), { date: "2026-11-09", hour: 23, weekday: 0 });
  });

  it("follows DST: two UTC hours map to 01:xx local on London's fall-back day", () => {
    const a = localParts("2026-10-25T00:30:00Z", "Europe/London"); // 01:30 BST
    const b = localParts("2026-10-25T01:30:00Z", "Europe/London"); // 01:30 GMT
    assert.equal(a.date, "2026-10-25");
    assert.equal(a.hour, 1);
    assert.equal(b.hour, 1);
    assert.equal(localParts("2026-07-01T12:00:00Z", "Europe/London").hour, 13);
  });

  it("weekday and date helpers", () => {
    assert.equal(weekdayOf("2026-11-10"), 1); // Tuesday
    assert.equal(weekdayOf("2026-11-15"), 6); // Sunday
    assert.equal(addDays("2026-02-28", 1), "2026-03-01");
    assert.deepEqual(datesEnding("2026-11-10", 3), ["2026-11-08", "2026-11-09", "2026-11-10"]);
  });
});

describe("daily bucketing in a non-UTC time zone", () => {
  it("groups by the city's local day, not the UTC day", () => {
    // 48 hours from local midnight Nov 10 in Kolkata (= 18:30Z Nov 9).
    const raw = hourly("2026-11-09T18:30:00Z", 48, (i) => (i < 24 ? 10 : 30));
    const days = dailyStats(toLocalHours(raw, "Asia/Kolkata"));
    assert.deepEqual(
      days.map((d) => [d.date, d.mean, d.validHours]),
      [
        ["2026-11-10", 10, 24],
        ["2026-11-11", 30, 24],
      ],
    );
    // Bucketing the same data by UTC day would have produced three days.
    const utcDays = new Set(raw.map((r) => r.time.slice(0, 10)));
    assert.equal(utcDays.size, 3);
  });

  it("reports mean, max and hours covered, ignoring nulls", () => {
    const raw = hourly("2026-11-09T18:30:00Z", 24, (i) => (i % 4 === 0 ? null : i));
    const [d] = dailyStats(toLocalHours(raw, "Asia/Kolkata"));
    assert.equal(d.validHours, 18);
    assert.equal(d.totalHours, 24);
    assert.equal(d.max, 23);
    const expected = Array.from({ length: 24 }, (_, i) => i).filter((i) => i % 4 !== 0);
    assert.equal(d.mean, expected.reduce((a, b) => a + b, 0) / expected.length);
    assert.equal(d.partial, false);
  });

  it("picks the dominant pollutant from the day's mean sub-indices", () => {
    const hours: LocalHour[] = Array.from({ length: 20 }, (_, i) => ({
      date: "2026-11-10",
      hour: i,
      weekday: 1,
      value: 100,
      subs: { pm2_5: 90, ozone: i < 5 ? 150 : 40 },
    }));
    assert.equal(dailyStats(hours)[0].dominant, "pm2_5");
  });
});

describe("partial days and best/worst", () => {
  const day = (date: string, valid: number, v: number): LocalHour[] =>
    Array.from({ length: 24 }, (_, h) => ({ date, hour: h, weekday: weekdayOf(date), value: h < valid ? v : null }));

  it("flags days with fewer than 18 valid hours", () => {
    const days = dailyStats([...day("2026-11-01", 17, 50), ...day("2026-11-02", 18, 60)]);
    assert.equal(days[0].partial, true);
    assert.equal(days[1].partial, false);
  });

  it("excludes partial days from best/worst when full days exist", () => {
    const days = dailyStats([...day("2026-11-01", 5, 5), ...day("2026-11-02", 24, 40), ...day("2026-11-03", 24, 90), ...day("2026-11-04", 3, 300)]);
    const bw = bestWorst(days);
    assert.equal(bw.best?.date, "2026-11-02");
    assert.equal(bw.worst?.date, "2026-11-03");
    assert.equal(bw.fromPartial, false);
  });

  it("falls back to partial days when nothing else qualifies", () => {
    const bw = bestWorst(dailyStats([...day("2026-11-01", 5, 5), ...day("2026-11-02", 6, 20)]));
    assert.equal(bw.best?.date, "2026-11-01");
    assert.equal(bw.fromPartial, true);
  });

  it("returns nulls with no data", () => {
    assert.deepEqual(bestWorst(dailyStats(day("2026-11-01", 0, 1))), { best: null, worst: null, fromPartial: false });
  });
});

describe("period-over-period change", () => {
  const series = (end: string, n: number, v: (dayIdx: number) => number | null): LocalHour[] =>
    datesEnding(end, n).flatMap((date, di) =>
      Array.from({ length: 24 }, (_, h) => ({ date, hour: h, weekday: weekdayOf(date), value: v(di) })),
    );

  it("compares the last N days with the N days before", () => {
    const hours = series("2026-11-14", 14, (d) => (d < 7 ? 100 : 80));
    const c = periodChange(hours, "2026-11-14", 7);
    assert.ok(c);
    assert.equal(c.current.mean, 80);
    assert.equal(c.previous.mean, 100);
    assert.equal(c.absChange, -20);
    assert.equal(c.pctChange, -20);
    assert.equal(c.previous.validHours, 168);
  });

  it("returns null when the previous period is under-covered", () => {
    const hours = series("2026-11-14", 14, (d) => (d < 3 ? 100 : d < 7 ? null : 80));
    assert.equal(periodChange(hours, "2026-11-14", 7), null);
  });

  it("returns null when there is no previous period at all", () => {
    assert.equal(periodChange(series("2026-11-14", 7, () => 50), "2026-11-14", 7), null);
  });
});

describe("hour-of-day profile", () => {
  const days = (n: number, f: (h: number) => number | null): LocalHour[] =>
    datesEnding("2026-11-10", n).flatMap((date) =>
      Array.from({ length: 24 }, (_, h) => ({ date, hour: h, weekday: weekdayOf(date), value: f(h) })),
    );

  it("averages each local hour and finds the peak and low", () => {
    const p = hourOfDayProfile(days(4, (h) => h * 2));
    assert.equal(p[5].mean, 10);
    assert.equal(p[5].n, 4);
    assert.equal(extremeHour(p, "peak")?.hour, 23);
    assert.equal(extremeHour(p, "low")?.hour, 0);
  });

  it("withholds hours with fewer than 3 samples", () => {
    const p = hourOfDayProfile(days(2, (h) => h));
    assert.equal(p.every((c) => c.mean === null), true);
    assert.equal(extremeHour(p, "peak"), null);
  });

  it("builds a weekday × hour matrix", () => {
    const m = weekdayHourMatrix(days(14, (h) => h));
    assert.equal(m.length, 7);
    assert.equal(m[0].length, 24);
    assert.equal(m[1][7].mean, 7);
    assert.equal(m[1][7].n, 2);
  });
});

describe("insights only state what the data supports", () => {
  const mk = (f: (h: number) => number) =>
    datesEnding("2026-11-10", 7).flatMap((date) =>
      Array.from({ length: 24 }, (_, h) => ({ date, hour: h, weekday: weekdayOf(date), value: f(h) })),
    );

  it("reports a clear peak hour", () => {
    const hours = mk((h) => (h === 21 ? 180 : 60));
    const lines = buildInsights({ scale: "us", rangeDays: 7, days: dailyStats(hours), profile: hourOfDayProfile(hours), change: null });
    assert.ok(lines.some((l) => l.includes("worst around 21:00")), lines.join("\n"));
  });

  it("says nothing about a peak when the profile is flat", () => {
    const hours = mk(() => 60);
    const lines = buildInsights({ scale: "us", rangeDays: 7, days: dailyStats(hours), profile: hourOfDayProfile(hours), change: null });
    assert.equal(lines.some((l) => l.includes("worst around")), false);
    assert.ok(lines.some((l) => l.includes("No full day averaged “Unhealthy”")));
  });
});
