import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { makeCitySlug, parseCitySlug, prettifySlugName, slugifyName } from "../slug.ts";

describe("city slugs", () => {
  it("round-trips positive coordinates", () => {
    const s = makeCitySlug("Delhi", 28.65195, 77.23149);
    assert.equal(s, "delhi-28.652-77.231");
    assert.deepEqual(parseCitySlug(s), { name: "delhi", latitude: 28.652, longitude: 77.231 });
  });

  it("round-trips negative longitude and multi-word names", () => {
    const s = makeCitySlug("New York", 40.71427, -74.00597);
    assert.equal(s, "new-york-40.714--74.006");
    assert.deepEqual(parseCitySlug(s), { name: "new-york", latitude: 40.714, longitude: -74.006 });
  });

  it("round-trips negative latitude and longitude", () => {
    const s = makeCitySlug("Lima", -12.04318, -77.02824);
    assert.deepEqual(parseCitySlug(s), { name: "lima", latitude: -12.043, longitude: -77.028 });
  });

  it("handles names ending in digits", () => {
    const s = makeCitySlug("District 9", 10, 20);
    assert.deepEqual(parseCitySlug(s), { name: "district-9", latitude: 10, longitude: 20 });
  });

  it("strips diacritics and non-latin names fall back to 'place'", () => {
    assert.equal(slugifyName("São Paulo"), "sao-paulo");
    assert.equal(slugifyName("北京"), "place");
  });

  it("never emits -0", () => {
    assert.equal(makeCitySlug("Null Island", -0.0001, 0), "null-island-0-0");
  });

  it("rejects malformed or out-of-range slugs", () => {
    assert.equal(parseCitySlug("delhi"), null);
    assert.equal(parseCitySlug("delhi-28.6"), null);
    assert.equal(parseCitySlug("x-95-10"), null);
    assert.equal(parseCitySlug("x-10-190"), null);
    assert.equal(parseCitySlug("-10-10"), null);
  });

  it("prettifies names", () => {
    assert.equal(prettifySlugName("new-york"), "New York");
  });
});
