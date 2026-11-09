import "server-only";

import { cache } from "react";

import { geocode } from "@/lib/openmeteo";
import { placeSubtitle } from "@/lib/place";
import { formatCoords, MY_LOCATION_SLUG_NAME, prettifySlugName, slugifyName, type ParsedSlug } from "@/lib/slug";

export interface ResolvedPlace {
  slug: string;
  name: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
  /** Came from browser geolocation; the client resolves a label in the background. */
  isMyLocation: boolean;
}

/** Great-circle distance in km. */
function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Turn a parsed slug into a display name. The coordinates in the slug are
 * authoritative; the geocoder is only used to recover "Region, Country" for a
 * same-named place within 50 km. Failures fall back to the slug name.
 */
export const resolvePlace = cache(async (slug: string, parsed: ParsedSlug): Promise<ResolvedPlace> => {
  const base = { slug, latitude: parsed.latitude, longitude: parsed.longitude };

  if (parsed.name === MY_LOCATION_SLUG_NAME) {
    return { ...base, name: `Your location (${formatCoords(parsed.latitude, parsed.longitude)})`, isMyLocation: true };
  }

  const fallback: ResolvedPlace = { ...base, name: prettifySlugName(parsed.name), isMyLocation: false };
  try {
    const results = await geocode(parsed.name.replace(/-/g, " "), 10);
    let best: (typeof results)[number] | null = null;
    let bestD = Infinity;
    for (const r of results) {
      if (slugifyName(r.name) !== parsed.name) continue;
      const d = distanceKm(parsed.latitude, parsed.longitude, r.latitude, r.longitude);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    if (best && bestD <= 50) {
      return { ...fallback, name: best.name, subtitle: placeSubtitle(best) || undefined };
    }
  } catch {
    // Geocoder unavailable: the slug name is still a fine label.
  }
  return fallback;
});

