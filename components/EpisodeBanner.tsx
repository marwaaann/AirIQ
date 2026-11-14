"use client";

import { useMemo } from "react";

import { adviceFor, DISCLAIMER } from "@/components/health/advice-common";
import { AlertIcon } from "@/components/icons";
import { useProfile } from "@/hooks/useProfile";
import { formatIndex, SCALE_NAME } from "@/lib/aqi-categories";
import { episodeActions, type AdviceResult } from "@/lib/health-advice";
import { sourceLabel, type HeadlineSource } from "@/lib/headline-source";
import type { AqiScale } from "@/types/air";
import type { AirResponse } from "@/types/api";

/** Very Unhealthy / Very poor and worse share rank 4+ on every scale. */
export const EPISODE_RANK = 4;
/** US AQI where "Very Unhealthy" starts. */
export const EPISODE_US_AQI = 201;

export interface EpisodeTrigger {
  advice: AdviceResult;
  scale: AqiScale;
  value: number;
  basis: string;
}

/**
 * When to show the banner: the headline on the active scale is Very Unhealthy
 * (US ≥ 201), Very poor / Severe (NAQI) or Very poor and worse (EU), OR the
 * nearby stations (US AQI) are at 201+ while the headline comes from the
 * model (another scale, or the "Model only" setting). The station check stops
 * a smoother model value from hiding an episode.
 */
export function episodeTrigger(air: AirResponse, scale: AqiScale, headline: HeadlineSource, advice: AdviceResult | null, profile: Parameters<typeof adviceFor>[3]): EpisodeTrigger | null {
  if (advice && headline.value !== null && advice.rank >= EPISODE_RANK) {
    return { advice, scale, value: headline.value, basis: `${SCALE_NAME[scale]} ${formatIndex(headline.value, scale)} (${sourceLabel(headline)})` };
  }
  // Stations not driving the headline (another scale, or "Model only"): still warn when they read 201+.
  if (scale !== "us" || headline.source === "model") {
    const s = headline.summary;
    const stationUs = s.freshCount >= 3 ? s.median : s.nearest && s.nearest.distanceKm <= 10 ? s.nearest.value : null;
    if (stationUs !== null && stationUs >= EPISODE_US_AQI) {
      const label = s.freshCount >= 3 ? `median of ${s.freshCount} stations` : `nearest station, ${s.nearest?.name}`;
      return { advice: adviceFor(air, "us", stationUs, profile), scale: "us", value: stationUs, basis: `US AQI ${formatIndex(stationUs, "us")} (${label})` };
    }
  }
  return null;
}

/** Prominent episode banner with the most important action(s) from the health rules and their basis. */
export function EpisodeBanner({ air, scale, headline, advice }: { air: AirResponse; scale: AqiScale; headline: HeadlineSource; advice: AdviceResult | null }) {
  const [profile] = useProfile();
  const trigger = useMemo(() => episodeTrigger(air, scale, headline, advice, profile.id), [air, scale, headline, advice, profile.id]);
  if (!trigger) return null;
  const actions = episodeActions(trigger.advice);
  return (
    <section
      role="alert"
      aria-labelledby="episode-title"
      className="flex flex-col gap-2 rounded-2xl border-4 px-4 py-3"
      style={{ borderColor: trigger.advice.category.color, backgroundColor: "var(--surface)" }}
      data-testid="episode-banner"
    >
      <div className="flex items-start gap-3">
        <AlertIcon size={24} className="mt-0.5 shrink-0 text-danger" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id="episode-title" className="text-lg font-bold">
            Pollution episode: {trigger.advice.category.label}
          </h2>
          <p className="text-xs text-muted">Based on {trigger.basis}.</p>
          <ul className="flex flex-col gap-1.5">
            {actions.map((a) => (
              <li key={a.id}>
                <p className="font-semibold">{a.text}</p>
                <p className="text-xs text-muted">Source: {a.basis}</p>
              </li>
            ))}
          </ul>
          <p className="text-xs font-medium">{DISCLAIMER}</p>
        </div>
      </div>
    </section>
  );
}
