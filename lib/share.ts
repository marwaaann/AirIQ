/**
 * Shareable city links. A link reproduces the city, tab, range, AQI scale and
 * health profile exactly. Pure module (relative imports only).
 */

import { PROFILE_IDS, type ProfileId } from "./profiles.ts";

export const CITY_TABS = ["overview", "forecast", "history", "health", "weather"] as const;
export type CityTab = (typeof CITY_TABS)[number];
export const RANGES = ["7", "30", "90"] as const;
export type RangeParam = (typeof RANGES)[number];
export type Scale = "us" | "eu";

export interface ShareState {
  slug: string;
  tab: CityTab;
  range: RangeParam;
  scale: Scale;
  profile: ProfileId;
}

/** Build the full city-page URL. Every parameter is written explicitly, so the link does not depend on the recipient's saved settings. */
export function cityShareUrl(origin: string, s: ShareState, page: "city" | "report" = "city"): string {
  const q = new URLSearchParams();
  if (page === "city") q.set("tab", s.tab);
  q.set("range", s.range);
  q.set("scale", s.scale);
  q.set("profile", s.profile);
  const path = page === "city" ? `/city/${encodeURIComponent(s.slug)}` : `/city/${encodeURIComponent(s.slug)}/report`;
  return `${origin.replace(/\/+$/, "")}${path}?${q}`;
}

export interface SharedPrefs {
  scale: Scale | null;
  profile: ProfileId | null;
}

/** Read and validate ?scale= and ?profile=; invalid or missing values become null. */
export function parseSharedPrefs(params: URLSearchParams): SharedPrefs {
  const scale = params.get("scale");
  const profile = params.get("profile");
  return {
    scale: scale === "us" || scale === "eu" ? scale : null,
    profile: (PROFILE_IDS as readonly string[]).includes(profile ?? "") ? (profile as ProfileId) : null,
  };
}

/** Valid `range` parameter, or the fallback. */
export function parseRange(v: string | null, fallback: RangeParam = "7"): RangeParam {
  return (RANGES as readonly string[]).includes(v ?? "") ? (v as RangeParam) : fallback;
}
