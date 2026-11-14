"use client";

import { ReferenceArea } from "recharts";

import { categoriesFor } from "@/lib/aqi-categories";
import type { AqiScale } from "@/types/air";

/**
 * Category background bands (rendered as direct chart children).
 * Kept apart from chart-kit so modules that only need colors never pull in Recharts.
 */
export function categoryBands(scale: AqiScale, yMax: number, opacity: number) {
  // Includes the US "Beyond index" band, drawn when the axis extends past 500.
  const cats = categoriesFor(scale);
  return cats
    .filter((c) => c.min < yMax)
    .map((c) => (
      <ReferenceArea
        key={c.key}
        y1={c.min}
        y2={Math.min(Number.isFinite(c.max) ? c.max : yMax, yMax)}
        fill={c.color}
        fillOpacity={opacity}
        stroke="none"
        ifOverflow="hidden"
      />
    ));
}
