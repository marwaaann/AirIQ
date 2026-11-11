"use client";

import { useCallback } from "react";
import { z } from "@/lib/zod";

import { createStoredValue, useStoredValue } from "@/lib/storage";
import { SavedCitySchema, type SavedCity } from "@/types/city";

export const MAX_FAVORITES = 12;
const EMPTY: SavedCity[] = [];

const favoritesStore = createStoredValue<SavedCity[]>("airiq:favorites", z.array(SavedCitySchema).max(50), EMPTY);

/** Two places count as the same favorite if they are within ~1 km. */
const samePlace = (a: SavedCity, b: { latitude: number; longitude: number }) =>
  Math.abs(a.latitude - b.latitude) < 0.01 && Math.abs(a.longitude - b.longitude) < 0.01;

export function useFavorites() {
  const [favorites, setFavorites] = useStoredValue(favoritesStore);

  const isFavorite = useCallback(
    (p: { latitude: number; longitude: number }) => favorites.some((f) => samePlace(f, p)),
    [favorites],
  );

  const add = useCallback(
    (city: SavedCity) =>
      setFavorites((prev) => (prev.some((f) => samePlace(f, city)) ? prev : [city, ...prev].slice(0, MAX_FAVORITES))),
    [setFavorites],
  );

  const remove = useCallback(
    (p: { latitude: number; longitude: number }) => setFavorites((prev) => prev.filter((f) => !samePlace(f, p))),
    [setFavorites],
  );

  const toggle = useCallback(
    (city: SavedCity) =>
      setFavorites((prev) =>
        prev.some((f) => samePlace(f, city))
          ? prev.filter((f) => !samePlace(f, city))
          : [city, ...prev].slice(0, MAX_FAVORITES),
      ),
    [setFavorites],
  );

  return { favorites, isFavorite, add, remove, toggle };
}
