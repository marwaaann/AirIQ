/**
 * Map grid construction for /api/grid.
 *
 * Grid points sit on multiples of a "nice" step that depends on zoom, so
 * nearby or slightly panned viewports produce identical coordinates and hit
 * the same cache entries. Pure module so it can run under `node --test`.
 */

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface GridPoint {
  lat: number;
  lon: number;
}

export const MAX_GRID_POINTS = 64;

/** Ascending candidate steps in degrees. Finest is 0.1° (CAMS Europe resolution). */
export const NICE_STEPS = [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5, 10, 15, 20, 30, 45, 60, 90] as const;

/** Approximate longitude span of a ~1024 px wide viewport at `zoom`. */
export function viewportDegrees(zoom: number): number {
  return (360 * 1024) / (256 * 2 ** zoom);
}

/**
 * Finest step allowed at this zoom (~16 points across a typical viewport).
 * buildGrid starts here and coarsens until the point budget fits, so the step
 * depends only on zoom and viewport size, never on the exact pan position.
 */
export function baseStepForZoom(zoom: number): number {
  const target = viewportDegrees(zoom) / 16;
  return NICE_STEPS.find((s) => s >= target) ?? NICE_STEPS[NICE_STEPS.length - 1];
}

/** Round away float noise (e.g. 0.30000000000000004 → 0.3). */
const clean = (v: number) => Math.round(v * 1e6) / 1e6;

/** Multiples of `step` inside [lo, hi]. */
export function multiplesWithin(lo: number, hi: number, step: number): number[] {
  const kStart = Math.ceil(lo / step - 1e-9);
  const kEnd = Math.floor(hi / step + 1e-9);
  const out: number[] = [];
  for (let k = kStart; k <= kEnd; k++) out.push(clean(k * step));
  return out;
}

/** Maximum lon/lat span accepted for a zoom level (a 16-tile-wide screen). Larger = abuse or a client bug. */
export function maxSpanForZoom(zoom: number): { lat: number; lon: number } {
  const lon = Math.min(360, (360 * 16) / 2 ** zoom);
  return { lon, lat: Math.min(180, lon) };
}

export interface Grid {
  step: number;
  points: GridPoint[];
}

/**
 * Regular grid of at most `maxPoints` points covering `b`. Starts from the
 * zoom's base step and coarsens until the point budget fits. If the bounds
 * are smaller than one step, returns the single snapped point nearest the
 * centre so the view is never empty.
 */
export function buildGrid(b: Bounds, zoom: number, maxPoints: number = MAX_GRID_POINTS): Grid {
  const startIdx = Math.max(0, NICE_STEPS.indexOf(baseStepForZoom(zoom) as (typeof NICE_STEPS)[number]));
  for (let i = startIdx; i < NICE_STEPS.length; i++) {
    const step = NICE_STEPS[i];
    const lats = multiplesWithin(b.south, b.north, step).filter((v) => v > -90 && v < 90);
    const lons = multiplesWithin(b.west, b.east, step).filter((v) => v >= -180 && v < 180);
    if (lats.length * lons.length > maxPoints) continue;
    if (lats.length === 0 || lons.length === 0) {
      const lat = clean(Math.round((b.south + b.north) / 2 / step) * step);
      const lon = clean(Math.round((b.west + b.east) / 2 / step) * step);
      return { step, points: [{ lat: Math.max(-89.9, Math.min(89.9, lat)), lon: lon >= 180 ? clean(lon - 360) : lon }] };
    }
    const points: GridPoint[] = [];
    for (const lat of lats) for (const lon of lons) points.push({ lat, lon });
    return { step, points };
  }
  // Unreachable for valid bounds (90° step covers the world in ≤ 2×4 points).
  return { step: NICE_STEPS[NICE_STEPS.length - 1], points: [] };
}

/** Expand bounds outward to multiples of `step` (used to share cache keys for station queries). */
export function snapBoundsOutward(b: Bounds, step: number): Bounds {
  return {
    south: Math.max(-90, clean(Math.floor(b.south / step) * step)),
    west: Math.max(-180, clean(Math.floor(b.west / step) * step)),
    north: Math.min(90, clean(Math.ceil(b.north / step) * step)),
    east: Math.min(180, clean(Math.ceil(b.east / step) * step)),
  };
}
