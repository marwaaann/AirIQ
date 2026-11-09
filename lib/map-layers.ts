/** Map pollutant layers and how each one reads a grid cell. */

import { getCategory, POLLUTANT_INFO, type AqiCategory } from "@/lib/aqi-categories";
import type { AqiScale, GridCell, Pollutant } from "@/types/air";

export const MAP_LAYERS = ["aqi", "pm2_5", "pm10", "nitrogen_dioxide", "ozone"] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

export const LAYER_LABEL: Record<MapLayer, string> = {
  aqi: "AQI",
  pm2_5: "PM2.5",
  pm10: "PM10",
  nitrogen_dioxide: "NO₂",
  ozone: "O₃",
};

export function isMapLayer(v: string | null | undefined): v is MapLayer {
  return typeof v === "string" && (MAP_LAYERS as readonly string[]).includes(v);
}

export interface CellReading {
  /** Index used for color (overall AQI or the pollutant's sub-index on the active scale). */
  index: number | null;
  /** Text on the marker badge: the index for AQI, the concentration for pollutants. */
  label: string;
  /** Full value with unit for screen readers and popups. */
  spoken: string;
  category: AqiCategory | null;
}

export function readCell(cell: GridCell, layer: MapLayer, scale: AqiScale): CellReading {
  if (layer === "aqi") {
    const v = scale === "us" ? cell.usAqi : cell.euAqi;
    return {
      index: v,
      label: v === null ? "–" : String(Math.round(v)),
      spoken: v === null ? "no AQI reported" : `${scale === "us" ? "US" : "European"} AQI ${Math.round(v)}`,
      category: v === null ? null : getCategory(v, scale),
    };
  }
  const conc = cell.pollutants[layer];
  const sub = (scale === "us" ? cell.usSubIndices : cell.euSubIndices)[layer];
  const index = typeof sub === "number" ? sub : null;
  return {
    index,
    label: conc === null ? "–" : String(Math.round(conc)),
    spoken: conc === null ? `no ${POLLUTANT_INFO[layer].short} reading` : `${POLLUTANT_INFO[layer].short} ${Math.round(conc)} µg/m³`,
    category: index === null ? null : getCategory(index, scale),
  };
}

/** Pollutant with the highest sub-index on the scale (from the source, never inferred). */
export function cellDominant(cell: GridCell, scale: AqiScale): Pollutant | null {
  const sub = scale === "us" ? cell.usSubIndices : cell.euSubIndices;
  let best: Pollutant | null = null;
  let max = -Infinity;
  for (const [k, v] of Object.entries(sub) as [Pollutant, number][]) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return best;
}
