import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MIN_VALID_HOURS, formatCigarettes, weekEquivalent, windowEquivalent, type PmHour } from "../cigarette-equivalent.ts";

const H = 3_600_000;
const END = Date.parse("2026-11-10T12:00:00Z");
/** `n` hourly values ending at END (inclusive), newest last. */
const hours = (n: number, value: number | ((i: number) => number | null), end = END): PmHour[] =>
  Array.from({ length: n }, (_, i) => ({
    time: new Date(end - (n - 1 - i) * H).toISOString(),
    pm25: typeof value === "function" ? value(i) : value,
  }));

describe("cigarette equivalent: 24 h window", () => {
  it("22 µg/m³ for 24 h ≈ 1 cigarette", () => {
    const r = windowEquivalent(hours(24, 22), END);
    assert.ok(r.ok);
    assert.equal(r.cigarettes, 1);
    assert.equal(r.validHours, 24);
  });
  it("uses the mean of the valid hours", () => {
    const r = windowEquivalent(hours(24, (i) => (i < 12 ? 11 : 33)), END);
    assert.ok(r.ok);
    assert.equal(r.meanPm25, 22);
  });
  it("needs at least 18 valid hours (boundary)", () => {
    assert.equal(MIN_VALID_HOURS, 18);
    const r18 = windowEquivalent(hours(24, (i) => (i < 6 ? null : 44)), END);
    assert.ok(r18.ok);
    assert.equal(r18.validHours, 18);
    assert.equal(r18.cigarettes, 2);
    const r17 = windowEquivalent(hours(24, (i) => (i < 7 ? null : 44)), END);
    assert.equal(r17.ok, false);
    assert.equal(r17.validHours, 17);
  });
  it("covers exactly the 24 hourly slots ending at the current hour", () => {
    // 25 hours: the oldest (END − 24 h) is outside the window.
    const pts = hours(25, (i) => (i === 0 ? 1000 : 22));
    const r = windowEquivalent(pts, END + 30 * 60_000);
    assert.ok(r.ok);
    assert.equal(r.validHours, 24);
    assert.equal(r.cigarettes, 1);
    // Future hours are ignored.
    const r2 = windowEquivalent([...hours(24, 22), { time: new Date(END + H).toISOString(), pm25: 999 }], END);
    assert.ok(r2.ok && r2.cigarettes === 1);
  });
  it("ignores duplicates, negatives and non-finite values", () => {
    const pts = [...hours(18, 22), ...hours(18, 500), { time: new Date(END).toISOString(), pm25: -1 }, { time: new Date(END - H).toISOString(), pm25: Number.NaN }];
    const r = windowEquivalent(pts, END);
    assert.ok(r.ok);
    assert.equal(r.validHours, 18);
    assert.equal(r.meanPm25, 22);
  });
  it("0 µg/m³ is 0 cigarettes", () => {
    const r = windowEquivalent(hours(24, 0), END);
    assert.ok(r.ok && r.cigarettes === 0);
  });
});

describe("cigarette equivalent: 7 days", () => {
  it("sums seven daily windows", () => {
    const r = weekEquivalent(hours(168, 22), END);
    assert.ok(r.ok);
    assert.equal(r.days.length, 7);
    assert.ok(Math.abs(r.cigarettes - 7) < 1e-9);
  });
  it("is not reported if any day has fewer than 18 valid hours", () => {
    // Oldest day has only 17 valid hours.
    const r = weekEquivalent(hours(168, (i) => (i < 7 ? null : 22)), END);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.missingDays === 1);
    // Exactly 18 in the oldest day is enough.
    assert.equal(weekEquivalent(hours(168, (i) => (i < 6 ? null : 22)), END).ok, true);
  });
});

describe("formatting", () => {
  it("rounds sensibly", () => {
    assert.equal(formatCigarettes(0), "0.0");
    assert.equal(formatCigarettes(0.04), "< 0.1");
    assert.equal(formatCigarettes(2.345), "2.3");
    assert.equal(formatCigarettes(12.6), "13");
  });
});

describe("non-whole-hour UTC offsets", () => {
  it("keeps the latest reading for a +05:45 city (points at :15 UTC)", () => {
    const end = Date.parse("2026-11-10T12:15:00Z");
    const pts = hours(24, 44, end);
    const r = windowEquivalent(pts, end);
    assert.ok(r.ok);
    assert.equal(r.validHours, 24);
    assert.equal(r.cigarettes, 2);
    assert.equal(r.end, "2026-11-10T12:15:00.000Z");
  });
});
