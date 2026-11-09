/**
 * Shareable city slugs: `<name>-<lat>-<lon>`, e.g. `delhi-28.652-77.231`,
 * `new-york-40.713--74.006`, `lima--12.046--77.043`.
 *
 * Coordinates are kept to 3 decimals (~100 m). Pure module so it can run
 * under `node --test`.
 */

/** Slug name used for browser-geolocation places before a label is known. */
export const MY_LOCATION_SLUG_NAME = "your-location";
/** Slug name for an unnamed point picked on the map. */
export const MAP_POINT_SLUG_NAME = "map-point";

/** Places whose name is resolved client-side from coordinates. */
export type LabelKind = "my-location" | "map-point";

export function labelKindForSlugName(name: string): LabelKind | null {
  if (name === MY_LOCATION_SLUG_NAME) return "my-location";
  if (name === MAP_POINT_SLUG_NAME) return "map-point";
  return null;
}

export interface ParsedSlug {
  /** The name part (still slugified). */
  name: string;
  latitude: number;
  longitude: number;
}

export function slugifyName(name: string): string {
  const s = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s || "place";
}

const fmt = (v: number) => {
  const r = Number(v.toFixed(3));
  // Avoid "-0"
  return String(Object.is(r, -0) ? 0 : r);
};

export function makeCitySlug(name: string, latitude: number, longitude: number): string {
  return `${slugifyName(name)}-${fmt(latitude)}-${fmt(longitude)}`;
}

const SLUG_RE = /^([a-z0-9-]*[a-z0-9])-(-?\d{1,2}(?:\.\d+)?)-(-?\d{1,3}(?:\.\d+)?)$/;

export function parseCitySlug(slug: string): ParsedSlug | null {
  const m = SLUG_RE.exec(decodeURIComponent(slug).toLowerCase());
  if (!m) return null;
  const latitude = Number(m[2]);
  const longitude = Number(m[3]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { name: m[1], latitude, longitude };
}

/** "new-york" → "New York" (fallback display name when no geocode match exists). */
export function prettifySlugName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function formatCoords(latitude: number, longitude: number): string {
  const ns = latitude >= 0 ? "N" : "S";
  const ew = longitude >= 0 ? "E" : "W";
  return `${Math.abs(latitude).toFixed(2)}°${ns}, ${Math.abs(longitude).toFixed(2)}°${ew}`;
}
