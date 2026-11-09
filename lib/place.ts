import type { GeoLocation } from "@/types/air";

/** "Region, Country" line for a place, skipping parts equal to the name. */
export function placeSubtitle(p: Pick<GeoLocation, "name" | "admin1" | "country">): string {
  return [p.admin1, p.country].filter((s): s is string => Boolean(s) && s !== p.name).join(", ");
}
