"use client";

import { z } from "zod";

import { createStoredValue, useStoredValue } from "@/lib/storage";
import { PROFILE_IDS, PROFILES, type Profile, type ProfileId } from "@/lib/profiles";

export const profileStore = createStoredValue<ProfileId>("airiq:profile", z.enum(PROFILE_IDS), "general");

/** The saved health profile (persisted, shared across the app). */
export function useProfile(): [Profile, (id: ProfileId) => void] {
  const [id, setId] = useStoredValue(profileStore);
  return [PROFILES[id], setId];
}
