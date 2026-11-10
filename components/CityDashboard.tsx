"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";

import { AqiGauge } from "@/components/AqiGauge";
import { AqiScaleToggle } from "@/components/AqiScaleToggle";
import { AskAirIQ } from "@/components/assistant/AskAirIQ";
import { CigaretteEquivalent } from "@/components/CigaretteEquivalent";
import { FavoriteButton } from "@/components/FavoriteButton";
import { AdviceCard } from "@/components/health/AdviceCard";
import { HealthPanel } from "@/components/health/HealthPanel";
import { PollutantCard } from "@/components/PollutantCard";
import { ShareButton } from "@/components/ShareButton";
import { SharedViewParams } from "@/components/SharedViewParams";
import { EmptyState, ErrorState, Skeleton } from "@/components/states";
import { useAqiScale } from "@/hooks/useAqiScale";
import { useActiveCity, useAir } from "@/hooks/useCity";
import { useReverseLabel } from "@/hooks/useGeolocation";
import { useUrlParam } from "@/hooks/useUrlParam";
import { useProfile } from "@/hooks/useProfile";
import { POLLUTANT_INFO, POLLUTANT_ORDER } from "@/lib/aqi-categories";
import { accentStyle, headline } from "@/lib/aqi-display";
import { errorMessage } from "@/lib/fetcher";
import { CITY_TABS, RANGES, cityShareUrl, type CityTab, type RangeParam } from "@/lib/share";
import { formatCoords, makeCitySlug, type LabelKind } from "@/lib/slug";
import type { AirResponse } from "@/types/api";
import type { AqiScale } from "@/types/air";
import type { SavedCity } from "@/types/city";

/** Chart code is lazy-loaded so the Overview tab stays light. */
const ForecastPanel = dynamic(() => import("@/components/forecast/ForecastPanel"), {
  ssr: false,
  loading: () => <Skeleton className="h-96 rounded-2xl" label="Loading forecast" />,
});
const WeatherPanel = dynamic(() => import("@/components/weather/WeatherPanel"), {
  ssr: false,
  loading: () => <Skeleton className="h-96 rounded-2xl" label="Loading weather analysis" />,
});
const HistoryPanel = dynamic(() => import("@/components/history/HistoryPanel"), {
  ssr: false,
  loading: () => <Skeleton className="h-96 rounded-2xl" label="Loading history" />,
});

const TABS = CITY_TABS;
type Tab = CityTab;
const TAB_LABEL: Record<Tab, string> = { overview: "Overview", forecast: "Forecast", history: "History", health: "Health", weather: "Weather" };

function CityTabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ overview: null, forecast: null, history: null, health: null, weather: null });
  function onKey(e: KeyboardEvent<HTMLButtonElement>, t: Tab) {
    const i = TABS.indexOf(t);
    let next: Tab | null = null;
    if (e.key === "ArrowRight") next = TABS[(i + 1) % TABS.length];
    else if (e.key === "ArrowLeft") next = TABS[(i + TABS.length - 1) % TABS.length];
    else if (e.key === "Home") next = TABS[0];
    else if (e.key === "End") next = TABS[TABS.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next);
    refs.current[next]?.focus();
  }
  return (
    <div role="tablist" aria-label="City views" className="flex gap-1 overflow-x-auto overflow-y-hidden border-b border-border [scrollbar-width:none]">
      {TABS.map((t) => (
        <button
          key={t}
          ref={(el) => {
            refs.current[t] = el;
          }}
          type="button"
          role="tab"
          id={`tab-${t}`}
          aria-selected={tab === t}
          aria-controls={`panel-${t}`}
          tabIndex={tab === t ? 0 : -1}
          onClick={() => onChange(t)}
          onKeyDown={(e) => onKey(e, t)}
          className={`-mb-px shrink-0 border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
            tab === t ? "border-text text-text" : "border-transparent text-muted hover:text-text"
          }`}
        >
          {TAB_LABEL[t]}
        </button>
      ))}
    </div>
  );
}

export interface CityPlace {
  slug: string;
  name: string;
  subtitle?: string;
  latitude: number;
  longitude: number;
  labelKind: LabelKind | null;
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
  const { label, resolved } = useReverseLabel(place.latitude, place.longitude, place.labelKind);
  const [tab, setTab] = useUrlParam<Tab>("tab", TABS, "overview");
  const [profile] = useProfile();
  const [range] = useUrlParam<RangeParam>("range", RANGES, "7");

  const name = place.labelKind ? label.name : place.name;
  const subtitle = place.labelKind ? label.subtitle : place.subtitle;
  const slug = place.labelKind && resolved ? makeCitySlug(label.name, place.latitude, place.longitude) : place.slug;
  const chatContext = useMemo(
    () => ({ city: name, lat: place.latitude, lon: place.longitude, profile: profile.id, scale }),
    [name, place.latitude, place.longitude, profile.id, scale],
  );

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
    if (place.labelKind && resolved && window.location.pathname !== `/city/${slug}`) {
      window.history.replaceState(null, "", `/city/${slug}${window.location.search}`);
    }
  }, [place.labelKind, resolved, slug]);

  const h = data ? headline(data.current, scale) : null;
  const recentByPollutant = useMemo(() => {
    const pts = data?.recent.points ?? [];
    return Object.fromEntries(POLLUTANT_ORDER.map((p) => [p, pts.map((x) => x.pollutants[p])])) as Record<
      (typeof POLLUTANT_ORDER)[number],
      (number | null)[]
    >;
  }, [data]);

  // Prefilled "create alert" link (needs the city's time zone from the API).
  const alertHref = data
    ? `/alerts?${new URLSearchParams({
        new: "1",
        name,
        lat: place.latitude.toFixed(4),
        lon: place.longitude.toFixed(4),
        tz: data.current.timezone,
        slug,
      })}`
    : null;

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
        <div className="flex flex-wrap items-center gap-2">
          <AqiScaleToggle />
          <FavoriteButton city={city} />
          <ShareButton
            title={`Air quality in ${name} · AirIQ`}
            text={h?.value !== null && h?.value !== undefined && h.category ? `${name}: ${h.scaleLabel} ${h.value} (${h.category.label})` : `Air quality in ${name}`}
            getUrl={() => cityShareUrl(window.location.origin, { slug, tab, range, scale, profile: profile.id })}
          />
          <Link
            href={`/city/${slug}/report?${new URLSearchParams({ range, scale, profile: profile.id })}`}
            className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
            data-testid="report-link"
          >
            Report
          </Link>
          {alertHref ? (
            <Link
              href={alertHref}
              className="inline-flex h-10 items-center rounded-lg border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2"
            >
              Create alert
            </Link>
          ) : null}
        </div>
      </header>

      <SharedViewParams />
      <CityTabs tab={tab} onChange={setTab} />

      {tab === "overview" ? (
      <div role="tabpanel" id="panel-overview" aria-labelledby="tab-overview">
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
            <AdviceCard air={data} scale={scale} onMore={() => setTab("health")} />
            <CigaretteEquivalent lat={place.latitude} lon={place.longitude} />
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
      </div>
      ) : null}

      {tab === "forecast" ? (
        <div role="tabpanel" id="panel-forecast" aria-labelledby="tab-forecast">
          <ForecastPanel lat={place.latitude} lon={place.longitude} scale={scale} />
        </div>
      ) : null}

      {tab === "health" ? (
        <div role="tabpanel" id="panel-health" aria-labelledby="tab-health">
          <HealthPanel lat={place.latitude} lon={place.longitude} scale={scale} alertHref={alertHref} />
        </div>
      ) : null}

      {tab === "weather" ? (
        <div role="tabpanel" id="panel-weather" aria-labelledby="tab-weather">
          <WeatherPanel lat={place.latitude} lon={place.longitude} />
        </div>
      ) : null}

      {tab === "history" ? (
        <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
          <HistoryPanel lat={place.latitude} lon={place.longitude} scale={scale} />
        </div>
      ) : null}
      <AskAirIQ
        chatId={`city:${slug}`}
        context={chatContext}
        contextLabel={`${name} · ${profile.label} profile · ${scale === "us" ? "US AQI" : "European AQI"}`}
      />
    </div>
  );
}
