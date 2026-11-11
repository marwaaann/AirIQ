"use client";

import { useCallback } from "react";
import { z } from "@/lib/zod";

import { useViewOverride } from "@/hooks/useViewOverride";
import { createStoredValue, useStoredValue } from "@/lib/storage";
import type { AqiScale } from "@/types/air";

export const scaleStore = createStoredValue<AqiScale>("airiq:aqi-scale", z.enum(["us", "eu"]), "us");

/**
 * US EPA vs European AQI, persisted and shared across the whole app.
 * Inside a shared link's view (?scale=), that value is shown instead without
 * being saved. Choosing a scale saves it and drops the link's value.
 */
export function useAqiScale(): [AqiScale, (s: AqiScale) => void] {
  const [stored, setStored] = useStoredValue(scaleStore);
  const view = useViewOverride();
  const set = useCallback(
    (s: AqiScale) => {
      setStored(s);
      view?.clear(["scale"]);
    },
    [setStored, view],
  );
  return [view?.override.scale ?? stored, set];
}
