import "server-only";

import type { Metadata } from "next";

import { getCategory } from "@/lib/aqi-categories";
import { getCurrentAir } from "@/lib/openmeteo";
import type { ResolvedPlace } from "@/lib/resolve-place";

export interface LiveSnapshot {
  usAqi: number;
  label: string;
  color: string;
  textColor: string;
}

/**
 * Current US AQI and category for previews, or null on any failure or after
 * `timeoutMs` (a slow upstream must never block the page or the image).
 * Uses the same 10-minute in-process cache as /api/air.
 */
export async function liveSnapshot(lat: number, lon: number, timeoutMs = 4000): Promise<LiveSnapshot | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const air = await Promise.race([
      getCurrentAir(lat, lon),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
    const v = air?.current.usAqi;
    if (v === null || v === undefined || !Number.isFinite(v)) return null;
    const cat = getCategory(v, "us");
    return { usAqi: Math.round(v), label: cat.label, color: cat.color, textColor: cat.textColor };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Title, description and Open Graph / Twitter tags with the live AQI when available. */
export async function cityMetadata(place: ResolvedPlace, page: "city" | "report"): Promise<Metadata> {
  const live = place.labelKind ? null : await liveSnapshot(place.latitude, place.longitude);
  const where = `${place.name}${place.subtitle ? `, ${place.subtitle}` : ""}`;
  const title = page === "report" ? `Air quality report: ${place.name}` : `Air quality in ${place.name}`;
  const description = live
    ? `${where}: US AQI ${live.usAqi} (${live.label}) right now. Live pollutants, history, forecast and health advice on AirIQ.`
    : `Live AQI, pollutant levels, history, forecast and health advice for ${where} on AirIQ.`;
  return {
    title,
    description,
    openGraph: { title: `${title} · AirIQ`, description, type: "website", siteName: "AirIQ" },
    twitter: { card: "summary_large_image", title: `${title} · AirIQ`, description },
  };
}
