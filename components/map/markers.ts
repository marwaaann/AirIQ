import L from "leaflet";

import type { AqiCategory } from "@/lib/aqi-categories";

/**
 * Custom divIcons (no image assets, so Leaflet's default-icon path issue never
 * applies). Grid points are rounded badges; stations are double-ringed
 * circles. Both carry the category pattern so color is never the only cue.
 */

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const cache = new Map<string, L.DivIcon>();

const NEUTRAL = { color: "#9aa4b2", textColor: "#111827", pattern: "none" } as const;

export function gridIcon(label: string, category: AqiCategory | null, spoken: string): L.DivIcon {
  const c = category ?? NEUTRAL;
  const key = `g|${label}|${c.color}|${c.pattern}|${spoken}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const width = 18 + Math.max(2, label.length) * 8;
  const icon = L.divIcon({
    className: "airiq-divicon",
    html: `<span class="airiq-badge" role="img" aria-label="${esc(spoken)}" style="background-color:${c.color};color:${c.textColor}"><i class="airiq-badge-pattern aqi-pattern-${c.pattern}" style="background-color:${c.color}"></i>${esc(label)}</span>`,
    iconSize: [width, 22],
    iconAnchor: [width / 2, 11],
    popupAnchor: [0, -12],
  });
  cache.set(key, icon);
  return icon;
}

export function stationIcon(label: string, category: AqiCategory, spoken: string): L.DivIcon {
  const key = `s|${label}|${category.key}|${spoken}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const icon = L.divIcon({
    className: "airiq-divicon",
    html: `<span class="airiq-station aqi-pattern-${category.pattern}" role="img" aria-label="${esc(spoken)}" style="background-color:${category.color}"><span class="airiq-station-core" style="background-color:${category.color};color:${category.textColor}">${esc(label)}</span></span>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
    popupAnchor: [0, -20],
  });
  cache.set(key, icon);
  return icon;
}
