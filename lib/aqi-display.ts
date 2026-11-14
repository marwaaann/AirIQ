/**
 * Turns an /api/air response (and series points) into what the UI shows for a
 * given scale. The model headline is the source index (Open-Meteo us_aqi /
 * european_aqi) or AirIQ's NAQI computed from concentrations; the station-first
 * headline (lib/headline-source.ts) may replace the value, never silently.
 */

import type { CSSProperties } from "react";

import { getCategory, SCALE_NAME, SCALE_SHORT, type AqiCategory } from "@/lib/aqi-categories";
import type { AqiScale, AirQuality, Pollutant, SubIndexValues } from "@/types/air";

export interface Headline {
  value: number | null;
  category: AqiCategory | null;
  dominant: Pollutant | null;
  subIndices: SubIndexValues;
  scaleLabel: string;
}

export const SCALE_LABEL: Record<AqiScale, string> = SCALE_NAME;
export { SCALE_SHORT };

/** The model's index for the current reading on a scale. */
export function currentIndex(current: AirQuality, scale: AqiScale): number | null {
  return scale === "us" ? current.usAqi : scale === "eu" ? current.euAqi : current.inAqi;
}

export function headline(current: AirQuality, scale: AqiScale): Headline {
  const value = currentIndex(current, scale);
  return {
    value,
    category: value === null ? null : getCategory(value, scale),
    dominant: scale === "us" ? current.dominantUs : scale === "eu" ? current.dominantEu : current.dominantIn,
    subIndices: scale === "us" ? current.usSubIndices : scale === "eu" ? current.euSubIndices : current.inSubIndices,
    scaleLabel: SCALE_LABEL[scale],
  };
}

interface IndexedPoint {
  usAqi: number | null;
  euAqi: number | null;
  inAqi?: number | null;
  usSubIndices?: SubIndexValues;
  euSubIndices?: SubIndexValues;
  inSubIndices?: SubIndexValues;
}

/** A series point's index on a scale (NAQI is null where the 16-hour rule is not met). */
export function pointIndex(p: IndexedPoint, scale: AqiScale): number | null {
  const v = scale === "us" ? p.usAqi : scale === "eu" ? p.euAqi : (p.inAqi ?? null);
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function pointSubIndices(p: IndexedPoint, scale: AqiScale): SubIndexValues | undefined {
  return scale === "us" ? p.usSubIndices : scale === "eu" ? p.euSubIndices : p.inSubIndices;
}

/** Inline style that sets the per-view accent to a category color. */
export function accentStyle(category: AqiCategory | null): CSSProperties | undefined {
  return category ? ({ "--accent": category.color } as CSSProperties) : undefined;
}
