/**
 * Gauge geometry. Pure module (relative imports only) so it runs under `node --test`.
 */

import type { AqiCategory } from "./aqi-categories.ts";

/**
 * Position on the gauge (0..1). Bands are equal width for readability; value
 * interpolates inside its band. Values past the last band (beyond the index)
 * pin to 1; non-finite values pin to 0. Never NaN.
 */
export function gaugeFraction(value: number, categories: readonly AqiCategory[], scaleMax: number): number {
  if (!Number.isFinite(value)) return 0;
  const n = categories.length;
  if (n === 0) return 0;
  const lastMax = categories[n - 1].max;
  if (value > (Number.isFinite(lastMax) ? lastMax : scaleMax)) return 1;
  const idx = Math.max(
    0,
    categories.findIndex((c) => value <= c.max),
  );
  const band = categories[idx] ?? categories[n - 1];
  const hi = Number.isFinite(band.max) ? band.max : scaleMax;
  const within = hi > band.min ? Math.min(1, Math.max(0, (value - band.min) / (hi - band.min))) : 1;
  return Math.min(1, Math.max(0, (idx + within) / n));
}
