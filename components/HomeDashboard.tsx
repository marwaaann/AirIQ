"use client";

import Link from "next/link";

import { AqiScaleToggle } from "@/components/AqiScaleToggle";
import { CityAqiCard } from "@/components/CityAqiCard";
import { CitySearch } from "@/components/CitySearch";
import { StarIcon } from "@/components/icons";
import { LocateButton } from "@/components/LocateButton";
import { EmptyState, Skeleton } from "@/components/states";
import { useActiveCity } from "@/hooks/useCity";
import { useFavorites } from "@/hooks/useFavorites";
import { useHydrated } from "@/lib/storage";
import { makeCitySlug } from "@/lib/slug";
import type { SavedCity } from "@/types/city";

/** Coordinates only (not data); readings are always fetched live. */
const POPULAR: SavedCity[] = [
  { name: "Delhi", subtitle: "Delhi, India", latitude: 28.6139, longitude: 77.209 },
  { name: "Mumbai", subtitle: "Maharashtra, India", latitude: 19.076, longitude: 72.8777 },
  { name: "London", subtitle: "England, United Kingdom", latitude: 51.5072, longitude: -0.1276 },
  { name: "New York", subtitle: "New York, United States", latitude: 40.7128, longitude: -74.006 },
  { name: "Beijing", subtitle: "Beijing, China", latitude: 39.9042, longitude: 116.4074 },
  { name: "Los Angeles", subtitle: "California, United States", latitude: 34.0522, longitude: -118.2437 },
].map((c) => ({ ...c, slug: makeCitySlug(c.name, c.latitude, c.longitude) }));

const GRID = "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6";

export function HomeDashboard() {
  const { favorites, remove } = useFavorites();
  const [activeCity] = useActiveCity();
  const hydrated = useHydrated();

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="hero-title" className="flex flex-col items-center gap-5 pt-8 text-center sm:pt-14">
        <h1 id="hero-title" className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
          How clean is the air you breathe?
        </h1>
        <p className="max-w-xl text-balance text-muted">
          Live air quality for any city on Earth, from the Copernicus (CAMS) model via Open-Meteo. Search a city or use
          your location.
        </p>
        <div className="flex w-full max-w-2xl flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex-1">
            <CitySearch variant="hero" />
          </div>
          <LocateButton />
        </div>
        {hydrated && activeCity ? (
          <p className="text-sm text-muted">
            Last viewed:{" "}
            <Link prefetch={false} href={`/city/${activeCity.slug}`} className="font-medium text-text underline underline-offset-4">
              {activeCity.name}
            </Link>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="fav-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="fav-title" className="text-lg font-semibold">
            Your favorites
          </h2>
          <AqiScaleToggle />
        </div>
        {!hydrated ? (
          <div className={GRID}>
            <Skeleton className="h-36" label="Loading favorites" />
          </div>
        ) : favorites.length === 0 ? (
          <EmptyState title="No favorite cities yet" icon={<StarIcon size={22} />}>
            Open any city and tap the star to pin it here with its live AQI.
          </EmptyState>
        ) : (
          <ul className={GRID}>
            {favorites.map((c) => (
              <li key={c.slug} className="h-full">
                <CityAqiCard city={c} onRemove={() => remove(c)} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="popular-title" className="flex flex-col gap-3">
        <h2 id="popular-title" className="text-lg font-semibold">
          Popular cities
        </h2>
        <ul className={GRID}>
          {POPULAR.map((c) => (
            <li key={c.slug} className="h-full">
              <CityAqiCard city={c} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
