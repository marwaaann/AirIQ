import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { healthAdvice, type AdviceInput } from "../health-advice.ts";
import { HEALTH_RULES } from "../health-rules.ts";
import { PROFILE_IDS, PROFILES, isSensitiveFor } from "../profiles.ts";
import { findSafeWindows, windowLabel, type ForecastHour } from "../safe-windows.ts";

const US_LEVELS = [25, 75, 125, 175, 250, 400];
const EU_LEVELS = [10, 30, 50, 70, 90, 110];
const DOMINANTS = ["pm2_5", "pm10", "ozone", "nitrogen_dioxide", "carbon_monoxide", "sulphur_dioxide", null] as const;

const input = (over: Partial<AdviceInput>): AdviceInput => ({
  aqi: 75,
  scale: "us",
  dominant: "pm2_5",
  pollutants: { pm2_5: 20 },
  profile: "general",
  localHour: 9,
  ...over,
});
const ids = (r: ReturnType<typeof healthAdvice>) =>
  [r.headline, ...r.activity.flatMap((g) => g.items), ...r.indoor, ...r.protection, ...r.info].map((x) => x.id);

describe("rules table", () => {
  it("every rule has a unique id, text and basis", () => {
    const seen = new Set<string>();
    for (const r of HEALTH_RULES) {
      assert.ok(r.text.length > 0 && r.basis.length > 0, r.id);
      assert.ok(!seen.has(r.id), `duplicate ${r.id}`);
      seen.add(r.id);
    }
  });

  it("every category × profile × main pollutant gives a complete, sourced result", () => {
    for (const scale of ["us", "eu"] as const) {
      for (const aqi of scale === "us" ? US_LEVELS : EU_LEVELS) {
        for (const profile of PROFILE_IDS) {
          for (const dominant of DOMINANTS) {
            const r = healthAdvice(input({ aqi, scale, profile, dominant }));
            const tag = `${scale} ${aqi} ${profile} ${dominant}`;
            assert.ok(r.headline.text && r.headline.basis, tag);
            const kinds = r.activity.map((g) => g.kind);
            assert.ok(kinds.includes("walking") && kinds.includes("exercise") && kinds.includes("commuting"), tag);
            assert.ok(r.indoor.length > 0 && r.protection.length > 0, tag);
            for (const rec of [r.headline, ...r.activity.flatMap((g) => g.items), ...r.indoor, ...r.protection, ...r.info]) {
              assert.ok(rec.basis.length > 0, `${tag} ${rec.id}`);
              assert.ok(HEALTH_RULES.some((h) => h.id === rec.id), `${rec.id} must come from the table`);
            }
            assert.ok(r.top.length >= 1 && r.top.length <= 3, tag);
            assert.ok(r.why.length > 0, tag);
          }
        }
      }
    }
  });
});

describe("profiles and sensitivity", () => {
  it("follows the pollutant-specific sensitive groups", () => {
    assert.equal(isSensitiveFor(PROFILES.athlete, "ozone"), true);
    assert.equal(isSensitiveFor(PROFILES.athlete, "pm2_5"), false);
    assert.equal(isSensitiveFor(PROFILES.pregnancy, "pm2_5"), true);
    assert.equal(isSensitiveFor(PROFILES.pregnancy, "ozone"), false);
    assert.equal(isSensitiveFor(PROFILES.general, "pm2_5"), false);
    assert.equal(PROFILES.respiratory.tightenAt.us, 101);
  });

  it("tightens guidance for a sensitive profile at USG", () => {
    const general = healthAdvice(input({ aqi: 125, profile: "general" }));
    const asthma = healthAdvice(input({ aqi: 125, profile: "respiratory" }));
    assert.equal(general.sensitive, false);
    assert.equal(asthma.sensitive, true);
    assert.notEqual(general.headline.text, asthma.headline.text);
    assert.ok(ids(asthma).includes("asthma-plan"));
    assert.ok(!ids(general).includes("asthma-plan"));
  });

  it("only shows children's play for the children profile", () => {
    assert.ok(healthAdvice(input({ profile: "children" })).activity.some((g) => g.kind === "children"));
    assert.ok(!healthAdvice(input({ profile: "general" })).activity.some((g) => g.kind === "children"));
  });
});

describe("pollutant-specific branches", () => {
  it("particles: purifier, indoor sources and a fit-tested respirator at Unhealthy", () => {
    const r = healthAdvice(input({ aqi: 175, dominant: "pm2_5", pollutants: { pm2_5: 90 } }));
    const all = ids(r);
    for (const id of ["windows-closed", "purifier-particles", "indoor-sources", "mask-particles-general", "commute-particles", "who-pm25"]) {
      assert.ok(all.includes(id), id);
    }
    const mask = r.protection.find((p) => p.id === "mask-particles-general");
    assert.match(mask!.text, /fits well/);
    assert.match(r.info[0].text, /6\.0× the WHO/);
  });

  it("ozone: no respirator advice, afternoon timing, gas note", () => {
    const afternoon = healthAdvice(input({ aqi: 125, dominant: "ozone", profile: "athlete", localHour: 15 }));
    const all = ids(afternoon);
    assert.ok(!all.some((i) => i.startsWith("mask-particles")));
    assert.ok(all.includes("mask-gases"));
    assert.ok(all.includes("ozone-timing"));
    assert.ok(all.includes("ozone-now-peak"));
    assert.ok(all.includes("purifier-gases"));
    const morning = healthAdvice(input({ aqi: 125, dominant: "ozone", profile: "athlete", localHour: 8 }));
    assert.ok(!ids(morning).includes("ozone-now-peak"));
  });

  it("NO2 and CO: avoid busy roads", () => {
    for (const dominant of ["nitrogen_dioxide", "carbon_monoxide"] as const) {
      const r = healthAdvice(input({ aqi: 75, dominant }));
      assert.ok(ids(r).includes("commute-traffic"), dominant);
    }
  });

  it("clean air: open windows and no equipment", () => {
    const r = healthAdvice(input({ aqi: 25 }));
    assert.ok(ids(r).includes("windows-open"));
    assert.deepEqual(
      r.protection.map((p) => p.id),
      ["protection-none"],
    );
  });

  it("EU scale uses EEA guidance", () => {
    const r = healthAdvice(input({ scale: "eu", aqi: 70, profile: "respiratory" }));
    assert.match(r.headline.basis, /EEA/);
    assert.match(r.headline.text, /Poor air quality for you/);
  });
});

/* ------------------------------------------------------------------------- */

const HOUR = 3600_000;
/** Hourly points for Kolkata (+05:30): local hours start at hh:30 UTC. */
function kolkataHours(startUtc: string, values: (number | null)[]): ForecastHour[] {
  const t0 = Date.parse(startUtc);
  return values.map((value, i) => ({ time: new Date(t0 + i * HOUR).toISOString(), value }));
}

describe("safe outdoor windows", () => {
  // Local Kolkata midnight of 2026-11-10 is 2026-11-09T18:30Z. "now" = local 05:10.
  const now = Date.parse("2026-11-09T23:40:00Z");
  const start = "2026-11-09T23:30:00Z"; // local 05:00

  it("finds threshold windows with local labels in a non-UTC zone", () => {
    // local 05..: 120,120 | 06–08 clean (≤100) | 09.. dirty
    const vals = [120, 90, 80, 85, ...Array.from({ length: 30 }, () => 160)];
    const r = findSafeWindows({ points: kolkataHours(start, vals), threshold: 100, timeZone: "Asia/Kolkata", activity: "walk", minHours: 2, now });
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.equal(r.windows.length, 1);
    assert.equal(r.windows[0].label, "Today 06:00–09:00");
    assert.deepEqual([r.windows[0].min, r.windows[0].max, r.windows[0].hours], [80, 90, 3]);
  });

  it("handles windows that cross local midnight", () => {
    // From local 05:00, hours 17..21 are dirty-clean... build so 22:00–02:00 is clean.
    const vals = Array.from({ length: 30 }, (_, i) => {
      const localHour = (5 + i) % 24;
      return localHour >= 22 || localHour < 2 ? 40 : 150;
    });
    const r = findSafeWindows({ points: kolkataHours(start, vals), threshold: 100, timeZone: "Asia/Kolkata", activity: "walk", minHours: 3, now });
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.equal(r.windows[0].label, "Today 22:00–02:00 (next day)");
    assert.equal(r.windows[0].hours, 4);
  });

  it("reports no window and lists the least-bad hours instead", () => {
    const vals = Array.from({ length: 48 }, (_, i) => 160 + (i % 5));
    const r = findSafeWindows({ points: kolkataHours(start, vals), threshold: 100, timeZone: "Asia/Kolkata", activity: "exercise", minHours: 2, now });
    assert.equal(r.status, "none");
    if (r.status !== "none") return;
    assert.ok(r.leastBad.length > 0 && r.leastBad.length <= 3);
    assert.equal(r.leastBad[0].min, 160);
  });

  it("respects the minimum length and never bridges gaps", () => {
    const vals = [50, 50, null, 50, 50, 200];
    const r = findSafeWindows({ points: kolkataHours(start, vals), threshold: 100, timeZone: "Asia/Kolkata", activity: "walk", minHours: 3, now });
    assert.equal(r.status, "none");
  });

  it("daylight-only drops mostly-dark windows for exercise only", () => {
    // Clean 01:00–04:00 local (dark) and 12:00–14:00 local (light).
    const vals = Array.from({ length: 30 }, (_, i) => {
      const h = (5 + i) % 24;
      return (h >= 1 && h < 4) || (h >= 12 && h < 14) ? 30 : 150;
    });
    const sun = [{ sunrise: "2026-11-10T01:15:00Z", sunset: "2026-11-10T12:00:00Z" }]; // 06:45–17:30 local
    const opts = { points: kolkataHours(start, vals), threshold: 100, timeZone: "Asia/Kolkata", minHours: 2 as const, now, sun };
    const all = findSafeWindows({ ...opts, activity: "exercise" });
    const lit = findSafeWindows({ ...opts, activity: "exercise", daylightOnly: true });
    const walk = findSafeWindows({ ...opts, activity: "walk", daylightOnly: true });
    assert.equal(all.status === "ok" && all.windows.length, 2);
    assert.equal(lit.status === "ok" && lit.windows.length, 1);
    assert.equal(lit.status === "ok" && lit.windows[0].label, "Today 12:00–14:00");
    assert.equal(walk.status === "ok" && walk.windows.length, 2);
  });

  it("open-windows mode picks the cleanest hours regardless of threshold", () => {
    const vals = Array.from({ length: 48 }, (_, i) => 200 - (i === 10 || i === 11 ? 60 : 0));
    const r = findSafeWindows({ points: kolkataHours(start, vals), threshold: 100, timeZone: "Asia/Kolkata", activity: "windows", minHours: 2, now });
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.equal(r.mode, "lowest");
    // Results are in time order; the cleanest pair (hours 10–11) must be among them.
    assert.ok(r.windows.some((w) => w.min === 140 && w.max === 140 && w.hours === 2));
  });

  it("names the end day when a window spans more than one midnight, and caps at 48 slots", () => {
    const vals = Array.from({ length: 60 }, () => 40);
    const r = findSafeWindows({ points: kolkataHours(start, vals), threshold: 100, timeZone: "Asia/Kolkata", activity: "walk", minHours: 1, now });
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.equal(r.windows[0].hours, 48);
    assert.equal(r.windows[0].label, "Today 05:00–Thu 05:00");
  });

  it("daylight-only splits a long clean run into its daylight hours", () => {
    const vals = Array.from({ length: 48 }, () => 40);
    const sun = [
      { sunrise: "2026-11-10T01:15:00Z", sunset: "2026-11-10T12:00:00Z" },
      { sunrise: "2026-11-11T01:15:00Z", sunset: "2026-11-11T12:00:00Z" },
    ];
    const r = findSafeWindows({ points: kolkataHours(start, vals), threshold: 100, timeZone: "Asia/Kolkata", activity: "exercise", minHours: 2, now, sun, daylightOnly: true });
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.deepEqual(
      r.windows.map((w) => w.label),
      ["Today 07:00–17:00", "Tomorrow 07:00–17:00"],
    );
    assert.ok(r.windows.every((w) => w.daylight === 1));
  });

  it("labels tomorrow and later days", () => {
    const tomorrow6 = Date.parse("2026-11-11T00:30:00Z"); // local Nov 11 06:00
    assert.equal(windowLabel(tomorrow6, tomorrow6 + 2 * HOUR, "Asia/Kolkata", now), "Tomorrow 06:00–08:00");
    const thu = Date.parse("2026-11-12T00:30:00Z");
    assert.equal(windowLabel(thu, thu + HOUR, "Asia/Kolkata", now), "Thu 06:00–07:00");
  });
});
