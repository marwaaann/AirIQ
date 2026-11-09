"use client";

import { StarIcon } from "@/components/icons";
import { useFavorites } from "@/hooks/useFavorites";
import { useHydrated } from "@/lib/storage";
import type { SavedCity } from "@/types/city";

export function FavoriteButton({ city }: { city: SavedCity }) {
  const { isFavorite, toggle } = useFavorites();
  const hydrated = useHydrated();
  const fav = hydrated && isFavorite(city);
  return (
    <button
      type="button"
      onClick={() => toggle(city)}
      aria-pressed={fav}
      aria-label={fav ? `Remove ${city.name} from favorites` : `Add ${city.name} to favorites`}
      title={fav ? "Remove from favorites" : "Add to favorites"}
      className={`inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface hover:bg-surface-2 ${fav ? "text-amber-500" : "text-muted"}`}
    >
      <StarIcon filled={fav} size={20} />
    </button>
  );
}
