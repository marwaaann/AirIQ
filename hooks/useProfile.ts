"use client";

import { useCallback } from "react";
import { z } from "@/lib/zod";

import { useViewOverride } from "@/hooks/useViewOverride";
import { createStoredValue, useStoredValue } from "@/lib/storage";
import { PROFILE_IDS, PROFILES, type Profile, type ProfileId } from "@/lib/profiles";

export const profileStore = createStoredValue<ProfileId>("airiq:profile", z.enum(PROFILE_IDS), "general");

/**
 * The saved health profile (persisted, shared across the app). Inside a
 * shared link's view (?profile=), that profile is shown instead without being
 * saved. Choosing a profile saves it and drops the link's value.
 */
export function useProfile(): [Profile, (id: ProfileId) => void] {
  const [stored, setStored] = useStoredValue(profileStore);
  const view = useViewOverride();
  const set = useCallback(
    (id: ProfileId) => {
      setStored(id);
      view?.clear(["profile"]);
    },
    [setStored, view],
  );
  return [PROFILES[view?.override.profile ?? stored], set];
}
