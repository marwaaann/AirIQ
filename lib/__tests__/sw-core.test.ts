import { describe, it } from "node:test";
import assert from "node:assert/strict";

import core from "../../public/sw-core.js";

const O = "https://airiq.example";

describe("service worker: cache versioning", () => {
  it("takes the version from the worker URL and rejects odd values", () => {
    assert.equal(core.versionFromScriptUrl(`${O}/sw.js?v=mhb2k1x`), "mhb2k1x");
    assert.equal(core.versionFromScriptUrl(`${O}/sw.js`), "dev");
    assert.equal(core.versionFromScriptUrl(`${O}/sw.js?v=../../x`), "dev");
    assert.equal(core.versionFromScriptUrl("not a url"), "dev");
  });
  it("names caches per version and deletes only other AirIQ versions", () => {
    assert.deepEqual(core.cacheNames("v2"), { static: "airiq-static-v2", pages: "airiq-pages-v2", api: "airiq-api-v2" });
    const existing = ["airiq-static-v1", "airiq-api-v1", "airiq-pages-v1", "airiq-static-v2", "airiq-api-v2", "airiq-pages-v2", "someone-elses-cache"];
    assert.deepEqual(core.cachesToDelete(existing, "v2"), ["airiq-static-v1", "airiq-api-v1", "airiq-pages-v1"]);
    assert.deepEqual(core.cachesToDelete(existing, "v3").length, 6);
  });
});

describe("service worker: request classification", () => {
  const c = (url: string, extra: { method?: string; mode?: string; rsc?: boolean } = {}) =>
    core.classifyRequest({ method: extra.method ?? "GET", url: url.startsWith("http") ? url : `${O}${url}`, mode: extra.mode, rsc: extra.rsc }, O);
  it("caches the data routes, never the assistant", () => {
    for (const p of ["/api/air?lat=1&lon=2", "/api/history?days=7", "/api/forecast", "/api/weather", "/api/grid", "/api/stations", "/api/geocode?q=del"]) assert.equal(c(p), "api", p);
    assert.equal(c("/api/assistant"), "network-only");
    assert.equal(c("/api/assistant", { method: "POST" }), "network-only");
    assert.equal(c("/api/unknown"), "network-only");
  });
  it("handles static assets, navigations, RSC payloads, non-GET and cross-origin", () => {
    assert.equal(c("/_next/static/chunks/abc.js"), "static");
    assert.equal(c("/city/delhi-28.61-77.21?tab=weather", { mode: "navigate" }), "navigate");
    assert.equal(c("/city/delhi-28.61-77.21?_rsc=1x2"), "network-only");
    assert.equal(c("/compare", { rsc: true }), "network-only");
    assert.equal(c("/api/air", { method: "POST" }), "network-only");
    assert.equal(c("https://api.open-meteo.com/v1/forecast"), "network-only");
    assert.equal(c("/manifest.webmanifest"), "asset");
    assert.equal(c("/pwa-icon/maskable"), "asset");
  });
});

describe("service worker: network-first fallback decision", () => {
  it("uses the network for live answers, including 4xx", () => {
    assert.equal(core.apiDecision("ok", true), "network");
    assert.equal(core.apiDecision("client-error", true), "network");
  });
  it("falls back to the cached copy on failure, 5xx or timeout", () => {
    assert.equal(core.apiDecision("failed", true), "cache");
    assert.equal(core.apiDecision("server-error", true), "cache");
    assert.equal(core.apiDecision("timeout", true), "cache");
  });
  it("without a cached copy: waits after a timeout, otherwise passes the failure through", () => {
    assert.equal(core.apiDecision("timeout", false), "wait");
    assert.equal(core.apiDecision("failed", false), "network");
    assert.equal(core.apiDecision("server-error", false), "network");
  });
  it("maps status codes to outcomes", () => {
    assert.equal(core.outcomeOfStatus(200), "ok");
    assert.equal(core.outcomeOfStatus(204), "ok");
    assert.equal(core.outcomeOfStatus(400), "client-error");
    assert.equal(core.outcomeOfStatus(502), "server-error");
  });
  it("uses a short timeout", () => {
    assert.ok(core.API_TIMEOUT_MS >= 2000 && core.API_TIMEOUT_MS <= 8000);
  });
});

describe("service worker: header stamping", () => {
  it("records the fetch time on the stored copy and drops any old stamp", () => {
    const out = core.headersForCache(
      [
        ["content-type", "application/json"],
        ["X-AirIQ-Stale", "1"],
        ["x-airiq-cached-at", "old"],
      ],
      "2026-11-10T08:50:00.000Z",
    );
    assert.deepEqual(out, [
      ["content-type", "application/json"],
      ["x-airiq-cached-at", "2026-11-10T08:50:00.000Z"],
    ]);
  });
  it("marks a served fallback as stale and keeps its time", () => {
    const out = core.headersForStale([
      ["content-type", "application/json"],
      ["x-airiq-cached-at", "2026-11-10T08:50:00.000Z"],
    ]);
    const hdr = new Headers(out);
    assert.equal(hdr.get("X-AirIQ-Stale"), "1");
    assert.equal(hdr.get("X-AirIQ-Cached-At"), "2026-11-10T08:50:00.000Z");
    assert.equal(new Headers(core.headersForStale([["x-airiq-stale", "1"]])).get("x-airiq-stale"), "1");
  });
});

describe("service worker: helpers", () => {
  it("finds a page's static assets", () => {
    const html = `<script src="/_next/static/chunks/a1.js" async></script><link rel="stylesheet" href="/_next/static/css/b2.css"/><link rel="preload" href="/_next/static/media/f.woff2"/>"/_next/static/chunks/a1.js" <img src="https://x/_y.png">`;
    assert.deepEqual(core.extractAssetUrls(html), ["/_next/static/chunks/a1.js", "/_next/static/css/b2.css", "/_next/static/media/f.woff2"]);
  });
  it("lets only map data fall back to another URL", () => {
    assert.equal(core.apiFallbackPolicy(`${O}/api/grid?south=1`), "latest-same-path");
    assert.equal(core.apiFallbackPolicy(`${O}/api/stations?south=1`), "latest-same-path");
    assert.equal(core.apiFallbackPolicy(`${O}/api/air?lat=1&lon=2`), "exact");
    assert.equal(core.apiFallbackPolicy(`${O}/api/history?lat=1&lon=2&days=7`), "exact");
  });
  it("prunes the oldest API entries above the cap", () => {
    assert.equal(core.pruneCount(205, 200), 5);
    assert.equal(core.pruneCount(10, 200), 0);
  });
  it("keys pages by exact URL first, then path", () => {
    assert.equal(core.pageCacheKey(`${O}/city/delhi-28.61-77.21?tab=weather&range=30`), `${O}/city/delhi-28.61-77.21`);
    assert.deepEqual(core.pageCacheKeys(`${O}/city/delhi-28.61-77.21?tab=weather#x`), [`${O}/city/delhi-28.61-77.21?tab=weather`, `${O}/city/delhi-28.61-77.21`]);
    assert.deepEqual(core.pageCacheKeys(`${O}/compare`), [`${O}/compare`]);
  });
  it("only opens same-origin paths from a notification", () => {
    assert.equal(core.notificationTarget({ url: "/city/delhi-28.61-77.21" }, O), `${O}/city/delhi-28.61-77.21`);
    assert.equal(core.notificationTarget({ url: "https://evil.example/" }, O), `${O}/`);
    assert.equal(core.notificationTarget({ url: "//evil.example/x" }, O), `${O}/`);
    assert.equal(core.notificationTarget(null, O), `${O}/`);
  });
});
