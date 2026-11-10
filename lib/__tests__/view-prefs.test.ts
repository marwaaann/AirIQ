import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ProfileId } from "../profiles.ts";
import { parseSharedPrefs, type Scale } from "../share.ts";
import { effectivePrefs, saveSharedPrefs, sharedViewNotice } from "../view-prefs.ts";

/** A store that records every write. */
function recorder<T>() {
  const writes: T[] = [];
  return { writes, set: (v: T) => void writes.push(v) };
}

const saved = { scale: "us" as Scale, profile: "general" as ProfileId };
const link = parseSharedPrefs(new URLSearchParams("tab=history&range=30&scale=eu&profile=respiratory"));

describe("shared-link settings", () => {
  it("apply to the view without writing anything", () => {
    const scale = recorder<Scale>();
    const profile = recorder<ProfileId>();
    const e = effectivePrefs(link, saved);
    assert.equal(e.scale, "eu");
    assert.equal(e.profile, "respiratory");
    assert.deepEqual(e.fromLink, { scale: true, profile: true });
    // Rendering the notice is also read-only.
    assert.ok(sharedViewNotice(link, saved));
    assert.deepEqual(scale.writes, []);
    assert.deepEqual(profile.writes, []);
  });
  it("say what is overridden", () => {
    assert.equal(sharedViewNotice(link, saved), "Viewing with European AQI / profile: Asthma / respiratory condition from a shared link");
    assert.equal(sharedViewNotice(parseSharedPrefs(new URLSearchParams("scale=eu")), saved), "Viewing with European AQI from a shared link");
  });
  it("show no notice when the link matches the saved settings or has none", () => {
    assert.equal(sharedViewNotice(parseSharedPrefs(new URLSearchParams("scale=us&profile=general")), saved), null);
    assert.equal(sharedViewNotice(parseSharedPrefs(new URLSearchParams("")), saved), null);
    assert.deepEqual(effectivePrefs(parseSharedPrefs(new URLSearchParams("scale=bogus")), saved).scale, "us");
  });
  it("are persisted only by 'Save as my settings', and only what differs", () => {
    const scale = recorder<Scale>();
    const profile = recorder<ProfileId>();
    assert.deepEqual(saveSharedPrefs(link, saved, { scale, profile }), ["scale", "profile"]);
    assert.deepEqual(scale.writes, ["eu"]);
    assert.deepEqual(profile.writes, ["respiratory"]);
    const s2 = recorder<Scale>();
    const p2 = recorder<ProfileId>();
    assert.deepEqual(saveSharedPrefs(parseSharedPrefs(new URLSearchParams("scale=us&profile=athlete")), saved, { scale: s2, profile: p2 }), ["profile"]);
    assert.deepEqual(s2.writes, []);
    assert.deepEqual(p2.writes, ["athlete"]);
  });
});
