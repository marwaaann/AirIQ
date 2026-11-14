/**
 * Smooth color ramp for the heatmap, built from the official category colors.
 * Each category color is anchored at the middle of its band and linearly
 * interpolated in RGB between anchors. Values above the index's top
 * ("beyond index") get their own colour: the US "Beyond index" maroon, or the
 * darkest band on the other scales. Pure module (relative imports only).
 */

import { gaugeCategories, INDEX_TOP, SCALE_MAX, US_CATEGORIES, type AqiCategory, type ScaleKey } from "./aqi-categories.ts";

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface Stop {
  at: number;
  rgb: Rgb;
}

function stopsFor(categories: readonly AqiCategory[], topValue: number): Stop[] {
  return categories.map((c) => {
    const hi = Number.isFinite(c.max) ? c.max : topValue;
    return { at: (c.min + hi) / 2, rgb: hexToRgb(c.color) };
  });
}

const STOPS: Record<ScaleKey, Stop[]> = {
  us: stopsFor(gaugeCategories("us"), SCALE_MAX.us),
  eu: stopsFor(gaugeCategories("eu"), SCALE_MAX.eu),
  in: stopsFor(gaugeCategories("in"), SCALE_MAX.in),
};

const BEYOND: Record<ScaleKey, Rgb> = {
  us: hexToRgb(US_CATEGORIES[US_CATEGORIES.length - 1].color),
  eu: STOPS.eu[STOPS.eu.length - 1].rgb,
  in: STOPS.in[STOPS.in.length - 1].rgb,
};

export function rampColor(value: number, scale: ScaleKey): Rgb {
  const stops = STOPS[scale];
  if (!Number.isFinite(value)) return stops[0].rgb;
  // US AQI / NAQI above 500: distinct beyond-index colour (never a clipped Hazardous red).
  if (scale !== "eu" && value > INDEX_TOP[scale]) return BEYOND[scale];
  if (!(value > stops[0].at)) return stops[0].rgb;
  const last = stops[stops.length - 1];
  if (value >= last.at) return last.rgb;
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i];
    if (value <= b.at) {
      const a = stops[i - 1];
      const t = (value - a.at) / (b.at - a.at);
      return [
        Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
        Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
        Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
      ];
    }
  }
  return last.rgb;
}
