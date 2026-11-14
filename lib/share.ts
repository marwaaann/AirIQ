/**
 * Shareable city links. A link reproduces the city, tab, range, AQI scale,
 * health profile and data source exactly. Pure module (relative imports only).
 */

import { DATA_SOURCE_MODES, type DataSourceMode } from "./headline-source.ts";
import { PROFILE_IDS, type ProfileId } from "./profiles.ts";

export const CITY_TABS = ["overview", "forecast", "history", "health", "weather"] as const;
export type CityTab = (typeof CITY_TABS)[number];
export const RANGES = ["7", "30", "90"] as const;
export type RangeParam = (typeof RANGES)[number];
export type Scale = "us" | "eu" | "in";
export const SCALE_PARAMS: readonly Scale[] = ["us", "eu", "in"];

export interface ShareState {
  slug: string;
  tab: CityTab;
  range: RangeParam;
  scale: Scale;
  profile: ProfileId;
  source: DataSourceMode;
}

/** Build the full city-page URL. Every parameter is written explicitly, so the link does not depend on the recipient's saved settings. */
export function cityShareUrl(origin: string, s: ShareState, page: "city" | "report" = "city"): string {
  const q = new URLSearchParams();
  if (page === "city") q.set("tab", s.tab);
  q.set("range", s.range);
  q.set("scale", s.scale);
  q.set("profile", s.profile);
  q.set("source", s.source);
  const path = page === "city" ? `/city/${encodeURIComponent(s.slug)}` : `/city/${encodeURIComponent(s.slug)}/report`;
  return `${origin.replace(/\/+$/, "")}${path}?${q}`;
}

export interface SharedPrefs {
  scale: Scale | null;
  profile: ProfileId | null;
  source: DataSourceMode | null;
}

/** Read and validate ?scale=, ?profile= and ?source=; invalid or missing values become null. */
export function parseSharedPrefs(params: URLSearchParams): SharedPrefs {
  const scale = params.get("scale");
  const profile = params.get("profile");
  const source = params.get("source");
  return {
    scale: (SCALE_PARAMS as readonly string[]).includes(scale ?? "") ? (scale as Scale) : null,
    profile: (PROFILE_IDS as readonly string[]).includes(profile ?? "") ? (profile as ProfileId) : null,
    source: (DATA_SOURCE_MODES as readonly string[]).includes(source ?? "") ? (source as DataSourceMode) : null,
  };
}

/** Valid `range` parameter, or the fallback. */
export function parseRange(v: string | null, fallback: RangeParam = "7"): RangeParam {
  return (RANGES as readonly string[]).includes(v ?? "") ? (v as RangeParam) : fallback;
}
