import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";

register(new URL("./support/alias-loader.mjs", import.meta.url).href);
const { DEFAULT_SITE_URL, envSummary, parseEnv } = await import("../env.ts");

const SECRET = "sk-test-SECRET-value-123";

describe("environment validation (lib/env.ts)", () => {
  it("runs with no variables at all: core data on, optional features off with a reason", () => {
    const r = parseEnv({});
    assert.deepEqual(r.warnings, []);
    assert.equal(r.env.siteUrl, DEFAULT_SITE_URL);
    const byId = Object.fromEntries(r.features.map((f) => [f.id, f]));
    assert.equal(byId["air-data"].enabled, true);
    assert.equal(byId.stations.enabled, false);
    assert.match(byId.stations.detail, /WAQI_TOKEN or OPENAQ_API_KEY/);
    assert.equal(byId.assistant.enabled, false);
    assert.match(byId.assistant.detail, /GEMINI_API_KEY/);
  });

  it("treats empty and whitespace-only values as unset", () => {
    const r = parseEnv({ WAQI_TOKEN: "", OPENAQ_API_KEY: "   ", GEMINI_API_KEY: "\t", SITE_URL: " " });
    assert.equal(r.env.waqiToken, undefined);
    assert.equal(r.env.openaqKey, undefined);
    assert.equal(r.env.geminiKey, undefined);
    assert.equal(r.env.siteUrl, DEFAULT_SITE_URL);
    assert.deepEqual(r.warnings, []);
  });

  it("enables features when keys are present, trimming whitespace", () => {
    const r = parseEnv({ WAQI_TOKEN: ` ${SECRET} `, OPENAQ_API_KEY: "x", GEMINI_API_KEY: SECRET });
    assert.equal(r.env.waqiToken, SECRET);
    const stations = r.features.find((f) => f.id === "stations")!;
    assert.equal(stations.enabled, true);
    assert.equal(stations.detail, "WAQI (OpenAQ as backup).");
    assert.equal(r.features.find((f) => f.id === "assistant")!.enabled, true);
  });

  it("drops invalid values with a warning instead of throwing", () => {
    const r = parseEnv({ SITE_URL: "not a url", GEMINI_BASE_URL: "ftp://x", GEMINI_MODEL: "bad model id!" });
    assert.equal(r.env.siteUrl, DEFAULT_SITE_URL);
    assert.equal(r.env.geminiBaseUrl, undefined);
    assert.equal(r.env.geminiModel, undefined);
    assert.equal(r.warnings.length, 3);
  });

  it("accepts valid URLs (trailing slash removed) and model ids, including fallback 'off'", () => {
    const r = parseEnv({ SITE_URL: "https://airiq.example.com/", GEMINI_MODEL: "gemini-3.5-flash-lite", GEMINI_FALLBACK_MODEL: "off" });
    assert.equal(r.env.siteUrl, "https://airiq.example.com");
    assert.equal(r.env.geminiModel, "gemini-3.5-flash-lite");
    assert.equal(r.env.geminiFallbackModel, "off");
  });

  it("never puts a secret value in warnings, feature details or the log summary", () => {
    const r = parseEnv({ WAQI_TOKEN: SECRET, OPENAQ_API_KEY: SECRET, GEMINI_API_KEY: SECRET, SITE_URL: SECRET, GEMINI_MODEL: `${SECRET} !`, NODE_ENV: "production", GEMINI_BASE_URL: "http://localhost:9" });
    const text = JSON.stringify({ w: r.warnings, f: r.features, s: envSummary(r) });
    assert.ok(!text.includes(SECRET));
    assert.ok(r.warnings.some((w) => w.includes("GEMINI_BASE_URL is set in production")));
  });
});
