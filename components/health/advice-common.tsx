"use client";

import { useMemo } from "react";

import { useProfile } from "@/hooks/useProfile";
import { currentIndex } from "@/lib/aqi-display";
import { healthAdvice, type AdviceResult } from "@/lib/health-advice";
import type { HeadlineSource } from "@/lib/headline-source";
import type { ProfileId } from "@/lib/profiles";
import { localParts } from "@/lib/time";
import type { AqiScale, Pollutant } from "@/types/air";
import type { AirResponse } from "@/types/api";

export const DISCLAIMER = "General information, not medical advice.";

export function Disclaimer({ className = "" }: { className?: string }) {
  return (
    <p role="note" className={`rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs ${className}`}>
      <strong>{DISCLAIMER}</strong> Guidance follows the US EPA AirNow Air Quality Guide (US AQI), the EEA European Air Quality Index recommendations
      (European AQI) or CPCB&rsquo;s National AQI health statements (India NAQI), with WHO guideline values. If you have symptoms or a health
      condition, follow your doctor&rsquo;s advice.
    </p>
  );
}

function dominantFor(air: AirResponse, scale: AqiScale): Pollutant | null {
  const c = air.current;
  return scale === "us" ? c.dominantUs : scale === "eu" ? c.dominantEu : c.dominantIn;
}

/** Advice for an explicit index value (used for the station-based episode check). */
export function adviceFor(air: AirResponse, scale: AqiScale, aqi: number, profile: ProfileId): AdviceResult {
  const c = air.current;
  return healthAdvice({
    aqi,
    scale,
    dominant: dominantFor(air, scale),
    pollutants: c.pollutants,
    profile,
    localHour: localParts(c.time, c.timezone).hour,
  });
}

/**
 * Advice for the headline in effect (station median, nearest station or
 * model; see lib/headline-source.ts) and the saved profile (or
 * `profileOverride`). Null when there is no index value.
 */
export function useAdvice(
  air: AirResponse | undefined,
  scale: AqiScale,
  headline: HeadlineSource | null = null,
  profileOverride?: ProfileId,
): AdviceResult | null {
  const [saved] = useProfile();
  const profileId = profileOverride ?? saved.id;
  const value = headline ? headline.value : air ? currentIndex(air.current, scale) : null;
  return useMemo(() => {
    if (!air || value === null) return null;
    return adviceFor(air, scale, value, profileId);
  }, [air, scale, value, profileId]);
}
