/** Map pollutant layers and how each one reads a grid cell. */

import { describeIndex, formatIndex, getCategory, isBeyondIndex, POLLUTANT_INFO, type AqiCategory } from "@/lib/aqi-categories";
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
  /** True when the index is above the scale's top (shown as "500+"). */
  beyond: boolean;
}

export function cellIndex(cell: GridCell, scale: AqiScale): number | null {
  return scale === "us" ? cell.usAqi : scale === "eu" ? cell.euAqi : cell.inAqi;
}

function cellSubIndices(cell: GridCell, scale: AqiScale) {
  return scale === "us" ? cell.usSubIndices : scale === "eu" ? cell.euSubIndices : cell.inSubIndices;
}

export function readCell(cell: GridCell, layer: MapLayer, scale: AqiScale): CellReading {
  if (layer === "aqi") {
    const v = cellIndex(cell, scale);
    return {
      index: v,
      label: v === null ? "–" : formatIndex(v, scale),
      spoken: v === null ? (scale === "in" ? "NAQI: not enough data" : "no AQI reported") : describeIndex(v, scale),
      category: v === null ? null : getCategory(v, scale),
      beyond: isBeyondIndex(v, scale),
    };
  }
  const conc = cell.pollutants[layer];
  const sub = cellSubIndices(cell, scale)[layer];
  const index = typeof sub === "number" ? sub : null;
  return {
    index,
    label: conc === null ? "–" : String(Math.round(conc)),
    spoken: conc === null ? `no ${POLLUTANT_INFO[layer].short} reading` : `${POLLUTANT_INFO[layer].short} ${Math.round(conc)} µg/m³`,
    category: index === null ? null : getCategory(index, scale),
    beyond: isBeyondIndex(index, scale),
  };
}

/** Pollutant with the highest sub-index on the scale (from the source, never inferred). */
export function cellDominant(cell: GridCell, scale: AqiScale): Pollutant | null {
  const sub = cellSubIndices(cell, scale);
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
