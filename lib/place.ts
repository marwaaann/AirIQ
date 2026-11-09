import { formatCoords, type LabelKind } from "@/lib/slug";
import type { GeoLocation } from "@/types/air";

/** "Region, Country" line for a place, skipping parts equal to the name. */
export function placeSubtitle(p: Pick<GeoLocation, "name" | "admin1" | "country">): string {
  return [p.admin1, p.country].filter((s): s is string => Boolean(s) && s !== p.name).join(", ");
}

/** Label shown for an unnamed place until (or unless) a reverse lookup succeeds. */
export function fallbackPlaceName(kind: LabelKind, latitude: number, longitude: number): string {
  const coords = formatCoords(latitude, longitude);
  return kind === "my-location" ? `Your location (${coords})` : `Map point (${coords})`;
}
