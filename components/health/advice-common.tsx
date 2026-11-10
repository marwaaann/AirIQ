"use client";

import { useMemo } from "react";

import { useProfile } from "@/hooks/useProfile";
import { healthAdvice, type AdviceResult } from "@/lib/health-advice";
import type { ProfileId } from "@/lib/profiles";
import { localParts } from "@/lib/time";
import type { AqiScale } from "@/types/air";
import type { AirResponse } from "@/types/api";

export const DISCLAIMER = "General information, not medical advice.";

export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p role="note" className={`rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs ${className}`}>
      <strong>{DISCLAIMER}</strong> Guidance follows the US EPA AirNow Air Quality Guide (US AQI) or the EEA European Air Quality Index recommendations
      (European AQI), with WHO guideline values. If you have symptoms or a health condition, follow your doctor&rsquo;s advice.
    </p>
  );
}

/** Advice for the current reading and the saved profile (or `profileOverride`), or null if there is no index value. */
export function useAdvice(air: AirResponse | undefined, scale: AqiScale, profileOverride?: ProfileId): AdviceResult | null {
  const [saved] = useProfile();
  const profileId = profileOverride ?? saved.id;
  return useMemo(() => {
    if (!air) return null;
    const c = air.current;
    const aqi = scale === "us" ? c.usAqi : c.euAqi;
    if (aqi === null) return null;
    return healthAdvice({
      aqi,
      scale,
      dominant: scale === "us" ? c.dominantUs : c.dominantEu,
      pollutants: c.pollutants,
      profile: profileId,
      localHour: localParts(c.time, c.timezone).hour,
    });
  }, [air, scale, profileId]);
}
