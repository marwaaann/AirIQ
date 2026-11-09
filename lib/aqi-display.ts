/**
 * Turns an /api/air response into what the UI shows for a given AQI scale.
 * The headline is ALWAYS the source index (Open-Meteo us_aqi / european_aqi);
 * the in-app EPA calculation is only a cross-check.
 */

import type { CSSProperties } from "react";

import { getCategory, type AqiCategory } from "@/lib/aqi-categories";
import type { AqiScale, AirQuality, Pollutant, SubIndexValues } from "@/types/air";

export interface Headline {
  value: number | null;
  category: AqiCategory | null;
  dominant: Pollutant | null;
  subIndices: SubIndexValues;
  scaleLabel: string;
}

export const SCALE_LABEL: Record<AqiScale, string> = { us: "US AQI", eu: "European AQI" };

export function headline(current: AirQuality, scale: AqiScale): Headline {
  const value = scale === "us" ? current.usAqi : current.euAqi;
  return {
    value,
    category: value === null ? null : getCategory(value, scale),
    dominant: scale === "us" ? current.dominantUs : current.dominantEu,
    subIndices: scale === "us" ? current.usSubIndices : current.euSubIndices,
    scaleLabel: SCALE_LABEL[scale],
  };
}

/** Inline style that sets the per-view accent to a category color. */
export function accentStyle(category: AqiCategory | null): CSSProperties | undefined {
  return category ? ({ "--accent": category.color } as CSSProperties) : undefined;
}
