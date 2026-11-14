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

export function gridIcon(label: string, category: AqiCategory | null, spoken: string, beyond = false, muted = false): L.DivIcon {
  const c = category ?? NEUTRAL;
  const key = `g|${label}|${c.color}|${c.pattern}|${spoken}|${beyond}|${muted}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const width = 18 + Math.max(2, label.length) * 8;
  const icon = L.divIcon({
    className: "airiq-divicon",
    html: `<span class="airiq-badge${beyond ? " airiq-beyond" : ""}" role="img" aria-label="${esc(spoken)}" style="background-color:${c.color};color:${c.textColor}${muted ? ";opacity:0.72" : ""}"><i class="airiq-badge-pattern aqi-pattern-${c.pattern}" style="background-color:${c.color}"></i>${esc(label)}</span>`,
    // 24px tall: the WCAG 2.2 minimum target size.
    iconSize: [width, 24],
    iconAnchor: [width / 2, 12],
    popupAnchor: [0, -13],
  });
  cache.set(key, icon);
  return icon;
}

export function stationIcon(label: string, category: AqiCategory, spoken: string, beyond = false, stale = false): L.DivIcon {
  const key = `s|${label}|${category.key}|${spoken}|${beyond}|${stale}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // Beyond-index stations get a bigger, double-ringed marker so a "500+" reading stands out from Hazardous ones.
  const size = beyond ? 46 : 38;
  const icon = L.divIcon({
    className: "airiq-divicon",
    html: `<span class="airiq-station${beyond ? " airiq-beyond" : ""} aqi-pattern-${category.pattern}" role="img" aria-label="${esc(spoken)}" style="background-color:${category.color}${stale ? ";opacity:0.55" : ""}"><span class="airiq-station-core" style="background-color:${category.color};color:${category.textColor}">${esc(label)}</span></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 1)],
  });
  cache.set(key, icon);
  return icon;
}
