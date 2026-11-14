/**
 * Which points feed the map heatmap.
 *
 *   Model only:    the Open-Meteo grid.
 *   Stations only: fresh ground stations (US AQI as reported).
 *   Blended (default): where at least 5 fresh stations are in view, the
 *     stations drive the surface and model grid points are used only in the
 *     gaps (no station within GAP_KM); with fewer stations it is the model.
 *
 * Stations report the US AQI only, so blending happens on the US AQI layer;
 * any other scale or pollutant layer falls back to the model, and the legend
 * says so. Pure module (relative imports only).
 */

import { haversineKm } from "./headline-source.ts";

export const HEAT_MODES = ["blended", "stations", "model"] as const;
export type HeatMode = (typeof HEAT_MODES)[number];
export const HEAT_MODE_LABEL: Record<HeatMode, string> = { blended: "Blended", stations: "Stations only", model: "Model only" };

export const MIN_STATIONS_FOR_BLEND = 5;
/** A model grid point is a "gap" when no fresh station is within this distance. */
export const GAP_KM = 15;

export interface HeatSample {
  lat: number;
  lon: number;
  value: number;
  source: "station" | "model";
}

export type HeatDriver = "stations" | "model" | "mixed" | "none";

export interface BlendResult {
  samples: HeatSample[];
  driver: HeatDriver;
  /** Plain-language legend line: which source drives which part. */
  note: string;
}

export interface BlendInput {
  mode: HeatMode;
  /** Fresh stations in view with their value on the active layer (US AQI). */
  stations: readonly { lat: number; lon: number; value: number }[];
  /** Model grid points with their value on the active layer and scale. */
  grid: readonly { lat: number; lon: number; value: number }[];
  /** False when stations cannot be compared with the layer (another scale or a pollutant layer). */
  stationsComparable: boolean;
  gapKm?: number;
  minStations?: number;
}

export function blendHeat(input: BlendInput): BlendResult {
  const gapKm = input.gapKm ?? GAP_KM;
  const min = input.minStations ?? MIN_STATIONS_FOR_BLEND;
  const model = input.grid.map((g) => ({ ...g, source: "model" as const }));
  const stations = input.stations.filter((s) => Number.isFinite(s.value)).map((s) => ({ ...s, source: "station" as const }));
  const modelResult = (note: string): BlendResult =>
    model.length ? { samples: model, driver: "model", note } : { samples: [], driver: "none", note: "No model data in view." };

  if (input.mode === "model") return modelResult("Heatmap: model grid (Open-Meteo, CAMS).");

  if (!input.stationsComparable) {
    return modelResult(
      input.mode === "stations"
        ? "Stations report the US AQI only, so this layer shows the model grid."
        : "Heatmap: model grid. Station values are US AQI and are not blended into this layer.",
    );
  }

  if (input.mode === "stations") {
    return stations.length
      ? { samples: stations, driver: "stations", note: `Heatmap: ${stations.length} fresh ground station${stations.length === 1 ? "" : "s"} only (no model).` }
      : { samples: [], driver: "none", note: "Heatmap: no fresh ground stations in view." };
  }

  // Blended
  if (stations.length < min) {
    return modelResult(
      `Heatmap: model grid. Blending needs at least ${min} fresh stations in view (${stations.length} here).`,
    );
  }
  const gaps = model.filter((g) => !stations.some((s) => haversineKm(g.lat, g.lon, s.lat, s.lon) <= gapKm));
  return {
    samples: [...stations, ...gaps],
    driver: gaps.length ? "mixed" : "stations",
    note: gaps.length
      ? `Heatmap: ${stations.length} fresh stations drive the surface near them; the model grid fills areas more than ${gapKm} km from any station.`
      : `Heatmap: ${stations.length} fresh stations cover the whole view.`,
  };
}
