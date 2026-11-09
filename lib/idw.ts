/**
 * Inverse-distance weighting for the heatmap overlay.
 * Pure module so it can run under `node --test`.
 */

export interface Sample {
  x: number;
  y: number;
  v: number;
}

export interface IdwOptions {
  /** Distance exponent (2 = classic Shepard). */
  power?: number;
  /** Ignore samples farther than this (same units as x/y). */
  radius?: number;
}

export interface IdwResult {
  value: number;
  /** Distance to the nearest contributing sample (for edge fading). */
  nearest: number;
}

/**
 * Weighted value at (x, y): Σ(vᵢ / dᵢᵖ) / Σ(1 / dᵢᵖ).
 * Returns the exact sample value when (x, y) sits on a sample, and null when
 * no sample is within `radius`.
 */
export function idw(samples: readonly Sample[], x: number, y: number, opts: IdwOptions = {}): IdwResult | null {
  const power = opts.power ?? 2;
  const r2 = opts.radius !== undefined ? opts.radius * opts.radius : Infinity;
  let num = 0;
  let den = 0;
  let nearest2 = Infinity;
  for (const s of samples) {
    const dx = s.x - x;
    const dy = s.y - y;
    const d2 = dx * dx + dy * dy;
    if (d2 > r2) continue;
    if (d2 < 1e-12) return { value: s.v, nearest: 0 };
    if (d2 < nearest2) nearest2 = d2;
    // d^p = (d²)^(p/2); avoids a sqrt for the common p = 2.
    const w = power === 2 ? 1 / d2 : 1 / Math.pow(d2, power / 2);
    num += w * s.v;
    den += w;
  }
  if (den === 0) return null;
  return { value: num / den, nearest: Math.sqrt(nearest2) };
}
