import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { cityShareUrl, parseRange, parseSharedPrefs } from "../share.ts";

describe("share links", () => {
  const s = { slug: "delhi-28.61_77.21", tab: "weather", range: "30", scale: "eu", profile: "athlete", source: "auto" } as const;
  it("writes every view parameter explicitly", () => {
    const u = new URL(cityShareUrl("https://airiq.example/", s));
    assert.equal(u.pathname, "/city/delhi-28.61_77.21");
    assert.equal(u.searchParams.get("tab"), "weather");
    assert.equal(u.searchParams.get("range"), "30");
    assert.equal(u.searchParams.get("scale"), "eu");
    assert.equal(u.searchParams.get("profile"), "athlete");
  });
  it("defaults are written too (the link must not depend on the recipient's settings)", () => {
    const u = new URL(cityShareUrl("http://localhost:3000", { ...s, tab: "overview", range: "7", scale: "us", profile: "general" }));
    assert.equal(u.search, "?tab=overview&range=7&scale=us&profile=general&source=auto");
  });
  it("report links keep range, scale and profile", () => {
    const u = new URL(cityShareUrl("http://x", s, "report"));
    assert.equal(u.pathname, "/city/delhi-28.61_77.21/report");
    assert.equal(u.searchParams.get("tab"), null);
    assert.equal(u.searchParams.get("profile"), "athlete");
  });
  it("round-trips through the parser and rejects invalid values", () => {
    const u = new URL(cityShareUrl("http://x", s));
    assert.deepEqual(parseSharedPrefs(u.searchParams), { scale: "eu", profile: "athlete", source: "auto" });
    assert.deepEqual(parseSharedPrefs(new URLSearchParams("scale=uk&profile=robot&source=satellite")), { scale: null, profile: null, source: null });
    assert.equal(parseRange("90"), "90");
    assert.equal(parseRange("14"), "7");
    assert.equal(parseRange(null, "30"), "30");
  });
  it("accepts India NAQI and the data-source modes", () => {
    assert.deepEqual(parseSharedPrefs(new URLSearchParams("scale=in&source=model")), { scale: "in", profile: null, source: "model" });
    assert.deepEqual(parseSharedPrefs(new URLSearchParams("source=station")).source, "station");
    const u = new URL(cityShareUrl("http://x", { ...s, scale: "in", source: "station" }));
    assert.equal(u.searchParams.get("scale"), "in");
    assert.equal(u.searchParams.get("source"), "station");
  });
});
