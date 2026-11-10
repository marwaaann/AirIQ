"use client";

import { ReferenceArea } from "recharts";

import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { EU_CATEGORIES, US_CATEGORIES } from "@/lib/aqi-categories";
import type { AqiScale } from "@/types/air";

/** Chart colors per theme (SVG attributes can't use CSS variables reliably). */
export function useChartColors() {
  const theme = useResolvedTheme();
  return theme === "dark"
    ? { text: "#e6ebf2", muted: "#98a4b5", grid: "#263243", surface: "#111821", official: "#e6ebf2", model: "#2dd4bf", sub: "#98a4b5", now: "#60a5fa", bandOpacity: 0.14 }
    : { text: "#0e1726", muted: "#586374", grid: "#dde2e9", surface: "#ffffff", official: "#0e1726", model: "#0f766e", sub: "#586374", now: "#2563eb", bandOpacity: 0.16 };
}

/** Upper y bound: a little above the data, snapped to the next category boundary. */
export function niceYMax(maxValue: number, scale: AqiScale): number {
  const cats = scale === "us" ? US_CATEGORIES : EU_CATEGORIES;
  const target = Math.max(maxValue * 1.08, scale === "us" ? 60 : 30);
  const edge = cats.find((c) => Number.isFinite(c.max) && c.max >= target);
  return edge ? edge.max : Math.ceil(target / 50) * 50;
}

/** Category background bands (rendered as direct chart children). */
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
