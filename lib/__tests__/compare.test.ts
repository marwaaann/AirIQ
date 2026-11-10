import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { compareDays, compareSummary, parseCitiesParam, rankCleanest, serializeCities } from "../compare.ts";

const days = (vals: (number | null)[]) => new Map(vals.flatMap((v, i) => (v === null ? [] : [[`2026-11-0${i + 1}`, v] as const])));

describe("compare URL state", () => {
  it("dedupes, trims, lowercases, validates and caps at 4", () => {
    assert.deepEqual(parseCitiesParam(" a-1_2 ,B-1_2,a-1_2,,bad,c-1_2,d-1_2,e-1_2", (s) => s !== "bad"), ["a-1_2", "b-1_2", "c-1_2", "d-1_2"]);
    assert.deepEqual(parseCitiesParam(null), []);
    assert.equal(serializeCities(["a", "b", "c", "d", "e"]), "a,b,c,d");
  });
});

describe("ranking", () => {
  it("orders cleanest first and drops cities without a value", () => {
    const r = rankCleanest([
      { id: "a", name: "A", value: 120 },
      { id: "b", name: "B", value: null },
      { id: "c", name: "C", value: 40 },
      { id: "d", name: "D", value: 40 },
    ]);
    assert.deepEqual(
      r.map((x) => x.id),
      ["c", "d", "a"],
    );
  });
});

describe("day-by-day comparison", () => {
  it("counts only shared days and treats equal rounded means as ties", () => {
    const d = compareDays(days([50, 60, 70.4, null, 10]), days([80, 55, 70.2, 90, null]));
    assert.deepEqual(d, { aCleaner: 1, bCleaner: 1, ties: 1, n: 3 });
  });
  it("writes the example sentence from real counts", () => {
    const lines = compareSummary(
      [
        { name: "Delhi", days: days([200, 180, 150, 170, 160, 190, 50]) },
        { name: "Mumbai", days: days([80, 90, 100, 85, 95, 70, 60]) },
      ],
      7,
      "US AQI",
    );
    assert.equal(lines[0], "Mumbai has been cleaner than Delhi on 6 of the last 7 days.");
    assert.equal(lines[1], "Average daily US AQI over the last 7 days: Mumbai 83, Delhi 157.");
  });
  it("names the shared-day count when days are missing, and 'all' when every day", () => {
    const partial = compareSummary(
      [
        { name: "A", days: days([10, 10, null]) },
        { name: "B", days: days([20, 20, 20]) },
      ],
      3,
      "EU AQI",
    );
    assert.equal(partial[0], "A has been cleaner than B on all of the 2 days with data for both in the last 3 days.");
  });
  it("says nothing comparative with fewer than two cities with data", () => {
    assert.deepEqual(compareSummary([{ name: "A", days: days([1]) }, { name: "B", days: new Map() }], 7, "US AQI"), []);
  });
});
