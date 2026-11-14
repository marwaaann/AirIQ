/**
 * Chart y-axis bounds for index values. Pure module (relative imports only).
 */

import { categoriesFor, type ScaleKey } from "./aqi-categories.ts";

/**
 * Upper y bound: a little above the data, snapped to the next category
 * boundary. Above the index's top (US/NAQI 500) the axis keeps extending in
 * steps of 50, so beyond-index values are drawn, never clipped. Never NaN.
 */
export function niceYMax(maxValue: number, scale: ScaleKey): number {
  const safe = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : 0;
  const target = Math.max(safe * 1.08, scale === "eu" ? 30 : 60);
  const edge = categoriesFor(scale).find((c) => Number.isFinite(c.max) && c.max >= target);
  return edge ? edge.max : Math.ceil(target / 50) * 50;
}
