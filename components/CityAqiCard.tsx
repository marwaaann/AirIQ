"use client";

import Link from "next/link";

import { CategoryBadge } from "@/components/CategoryBadge";
import { ErrorState, Skeleton } from "@/components/states";
import { StaleNotice } from "@/components/StaleNotice";
import { useAqiScale } from "@/hooks/useAqiScale";
import { useAir } from "@/hooks/useCity";
import { headline } from "@/lib/aqi-display";
import { errorMessage } from "@/lib/fetcher";
import { staleMetaOf } from "@/lib/stale";
import type { SavedCity } from "@/types/city";

/** Compact live-AQI card for favorites and popular cities. */
export function CityAqiCard({ city, onRemove }: { city: SavedCity; onRemove?: () => void }) {
  const [scale] = useAqiScale();
  const { data, error, isLoading, isValidating, mutate } = useAir(city.latitude, city.longitude);

  if (error && !data) {
    return (
      <div className="flex min-h-36 flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
        <p className="truncate font-semibold">{city.name}</p>
        <ErrorState compact title="Data unavailable" message={errorMessage(error)} onRetry={() => void mutate()} retrying={isValidating} />
      </div>
    );
  }

  if (isLoading && !data) {
    return (
      <div className="flex h-36 flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
        <Skeleton className="h-4 w-2/3" label={`Loading air quality for ${city.name}`} />
        <Skeleton className="h-10 w-16" />
        <Skeleton className="h-5 w-24" />
      </div>
    );
  }

  if (!data) return null;

  const h = headline(data.current, scale);
  return (
    <div className="group relative h-full">
      {/* No prefetch: prefetching a city page renders it on the server, which costs
          upstream API calls (geocoding, live AQI) for pages that may never be opened. */}
      <Link
        href={`/city/${city.slug}`}
        prefetch={false}
        className="flex h-full min-h-36 flex-col gap-2 overflow-hidden rounded-2xl border border-border bg-surface p-4 transition-shadow hover:shadow-md"
      >
        <span
          aria-hidden
          className={`absolute inset-y-0 left-0 w-1.5 ${h.category ? `aqi-pattern-${h.category.pattern}` : ""}`}
          style={{ backgroundColor: h.category?.color ?? "var(--border)" }}
        />
        <div className="min-w-0 pr-8">
          <p className="truncate font-semibold">{city.name}</p>
          {city.subtitle ? <p className="truncate text-xs text-muted">{city.subtitle}</p> : null}
        </div>
        {/* The visible text is the link's name (WCAG 2.5.3); the scale is added for screen readers. */}
        <p className="font-mono text-4xl font-bold tabular-nums">
          <span className="sr-only">{h.scaleLabel} </span>
          {h.value !== null ? Math.round(h.value) : "n/a"}
        </p>
        {h.category ? <CategoryBadge category={h.category} size="sm" /> : <span className="text-xs text-muted">No index</span>}
        <StaleNotice compact meta={staleMetaOf(data)} timeZone={data.current.timezone} />
      </Link>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${city.name} from favorites`}
          className="absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-2 hover:text-text"
        >
          <span aria-hidden>✕</span>
        </button>
      ) : null}
    </div>
  );
}
