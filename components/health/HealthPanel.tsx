"use client";

import Link from "next/link";

import { CategoryBadge } from "@/components/CategoryBadge";
import { Disclaimer, useAdvice } from "@/components/health/advice-common";
import { WindowFinder } from "@/components/health/WindowFinder";
import { ProfileSelector } from "@/components/ProfileSelector";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { StaleNotice } from "@/components/StaleNotice";
import { staleMetaOf } from "@/lib/stale";
import { useHeadline } from "@/hooks/useHeadline";
import { useProfile } from "@/hooks/useProfile";
import { formatIndex, SCALE_NAME } from "@/lib/aqi-categories";
import { sourceLabel } from "@/lib/headline-source";
import { errorMessage } from "@/lib/fetcher";
import type { Recommendation } from "@/lib/health-advice";
import type { AqiScale } from "@/types/air";

function RecList({ items }: { items: Recommendation[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((r) => (
        <li key={r.id} className="text-sm">
          <p>{r.text}</p>
          <p className="text-xs text-muted">Source: {r.basis}</p>
        </li>
      ))}
    </ul>
  );
}

export function HealthPanel({ lat, lon, scale, alertHref }: { lat: number; lon: number; scale: AqiScale; alertHref: string | null }) {
  const { air, headline } = useHeadline(lat, lon, scale);
  const { data, error, isLoading, isValidating, mutate } = air;
  const advice = useAdvice(data, scale, headline);
  const [profile] = useProfile();

  return (
    <section aria-labelledby="health-title" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 id="health-title" className="text-lg font-semibold">
          Health advice
        </h2>
        <div className="w-full sm:w-72">
          <ProfileSelector />
        </div>
      </div>
      <Disclaimer />
      {data ? <StaleNotice meta={staleMetaOf(data)} timeZone={data.current.timezone} onRetry={() => void mutate()} retrying={isValidating} /> : null}

      {error && !data ? (
        <ErrorState title="Couldn't load current air quality" message={errorMessage(error)} onRetry={() => void mutate()} retrying={isValidating} />
      ) : isLoading && !data ? (
        <Skeleton className="h-64 rounded-2xl" label="Loading health advice" />
      ) : !advice ? (
        <EmptyState title={scale === "in" ? "Not enough data for NAQI" : "No index value for this location"}>
          {scale === "in" ? (data?.current.inReason ?? "Health advice needs a current NAQI value.") : "Health advice needs a current AQI reading."}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <CategoryBadge category={advice.category} />
              <span className="text-sm text-muted">for the {profile.label} profile</span>
            </div>
            <p className="text-lg font-semibold">{advice.headline.text}</p>
            <p className="text-xs text-muted">Source: {advice.headline.basis}</p>
            {headline && headline.value !== null ? (
              <p className="text-xs text-muted" data-testid="advice-source">
                For {SCALE_NAME[scale]} {formatIndex(headline.value, scale)} from {sourceLabel(headline)}.
              </p>
            ) : headline && headline.source === "unavailable" && headline.stationUsAqi !== null ? (
              <p className="text-xs text-muted" data-testid="advice-source">
                For US AQI {formatIndex(headline.stationUsAqi, "us")} from the nearby stations: India NAQI from stations is unavailable, and the
                model&rsquo;s NAQI is likely lower than station readings here.
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-labelledby="h-outdoor" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 lg:row-span-2">
              <h3 id="h-outdoor" className="font-semibold">
                Outdoor activity
              </h3>
              {advice.activity.map((g) => (
                <div key={g.kind} className="flex flex-col gap-1.5">
                  <h4 className="text-sm font-semibold text-muted">{g.label}</h4>
                  <RecList items={g.items} />
                </div>
              ))}
            </section>
            <section aria-labelledby="h-indoor" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
              <h3 id="h-indoor" className="font-semibold">
                Indoor air
              </h3>
              <RecList items={advice.indoor} />
            </section>
            <section aria-labelledby="h-protect" className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
              <h3 id="h-protect" className="font-semibold">
                Protection
              </h3>
              <RecList items={advice.protection} />
              {advice.info.length ? <RecList items={advice.info} /> : null}
            </section>
          </div>

          <section aria-labelledby="h-why" className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 text-sm">
            <h3 id="h-why" className="font-semibold">
              Why this advice
            </h3>
            <p>{advice.why}</p>
            <details>
              <summary className="cursor-pointer text-xs font-medium">All sources used ({advice.bases.length})</summary>
              <ul className="mt-2 list-disc pl-5 text-xs text-muted">
                {advice.bases.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </details>
          </section>
        </>
      )}

      <WindowFinder lat={lat} lon={lon} scale={scale} headline={headline} />

      {alertHref ? (
        <p className="text-sm">
          <Link href={alertHref} className="font-semibold text-brand underline underline-offset-4">
            Create an alert for this city
          </Link>{" "}
          <span className="text-muted">(uses your profile&rsquo;s threshold)</span>
        </p>
      ) : null}
    </section>
  );
}
