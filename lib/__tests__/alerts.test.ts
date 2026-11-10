import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EventsStorageSchema,
  INITIAL_STATE,
  RulesStorageSchema,
  RuleStatesStorageSchema,
  evaluateRule,
  forecastExceedance,
  formatSpan,
  inQuietHours,
  metricValue,
  type AlertRule,
  type ReadingSource,
  type RuleState,
} from "../alerts.ts";

const HOUR = 3600_000;
const NOW = Date.parse("2026-11-10T06:30:00Z"); // 12:00 in Delhi

function rule(over: Partial<AlertRule> = {}): AlertRule {
  return {
    id: "r1",
    city: { name: "Delhi", latitude: 28.65, longitude: 77.23, timezone: "Asia/Kolkata", slug: "delhi-28.652-77.231" },
    metric: "aqi",
    scale: "us",
    threshold: 150,
    trigger: { type: "current" },
    quietHours: null,
    enabled: true,
    createdAt: "2026-11-10T00:00:00Z",
    ...over,
  };
}
const reading = (usAqi: number | null, euAqi: number | null = null, extra: Partial<ReadingSource> = {}): ReadingSource => ({
  time: new Date(NOW).toISOString(),
  usAqi,
  euAqi,
  ...extra,
});

describe("scale handling", () => {
  it("reads the value on the rule's own scale", () => {
    const src = reading(180, 70, { usSubIndices: { pm2_5: 180, ozone: 20 }, euSubIndices: { pm2_5: 95 } });
    assert.equal(metricValue(src, "aqi", "us"), 180);
    assert.equal(metricValue(src, "aqi", "eu"), 70);
    assert.equal(metricValue(src, "pm2_5", "eu"), 95);
    assert.equal(metricValue(src, "nitrogen_dioxide", "us"), null);
  });

  it("an EU threshold is compared with the European AQI, not the US AQI", () => {
    const eu = rule({ scale: "eu", threshold: 60 });
    // US 180 would exceed 60, but EU 55 does not.
    assert.equal(evaluateRule(eu, reading(180, 55), null, NOW).events.length, 0);
    assert.equal(evaluateRule(eu, reading(40, 65), null, NOW).events.length, 1);
  });
});

describe("current-reading rules: hysteresis and dedupe", () => {
  it("fires once per episode and re-arms below 90% of the threshold", () => {
    const r = rule();
    let s: RuleState = INITIAL_STATE;
    let out = evaluateRule(r, reading(182), null, NOW, s);
    assert.equal(out.events.length, 1);
    assert.match(out.events[0].message, /US AQI is 182 in Delhi, above your threshold of 150 \(current reading, 12:00 local time\)/);
    s = out.state;
    assert.equal(s.active, true);

    // Still above: no duplicate.
    out = evaluateRule(r, reading(190), null, NOW + HOUR, s);
    assert.equal(out.events.length, 0);
    s = out.state;
    // Dips just below the threshold (≥ 90%): still the same episode.
    out = evaluateRule(r, reading(140), null, NOW + 2 * HOUR, s);
    assert.equal(out.events.length, 0);
    assert.equal(out.state.active, true);
    s = out.state;
    // Back above: still no duplicate.
    assert.equal(evaluateRule(r, reading(160), null, NOW + 3 * HOUR, s).events.length, 0);
    // Below 90% (135): re-armed.
    out = evaluateRule(r, reading(130), null, NOW + 4 * HOUR, s);
    assert.equal(out.state.active, false);
    // Exceeds again: fires a new event.
    out = evaluateRule(r, reading(170), null, NOW + 5 * HOUR, out.state);
    assert.equal(out.events.length, 1);
  });

  it("does nothing without data or when disabled", () => {
    assert.equal(evaluateRule(rule(), reading(null), null, NOW).events.length, 0);
    assert.equal(evaluateRule(rule({ enabled: false }), reading(400), null, NOW).events.length, 0);
  });
});

describe("forecast rules", () => {
  // Hourly forecast starting at the next hour; 14:00–18:00 local (08:30–12:30Z) above 150.
  const forecast: ReadingSource[] = Array.from({ length: 48 }, (_, i) => {
    const t = NOW + (i + 1) * HOUR;
    const localHour = (12 + i + 1) % 24;
    return { time: new Date(t).toISOString(), usAqi: i < 24 && localHour >= 14 && localHour < 18 ? 170 + i : 120, euAqi: 50 };
  });

  it("finds the first exceeding span within the window", () => {
    const { span } = forecastExceedance(forecast, rule(), NOW, 24);
    assert.ok(span);
    assert.equal(formatSpan(span.start, span.end, "Asia/Kolkata"), "Tue 14:00–18:00");
    assert.equal(span.max, 174);
    // A 1-hour window ends before 14:00 → nothing.
    assert.equal(forecastExceedance(forecast, rule(), NOW, 1).span, null);
  });

  it("fires once with the local span and re-arms when the forecast clears", () => {
    const r = rule({ trigger: { type: "forecast", hours: 24 } });
    let out = evaluateRule(r, null, forecast, NOW);
    assert.equal(out.events.length, 1);
    assert.equal(out.events[0].message, "Forecast: US AQI above 150 in Delhi on Tue 14:00–18:00 local time (official forecast).");
    assert.equal(out.events[0].kind, "forecast");
    // Re-run: no duplicate.
    out = evaluateRule(r, null, forecast, NOW + 10 * 60_000, out.state);
    assert.equal(out.events.length, 0);
    // Forecast improves: re-arm, then a new exceedance fires again.
    const clean = forecast.map((p) => ({ ...p, usAqi: 100 }));
    out = evaluateRule(r, null, clean, NOW + HOUR, out.state);
    assert.equal(out.state.active, false);
    assert.equal(evaluateRule(r, null, forecast, NOW + HOUR, out.state).events.length, 1);
  });

  it("formats spans that cross midnight", () => {
    const start = Date.parse("2026-11-10T16:30:00Z"); // 22:00 Tue
    assert.equal(formatSpan(start, start + 4 * HOUR, "Asia/Kolkata"), "Tue 22:00–Wed 02:00");
  });
});

describe("quiet hours", () => {
  it("handle ranges that cross midnight", () => {
    const q = { start: 22, end: 7 };
    assert.equal(inQuietHours(23, q), true);
    assert.equal(inQuietHours(3, q), true);
    assert.equal(inQuietHours(7, q), false);
    assert.equal(inQuietHours(12, q), false);
    assert.equal(inQuietHours(10, { start: 9, end: 17 }), true);
    assert.equal(inQuietHours(17, { start: 9, end: 17 }), false);
    assert.equal(inQuietHours(5, { start: 5, end: 5 }), false);
    assert.equal(inQuietHours(5, null), false);
  });

  it("log the event as suppressed (local time of the city, not UTC)", () => {
    // NOW is 12:00 in Delhi but 06:30 UTC.
    const quiet = rule({ quietHours: { start: 11, end: 13 } });
    const out = evaluateRule(quiet, reading(200), null, NOW);
    assert.equal(out.events.length, 1);
    assert.equal(out.events[0].suppressed, true);
    const notQuiet = rule({ quietHours: { start: 6, end: 7 } }); // 06:00–07:00 UTC-ish would be wrong
    assert.equal(evaluateRule(notQuiet, reading(200), null, NOW).events[0].suppressed, false);
  });
});

describe("stored data validation", () => {
  it("keeps valid rules and drops malformed ones", () => {
    const good = rule();
    const parsed = RulesStorageSchema.safeParse([good, { id: 5 }, null, { ...good, id: "r2", threshold: -3 }, { ...good, id: "r3" }]);
    assert.ok(parsed.success);
    assert.deepEqual(
      parsed.data.map((r) => r.id),
      ["r1", "r3"],
    );
  });

  it("rejects non-arrays and filters bad rule states and events", () => {
    assert.equal(RulesStorageSchema.safeParse({ not: "an array" }).success, false);
    const states = RuleStatesStorageSchema.parse({ a: INITIAL_STATE, b: { active: "yes" } });
    assert.deepEqual(Object.keys(states), ["a"]);
    assert.deepEqual(EventsStorageSchema.parse([{ id: 1 }]), []);
  });
});
