"use client";

import { formatIndex, SCALE_NAME } from "@/lib/aqi-categories";
import { DIVERGENCE_THRESHOLD, type HeadlineSource } from "@/lib/headline-source";

/**
 * Plain notes under the headline: a visible "No nearby station data" (or why
 * stations are not used on this scale), and an explanation when stations and
 * the model differ by more than 25%.
 */
export function HeadlineNotes({ headline, modelUsAqi }: { headline: HeadlineSource; modelUsAqi: number | null }) {
  const s = headline.summary;
  const stationUs = s.freshCount >= 3 ? s.median : s.nearest?.value ?? null;
  const stationWhat = s.freshCount >= 3 ? `the median of ${s.freshCount} nearby stations` : s.nearest ? `the nearest station (${s.nearest.name.split(",")[0]})` : null;
  return (
    <div className="flex flex-col gap-2" data-testid="headline-notes">
      {headline.stationNote ? (
        <p role="status" className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs" data-testid="station-note">
          {headline.stationNote}
        </p>
      ) : null}
      {headline.showDivergenceNote && stationUs !== null && modelUsAqi !== null && stationWhat ? (
        <p className="rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs" data-testid="divergence-note">
          <strong>
            Stations and the model differ by {Math.round(Math.abs(headline.divergence ?? 0) * 100)}%
          </strong>{" "}
          (US AQI {formatIndex(stationUs, "us")} from {stationWhat} vs {formatIndex(modelUsAqi, "us")} from the model). The model estimates a
          ~10–40 km grid cell and smooths out local pollution; stations are direct measurements at one spot. More than{" "}
          {Math.round(DIVERGENCE_THRESHOLD * 100)}% apart, so both are shown.
          {headline.scale !== "us" ? ` The ${SCALE_NAME[headline.scale]} shown above comes from the model.` : ""}
        </p>
      ) : null}
    </div>
  );
}
