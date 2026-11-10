import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

/** Minimal browser globals so lib/storage.ts can run under node. */
const data = new Map<string, string>();
const fakeWindow = {
  localStorage: {
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
};
(globalThis as unknown as { window: typeof fakeWindow }).window = fakeWindow;
(globalThis as unknown as { CustomEvent: unknown }).CustomEvent ??= class {
  type: string;
  constructor(type: string) {
    this.type = type;
  }
};

const { createStoredValue } = await import("../storage.ts");
const { RulesStorageSchema } = await import("../alerts.ts");

describe("stored values discard corrupted JSON", () => {
  it("falls back and removes non-JSON content", () => {
    data.set("t:a", "{not json");
    const store = createStoredValue("t:a", z.array(z.string()), ["default"]);
    assert.deepEqual(store.get(), ["default"]);
    assert.equal(data.has("t:a"), false);
  });

  it("falls back and removes JSON of the wrong shape", () => {
    data.set("t:b", JSON.stringify({ hello: 1 }));
    const store = createStoredValue("t:b", z.array(z.string()), []);
    assert.deepEqual(store.get(), []);
    assert.equal(data.has("t:b"), false);
  });

  it("keeps the valid items of a partly corrupted rule list", () => {
    const good = {
      id: "r1",
      city: { name: "Delhi", latitude: 28.6, longitude: 77.2, timezone: "Asia/Kolkata", slug: "delhi-28.6-77.2" },
      metric: "aqi",
      scale: "us",
      threshold: 150,
      trigger: { type: "current" },
      quietHours: null,
      enabled: true,
      createdAt: "2026-11-10T00:00:00Z",
    };
    data.set("t:c", JSON.stringify([good, "garbage", { id: 2 }]));
    const store = createStoredValue("t:c", RulesStorageSchema, []);
    assert.deepEqual(
      store.get().map((r) => r.id),
      ["r1"],
    );
    // The malformed items are removed from storage too, not just ignored.
    assert.equal(JSON.parse(data.get("t:c") as string).length, 1);
  });

  it("round-trips valid values", () => {
    const store = createStoredValue("t:d", z.number(), 0);
    store.set(42);
    assert.equal(store.get(), 42);
    assert.equal(data.get("t:d"), "42");
  });
});
