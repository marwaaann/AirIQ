/**
 * Shared-link view preferences. ?scale= and ?profile= apply to the view that
 * was opened ONLY: they are never written to saved settings unless the user
 * clicks "Save as my settings". Pure module (relative imports only).
 */

import { PROFILES, type ProfileId } from "./profiles.ts";
import type { Scale, SharedPrefs } from "./share.ts";

export interface StoredPrefs {
  scale: Scale;
  profile: ProfileId;
}

export interface PrefWriter<T> {
  set(value: T): void;
}

const SCALE_NAME: Record<Scale, string> = { us: "US AQI", eu: "European AQI" };

/** What the page shows: the link's value where given, otherwise the saved one. Never writes anything. */
export function effectivePrefs(override: SharedPrefs, stored: StoredPrefs): StoredPrefs & { fromLink: { scale: boolean; profile: boolean } } {
  return {
    scale: override.scale ?? stored.scale,
    profile: override.profile ?? stored.profile,
    fromLink: { scale: override.scale !== null && override.scale !== stored.scale, profile: override.profile !== null && override.profile !== stored.profile },
  };
}

/** "Viewing with European AQI / profile: Asthma or respiratory condition from a shared link", or null when the link matches saved settings. */
export function sharedViewNotice(override: SharedPrefs, stored: StoredPrefs): string | null {
  const e = effectivePrefs(override, stored);
  const parts: string[] = [];
  if (e.fromLink.scale) parts.push(SCALE_NAME[e.scale]);
  if (e.fromLink.profile) parts.push(`profile: ${PROFILES[e.profile].label}`);
  return parts.length ? `Viewing with ${parts.join(" / ")} from a shared link` : null;
}

/** "Save as my settings": the only place the link's values are persisted. Returns what was saved. */
export function saveSharedPrefs(override: SharedPrefs, stored: StoredPrefs, writers: { scale: PrefWriter<Scale>; profile: PrefWriter<ProfileId> }): Array<"scale" | "profile"> {
  const saved: Array<"scale" | "profile"> = [];
  if (override.scale && override.scale !== stored.scale) {
    writers.scale.set(override.scale);
    saved.push("scale");
  }
  if (override.profile && override.profile !== stored.profile) {
    writers.profile.set(override.profile);
    saved.push("profile");
  }
  return saved;
}
