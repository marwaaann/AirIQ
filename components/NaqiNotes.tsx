"use client";

import { formatIndex } from "@/lib/aqi-categories";
import { placeClock } from "@/lib/format";
import { modelEstimateLine, naqiLabel, olderReadingText, type HeadlineSource } from "@/lib/headline-source";

/**
 * How the India NAQI was obtained, in the same words everywhere (city page,
 * compare, report):
 *  - "India NAQI, computed by AirIQ from station concentrations (median of N stations)";
 *  - "India NAQI, computed by AirIQ from model concentrations";
 *  - "India NAQI from stations unavailable" + the model value as a secondary
 *    "model estimate, likely lower than station readings here";
 * plus the consistency warning when a shown model NAQI is more than one
 * category below what the stations' US AQI implies.
 */
export function NaqiBasisNote({ headline, compact = false }: { headline: HeadlineSource; compact?: boolean }) {
  if (headline.scale !== "in") return null;
  const label = naqiLabel(headline);
  const estimate = modelEstimateLine(headline, (v) => formatIndex(v, "in"));
  const text = compact ? "text-xs" : "text-xs";
  return (
    <div className={`flex flex-col gap-1.5 ${compact ? "" : "items-center text-center"}`} data-testid="naqi-basis-note" data-basis={headline.naqiBasis ?? ""}>
      {headline.source === "unavailable" ? (
        <>
          <p className={`${compact ? "text-sm" : "text-base"} font-semibold`} data-testid="naqi-unavailable">
            {headline.naqiPending ? "Computing India NAQI from station concentrations…" : label}
          </p>
          {estimate ? (
            <p className={`${text} text-muted`} data-testid="naqi-model-estimate">
              {estimate}
            </p>
          ) : null}
        </>
      ) : (
        <p className={`${text} text-muted`} data-testid="naqi-basis">
          {label}. It may differ from CPCB&rsquo;s official bulletin.
          {headline.naqiBasis === "stations" ? " PM2.5/PM10 are 24-hour means; the gases are each station's latest hour." : ""}
        </p>
      )}
      {headline.source !== "unavailable" ? (
        <p className={`${text} text-muted`} data-testid="naqi-averaging-note">
          NAQI uses 24-hour averages for particles, so it can read higher than the latest hourly station values.
        </p>
      ) : null}
      {headline.consistencyWarning ? (
        <p role="note" className={`rounded-lg border-2 border-danger px-3 py-2 ${text} ${compact ? "" : "text-left"}`} data-testid="naqi-consistency-warning">
          <strong>Model NAQI likely too low here.</strong> {headline.consistencyWarning}
        </p>
      ) : null}
    </div>
  );
}

/**
 * "Last reading at Murthal, Sonipat (5.1 km): 187, 18:00 IST (4.6 h ago)":
 * the nearest station within 10 km when its reading is 3–12 hours old (not
 * used for the headline), with a note when it is more than 25% above it.
 */
export function OlderReadingLine({ headline, timeZone, compact = false }: { headline: HeadlineSource; timeZone: string; compact?: boolean }) {
  const o = headline.olderReading;
  if (!o) return null;
  return (
    <div className={`rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs ${compact ? "" : "text-left"}`} data-testid="older-reading">
      <p>
        <span className="font-semibold">{olderReadingText(o, (iso) => placeClock(iso, timeZone), headline.scale !== "us")}</span>
        <span className="text-muted"> · US AQI as reported; older than 3 h, so not used for the headline.</span>
      </p>
      {o.aboveReference ? (
        <p className="mt-1" data-testid="older-reading-note">
          This reading is more than 25% above {headline.scale === "us" ? "the headline" : "the model's US AQI"}: the model may under-estimate current pollution.
        </p>
      ) : null}
    </div>
  );
}
