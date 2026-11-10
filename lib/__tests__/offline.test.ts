import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";

import { evaluateCityRules, INITIAL_STATE, type AlertRule, type ReadingSource } from "../alerts.ts";
import { apiFetch } from "../fetcher.ts";
import { chooseNotifyPath, fallbackAfter } from "../notify-path.ts";
import { FRESH, combineStale, parseStaleHeaders, staleBannerText, staleMetaOf } from "../stale.ts";

const h = (o: Record<string, string>) => new Headers(o);

describe("stale headers", () => {
  it("parses the service worker's stamp", () => {
    assert.deepEqual(parseStaleHeaders(h({ "X-AirIQ-Stale": "1", "X-AirIQ-Cached-At": "2026-11-10T08:50:00.000Z" })), {
      isStale: true,
      cachedAt: "2026-11-10T08:50:00.000Z",
    });
  });
  it("treats anything but exactly 1 as fresh, and keeps the flag when the time is unreadable", () => {
    assert.deepEqual(parseStaleHeaders(h({})), FRESH);
    assert.deepEqual(parseStaleHeaders(h({ "X-AirIQ-Stale": "0", "X-AirIQ-Cached-At": "2026-11-10T08:50:00Z" })), FRESH);
    assert.deepEqual(parseStaleHeaders(h({ "X-AirIQ-Cached-At": "2026-11-10T08:50:00Z" })), FRESH);
    assert.deepEqual(parseStaleHeaders(h({ "X-AirIQ-Stale": "1", "X-AirIQ-Cached-At": "yesterday" })), { isStale: true, cachedAt: null });
    assert.deepEqual(parseStaleHeaders(h({ "X-AirIQ-Stale": "1" })), { isStale: true, cachedAt: null });
  });
  it("reads _meta from a body and combines several sources (oldest time wins)", () => {
    assert.deepEqual(staleMetaOf(undefined), FRESH);
    assert.deepEqual(staleMetaOf({ a: 1 }), FRESH);
    assert.deepEqual(staleMetaOf({ _meta: { isStale: true, cachedAt: "2026-11-10T08:00:00.000Z" } }), { isStale: true, cachedAt: "2026-11-10T08:00:00.000Z" });
    const a = { isStale: true, cachedAt: "2026-11-10T09:00:00.000Z" };
    const b = { isStale: true, cachedAt: "2026-11-10T07:30:00.000Z" };
    assert.deepEqual(combineStale(FRESH, a, b), b);
    assert.deepEqual(combineStale(FRESH, FRESH), FRESH);
    assert.deepEqual(combineStale(a, { isStale: true, cachedAt: null }), { isStale: true, cachedAt: null });
  });
});

describe("apiFetch exposes isStale / cachedAt", () => {
  const original = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = original;
  });
  it("adds _meta from the response headers", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ value: 1 }), { status: 200, headers: { "content-type": "application/json", "X-AirIQ-Stale": "1", "X-AirIQ-Cached-At": "2026-11-10T08:50:00Z" } })) as typeof fetch;
    const body = await apiFetch<{ value: number }>("/api/air");
    assert.equal(body.value, 1);
    assert.deepEqual(body._meta, { isStale: true, cachedAt: "2026-11-10T08:50:00.000Z" });
  });
  it("marks a normal response fresh, so fresh and stale copies of identical data differ", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ value: 1 }), { status: 200 })) as typeof fetch;
    const body = await apiFetch<{ value: number }>("/api/air");
    assert.deepEqual(body._meta, FRESH);
  });
});

describe("stale banner text", () => {
  const cached = "2026-11-10T08:50:00.000Z"; // 14:20 in Delhi (+05:30), 03:50 in New York (−05:00)
  const now = Date.parse("2026-11-10T10:00:00Z");
  it("uses the city's time zone, not UTC or the viewer's", () => {
    assert.equal(staleBannerText(cached, "Asia/Kolkata", now), "Offline: showing data from 14:20, not live");
    assert.equal(staleBannerText(cached, "America/New_York", now), "Offline: showing data from 03:50, not live");
    assert.equal(staleBannerText(cached, "Asia/Kathmandu", now), "Offline: showing data from 14:35, not live");
  });
  it("adds the date when the copy is from another local day", () => {
    assert.equal(staleBannerText("2026-11-09T17:00:00.000Z", "Asia/Kolkata", now), "Offline: showing data from 9 Nov, 22:30, not live");
    // Same instant is already 10 Nov in Delhi at 19:00 UTC (00:30 local).
    assert.equal(staleBannerText("2026-11-09T19:00:00.000Z", "Asia/Kolkata", now), "Offline: showing data from 00:30, not live");
  });
  it("handles an online failure, a missing time and an invalid zone", () => {
    assert.equal(staleBannerText(cached, "Asia/Kolkata", now, false), "Live data unavailable: showing data from 14:20, not live");
    assert.equal(staleBannerText(null, "Asia/Kolkata", now), "Offline: showing saved data, not live");
    assert.equal(staleBannerText(cached, "Not/AZone", now), "Offline: showing data from 08:50 UTC, not live");
  });
});

describe("alert engine and stale data", () => {
  const NOW = Date.parse("2026-11-10T06:30:00Z");
  const rule: AlertRule = {
    id: "r1",
    city: { name: "Delhi", latitude: 28.65, longitude: 77.23, timezone: "Asia/Kolkata", slug: "delhi-28.652-77.231" },
    metric: "aqi",
    scale: "us",
    threshold: 150,
    trigger: { type: "current" },
    quietHours: null,
    enabled: true,
    createdAt: "2026-11-10T00:00:00Z",
  };
  const reading: ReadingSource = { time: new Date(NOW).toISOString(), usAqi: 220, euAqi: null };
  it("fires on fresh data", () => {
    const r = evaluateCityRules([rule], reading, null, NOW, {}, false);
    assert.equal(r.events.length, 1);
    assert.equal(r.skipped, null);
    assert.equal(r.states?.r1.active, true);
  });
  it("skips stale data: no events and nothing recorded", () => {
    const prev = { r1: INITIAL_STATE };
    const r = evaluateCityRules([rule], reading, null, NOW, prev, true);
    assert.deepEqual(r, { states: null, events: [], skipped: "stale" });
  });
  it("does not close an open episode on stale data either", () => {
    const open = { r1: { ...INITIAL_STATE, active: true, episodeStartedAt: "2026-11-10T05:00:00.000Z", lastValue: 200 } };
    const r = evaluateCityRules([rule], { ...reading, usAqi: 10 }, null, NOW, open, true);
    assert.equal(r.states, null);
  });
});

describe("notification path", () => {
  it("prefers the service worker, then the page constructor, then in-app", () => {
    assert.equal(chooseNotifyPath({ permission: "granted", hasActiveWorker: true, hasConstructor: true }), "service-worker");
    assert.equal(chooseNotifyPath({ permission: "granted", hasActiveWorker: false, hasConstructor: true }), "page");
    assert.equal(chooseNotifyPath({ permission: "granted", hasActiveWorker: false, hasConstructor: false }), "in-app");
    assert.equal(chooseNotifyPath({ permission: "default", hasActiveWorker: true, hasConstructor: true }), "in-app");
    assert.equal(chooseNotifyPath({ permission: "denied", hasActiveWorker: true, hasConstructor: true }), "in-app");
    assert.equal(fallbackAfter("service-worker", true), "page");
    assert.equal(fallbackAfter("service-worker", false), "in-app");
    assert.equal(fallbackAfter("page", true), "in-app");
  });
});
