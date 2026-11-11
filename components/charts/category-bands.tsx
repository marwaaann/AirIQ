"use client";

import { ReferenceArea } from "recharts";

import { EU_CATEGORIES, US_CATEGORIES } from "@/lib/aqi-categories";
import type { AqiScale } from "@/types/air";

/**
 * Category background bands (rendered as direct chart children).
 * Kept apart from chart-kit so modules that only need colors never pull in Recharts.
 */
export function categoryBands(scale: AqiScale, yMax: number, opacity: number) {
  const cats = scale === "us" ? US_CATEGORIES : EU_CATEGORIES;
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
