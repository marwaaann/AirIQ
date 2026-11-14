import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hexToRgb, rampColor } from "../color-ramp.ts";
import { baseStepForZoom, buildGrid, MAX_GRID_POINTS, maxSpanForZoom, multiplesWithin, snapBoundsOutward } from "../grid.ts";
import { idw } from "../idw.ts";

describe("grid snapping", () => {
  it("chooses coarser steps at lower zoom", () => {
    assert.ok(baseStepForZoom(3) > baseStepForZoom(8));
    assert.equal(baseStepForZoom(12), 0.1);
  });

  it("lists multiples of the step inside the range without float noise", () => {
    assert.deepEqual(multiplesWithin(0.05, 0.75, 0.1), [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7]);
    assert.deepEqual(multiplesWithin(-1, 1, 0.5), [-1, -0.5, 0, 0.5, 1]);
  });

  it("never exceeds the point budget", () => {
    for (let z = 2; z <= 14; z++) {
      const span = Math.min(170, 360 / 2 ** (z - 2));
      const g = buildGrid({ south: 20, west: 70, north: Math.min(85, 20 + span / 2), east: Math.min(180, 70 + span) }, z);
      assert.ok(g.points.length > 0 && g.points.length <= MAX_GRID_POINTS, `z=${z} → ${g.points.length}`);
    }
    const world = buildGrid({ south: -85, west: -180, north: 85, east: 180 }, 2);
    assert.ok(world.points.length <= MAX_GRID_POINTS && world.points.length >= 16, `world → ${world.points.length}`);
  });

  it("snaps slightly different viewports to identical points (cache sharing)", () => {
    const a = buildGrid({ south: 28.01, west: 76.02, north: 29.49, east: 78.48 }, 9);
    const b = buildGrid({ south: 28.04, west: 76.07, north: 29.46, east: 78.43 }, 9);
    assert.equal(a.step, b.step);
    assert.deepEqual(a.points, b.points);
  });

  it("points lie on multiples of the step", () => {
    const g = buildGrid({ south: 10.3, west: 20.7, north: 14.9, east: 26.1 }, 7);
    for (const p of g.points) {
      assert.ok(Math.abs(p.lat / g.step - Math.round(p.lat / g.step)) < 1e-6);
      assert.ok(Math.abs(p.lon / g.step - Math.round(p.lon / g.step)) < 1e-6);
    }
  });

  it("returns one snapped point for bounds smaller than a step", () => {
    const g = buildGrid({ south: 28.61, west: 77.2, north: 28.62, east: 77.21 }, 18);
    assert.equal(g.points.length, 1);
    assert.deepEqual(g.points[0], { lat: 28.6, lon: 77.2 });
  });

  it("allows wider spans at lower zoom", () => {
    assert.equal(maxSpanForZoom(2).lon, 360);
    assert.ok(maxSpanForZoom(10).lon < 10);
  });

  it("snaps bounds outward", () => {
    assert.deepEqual(snapBoundsOutward({ south: 28.3, west: 76.6, north: 29.2, east: 77.9 }, 0.5), {
      south: 28,
      west: 76.5,
      north: 29.5,
      east: 78,
    });
  });
});

describe("IDW interpolation", () => {
  const samples = [
    { x: 0, y: 0, v: 10 },
    { x: 10, y: 0, v: 30 },
  ];

  it("returns the exact value on a sample", () => {
    assert.deepEqual(idw(samples, 0, 0), { value: 10, nearest: 0 });
  });

  it("is the plain mean at the midpoint between two samples", () => {
    assert.equal(idw(samples, 5, 0)?.value, 20);
  });

  it("weights by inverse squared distance", () => {
    // d1 = 2, d2 = 8 → w = 1/4, 1/64 → (10/4 + 30/64) / (1/4 + 1/64) = 11.176…
    const r = idw(samples, 2, 0);
    assert.ok(r && Math.abs(r.value - 11.1765) < 1e-3, `${r?.value}`);
    assert.equal(r?.nearest, 2);
  });

  it("stays within the sample range", () => {
    for (let x = -5; x <= 15; x += 0.5) {
      const r = idw(samples, x, 3);
      assert.ok(r && r.value >= 10 && r.value <= 30);
    }
  });

  it("respects the radius", () => {
    assert.equal(idw(samples, 100, 100, { radius: 5 }), null);
    assert.equal(idw(samples, 1, 0, { radius: 5 })?.value, 10);
  });

  it("supports other powers", () => {
    const r = idw(samples, 2, 0, { power: 1 });
    // w = 1/2, 1/8 → (5 + 3.75) / 0.625 = 14
    assert.ok(r && Math.abs(r.value - 14) < 1e-9);
  });

  it("returns null with no samples", () => {
    assert.equal(idw([], 0, 0), null);
  });
});

describe("color ramp", () => {
  it("parses hex", () => {
    assert.deepEqual(hexToRgb("#ff7e00"), [255, 126, 0]);
  });
  it("hits category colors at band centres and clamps at the ends", () => {
    assert.deepEqual(rampColor(0, "us"), hexToRgb("#00e400"));
    assert.deepEqual(rampColor(25, "us"), hexToRgb("#00e400"));
    assert.deepEqual(rampColor(125.5, "us"), hexToRgb("#ff7e00"));
    assert.deepEqual(rampColor(500, "us"), hexToRgb("#7e0023"));
    assert.deepEqual(rampColor(10, "eu"), hexToRgb("#50f0e6"));
  });
  it("gives beyond-index values their own colour, never NaN", () => {
    assert.deepEqual(rampColor(501, "us"), hexToRgb("#3d000f"));
    assert.deepEqual(rampColor(999, "us"), hexToRgb("#3d000f"));
    assert.deepEqual(rampColor(650, "in"), hexToRgb("#a50f15"));
    assert.deepEqual(rampColor(Number.NaN, "us"), hexToRgb("#00e400"));
    assert.ok(rampColor(Number.POSITIVE_INFINITY, "us").every(Number.isFinite));
  });
  it("interpolates between neighbouring categories", () => {
    const c = rampColor(50, "us"); // halfway between green (25) and yellow (75.5)
    assert.ok(c[0] > 100 && c[0] < 160, `${c}`);
  });
});
