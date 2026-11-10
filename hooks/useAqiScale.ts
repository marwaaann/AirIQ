"use client";

import { z } from "zod";

import { createStoredValue, useStoredValue } from "@/lib/storage";
import type { AqiScale } from "@/types/air";

export const scaleStore = createStoredValue<AqiScale>("airiq:aqi-scale", z.enum(["us", "eu"]), "us");

/** US EPA vs European AQI, persisted and shared across the whole app. */
export function useAqiScale(): [AqiScale, (s: AqiScale) => void] {
  return useStoredValue(scaleStore);
}
