/**
 * Shared-link view preferences. ?scale=, ?profile= and ?source= apply to the
 * view that was opened ONLY: they are never written to saved settings unless
 * the user clicks "Save as my settings". Pure module (relative imports only).
 */

import { DATA_SOURCE_LABEL, type DataSourceMode } from "./headline-source.ts";
import { PROFILES, type ProfileId } from "./profiles.ts";
import type { Scale, SharedPrefs } from "./share.ts";

export interface StoredPrefs {
  scale: Scale;
  profile: ProfileId;
  source: DataSourceMode;
}

export type PrefKey = "scale" | "profile" | "source";

export interface PrefWriter<T> {
  set(value: T): void;
}

const SCALE_NAME: Record<Scale, string> = { us: "US AQI", eu: "European AQI", in: "India NAQI" };

/** What the page shows: the link's value where given, otherwise the saved one. Never writes anything. */
export function effectivePrefs(override: SharedPrefs, stored: StoredPrefs): StoredPrefs & { fromLink: Record<PrefKey, boolean> } {
  return {
    scale: override.scale ?? stored.scale,
    profile: override.profile ?? stored.profile,
    source: override.source ?? stored.source,
    fromLink: {
      scale: override.scale !== null && override.scale !== stored.scale,
      profile: override.profile !== null && override.profile !== stored.profile,
      source: override.source !== null && override.source !== stored.source,
    },
  };
}

/** "Viewing with European AQI / profile: Asthma or respiratory condition from a shared link", or null when the link matches saved settings. */
export function sharedViewNotice(override: SharedPrefs, stored: StoredPrefs): string | null {
  const e = effectivePrefs(override, stored);
  const parts: string[] = [];
  if (e.fromLink.scale) parts.push(SCALE_NAME[e.scale]);
  if (e.fromLink.profile) parts.push(`profile: ${PROFILES[e.profile].label}`);
  if (e.fromLink.source) parts.push(`data source: ${DATA_SOURCE_LABEL[e.source]}`);
  return parts.length ? `Viewing with ${parts.join(" / ")} from a shared link` : null;
}

/** "Save as my settings": the only place the link's values are persisted. Returns what was saved. */
export function saveSharedPrefs(
  override: SharedPrefs,
  stored: StoredPrefs,
  writers: { scale: PrefWriter<Scale>; profile: PrefWriter<ProfileId>; source: PrefWriter<DataSourceMode> },
): PrefKey[] {
  const saved: PrefKey[] = [];
  if (override.scale && override.scale !== stored.scale) {
    writers.scale.set(override.scale);
    saved.push("scale");
  }
  if (override.profile && override.profile !== stored.profile) {
    writers.profile.set(override.profile);
    saved.push("profile");
  }
  if (override.source && override.source !== stored.source) {
    writers.source.set(override.source);
    saved.push("source");
  }
  return saved;
}
