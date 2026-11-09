"use client";

import { useEffect, useMemo } from "react";

import { AqiGauge } from "@/components/AqiGauge";
import { AqiScaleToggle } from "@/components/AqiScaleToggle";
import { FavoriteButton } from "@/components/FavoriteButton";
import { PollutantCard } from "@/components/PollutantCard";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { useAqiScale } from "@/hooks/useAqiScale";
import { useActiveCity, useAir } from "@/hooks/useCity";
import { useReverseLabel } from "@/hooks/useGeolocation";
import { POLLUTANT_INFO, POLLUTANT_ORDER } from "@/lib/aqi-categories";
import { accentStyle, headline } from "@/lib/aqi-display";
import { errorMessage } from "@/lib/fetcher";
import { formatCoords, makeCitySlug } from "@/lib/slug";
import type { AirResponse } from "@/types/api";
import type { AqiScale } from "@/types/air";
import type { SavedCity } from "@/types/city";

export interface CityPlace {
  slug: string;
  name: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
  isMyLocation: boolean;
}

function DashboardSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]" aria-busy="true">
      <div className="flex flex-col items-center gap-4 rounded-3xl border border-border bg-surface p-6">
        <Skeleton className="aspect-[2/1] w-full max-w-[22rem] rounded-t-full" label="Loading current air quality" />
        <Skeleton className="h-7 w-32 rounded-full" />
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {POLLUTANT_ORDER.map((p) => (
          <Skeleton key={p} className="h-52 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}

function CrossCheck({ data, scale }: { data: AirResponse; scale: AqiScale }) {
  if (scale !== "us") {
    return <p className="text-xs text-muted">The in-app EPA cross-check applies to the US AQI only.</p>;
  }
  const ours = data.epa.aqi2024;
  const theirs = data.current.usAqi;
  return (
    <details className="text-xs text-muted">
      <summary className="cursor-pointer select-none font-medium text-text">Cross-check: in-app EPA calculation</summary>
      <div className="mt-2 space-y-1">
        <p>
          AirIQ’s own EPA calculation (May 2024 breakpoints, 24 h particle / 8 h ozone and CO / 1 h NO₂ and SO₂ averages)
          gives <strong className="text-text">{ours ?? "n/a"}</strong>. The headline uses the source value,{" "}
          <strong className="text-text">{theirs ?? "n/a"}</strong>.
        </p>
        {ours !== null && theirs !== null && Math.abs(ours - theirs) > 5 ? (
          <p>The gap mostly comes from how the 8-hour ozone window is aligned. Both use the same raw model data.</p>
        ) : null}
      </div>
    </details>
  );
}

export function CityDashboard({ place }: { place: CityPlace }) {
  const [scale] = useAqiScale();
  const [, setActiveCity] = useActiveCity();
  const { data, error, isLoading, isValidating, mutate } = useAir(place.latitude, place.longitude);
  const { label, resolved } = useReverseLabel(place.latitude, place.longitude, place.isMyLocation);

  const name = place.isMyLocation ? label.name : place.name;
  const subtitle = place.isMyLocation ? label.subtitle : place.subtitle;
  const slug = place.isMyLocation && resolved ? makeCitySlug(label.name, place.latitude, place.longitude) : place.slug;

  const city: SavedCity = useMemo(
    () => ({ slug, name, subtitle, latitude: place.latitude, longitude: place.longitude }),
    [slug, name, subtitle, place.latitude, place.longitude],
  );

  // Remember as the active city.
  useEffect(() => {
    setActiveCity(city);
  }, [city, setActiveCity]);

  // Once a geolocated place has a real name, make the URL shareable without reloading.
  useEffect(() => {
    if (place.isMyLocation && resolved && window.location.pathname !== `/city/${slug}`) {
      window.history.replaceState(null, "", `/city/${slug}`);
    }
  }, [place.isMyLocation, resolved, slug]);

  const h = data ? headline(data.current, scale) : null;
  const recentByPollutant = useMemo(() => {
    const pts = data?.recent.points ?? [];
    return Object.fromEntries(POLLUTANT_ORDER.map((p) => [p, pts.map((x) => x.pollutants[p])])) as Record<
      (typeof POLLUTANT_ORDER)[number],
      (number | null)[]
    >;
  }, [data]);

  const noData =
    data !== undefined &&
    data.current.usAqi === null &&
    data.current.euAqi === null &&
    POLLUTANT_ORDER.every((p) => data.current.pollutants[p] === null);

  return (
    <div className="flex flex-col gap-6" style={accentStyle(h?.category ?? null)}>
      <header className="flex flex-col gap-3 border-b-4 border-accent pb-4 pt-2 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="truncate text-3xl font-bold tracking-tight sm:text-4xl">{name}</h1>
          <p className="text-sm text-muted">
            {subtitle ? `${subtitle} · ` : ""}
            {formatCoords(place.latitude, place.longitude)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AqiScaleToggle />
          <FavoriteButton city={city} />
        </div>
      </header>

      {error && !data ? (
        <ErrorState
          title="Couldn't load live air quality"
          message={errorMessage(error)}
          onRetry={() => void mutate()}
          retrying={isValidating}
        />
      ) : isLoading && !data ? (
        <DashboardSkeleton />
      ) : !data || noData ? (
        <EmptyState title="No air-quality data for this location">
          Open-Meteo did not return any readings for these coordinates. Try a nearby city.
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex flex-col gap-4">
            <div className="rounded-3xl border border-border bg-surface p-6">
              <AqiGauge
                value={h?.value ?? null}
                category={h?.category ?? null}
                scale={scale}
                time={data.current.time}
                timezone={data.current.timezone}
                onRefresh={() => void mutate()}
                refreshing={isValidating}
              />
            </div>
            <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4 text-sm">
              <dl className="grid grid-cols-2 gap-3">
                <div>
                  <dt className="text-xs text-muted">Main pollutant</dt>
                  <dd className="font-semibold">{h?.dominant ? POLLUTANT_INFO[h.dominant].short : "n/a"}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">UV index</dt>
                  <dd className="font-semibold">{data.current.uvIndex !== null ? data.current.uvIndex.toFixed(1) : "n/a"}</dd>
                </div>
              </dl>
              <CrossCheck data={data} scale={scale} />
            </div>
            {error ? (
              <ErrorState compact title="Refresh failed, showing the last successful reading" message={errorMessage(error)} onRetry={() => void mutate()} />
            ) : null}
          </div>

          <section aria-labelledby="pollutants-title" className="flex flex-col gap-3">
            <h2 id="pollutants-title" className="text-lg font-semibold">
              Pollutants
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {POLLUTANT_ORDER.map((p) => (
                <PollutantCard
                  key={p}
                  pollutant={p}
                  value={data.current.pollutants[p]}
                  subIndex={h?.subIndices[p]}
                  scale={scale}
                  dominant={h?.dominant === p}
                  recent={recentByPollutant[p]}
                />
              ))}
            </div>
          </section>
        </div>
      )}

      <section aria-labelledby="hf-title" className="rounded-2xl border border-dashed border-border p-6">
        <h2 id="hf-title" className="text-lg font-semibold">
          History and forecast
        </h2>
        <p className="mt-1 text-sm text-muted">
          7/30/90-day history, the 5-day forecast and the in-app trend model arrive in Phase 4.
        </p>
      </section>
    </div>
  );
}
