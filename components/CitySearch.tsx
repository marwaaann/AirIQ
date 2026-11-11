"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type KeyboardEvent } from "react";
import useSWR from "swr";

import { SearchIcon } from "@/components/icons";
import { useActiveCity } from "@/hooks/useCity";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { apiFetch, errorMessage } from "@/lib/fetcher";
import { placeSubtitle } from "@/lib/place";
import { makeCitySlug } from "@/lib/slug";
import type { GeoLocation } from "@/types/air";
import type { GeocodeResponse } from "@/types/api";

interface CitySearchProps {
  variant?: "hero" | "compact";
  /** Called after navigation starts (e.g. to close a mobile drawer). */
  onSelected?: () => void;
  /** When set, picking a place calls this instead of navigating to its city page. */
  onPick?: (place: GeoLocation) => void;
  /** Accessible label and placeholder override. */
  label?: string;
}

/**
 * City autocomplete (WAI-ARIA combobox with listbox popup).
 * Debounced 300 ms against /api/geocode; up/down/enter/escape supported.
 */
export function CitySearch({ variant = "compact", onSelected, onPick, label = "Search for a city" }: CitySearchProps) {
  const router = useRouter();
  const [, setActiveCity] = useActiveCity();
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const trimmed = query.trim();
  const debounced = useDebouncedValue(trimmed, 300);
  const key = debounced.length >= 2 ? `/api/geocode?q=${encodeURIComponent(debounced)}&count=8` : null;
  const { data, error, isLoading, mutate } = useSWR<GeocodeResponse, Error>(key, apiFetch, {
    revalidateOnFocus: false,
    keepPreviousData: false,
    errorRetryCount: 1,
  });

  const waitingForDebounce = trimmed.length >= 2 && trimmed !== debounced;
  const results = !waitingForDebounce && key ? (data?.results ?? []) : [];
  const loading = trimmed.length >= 2 && (waitingForDebounce || isLoading);
  const showPopup = open && trimmed.length >= 2;
  const activeIndex = active >= 0 && active < results.length ? active : -1;

  function select(place: GeoLocation) {
    if (onPick) {
      // Focus stays in the input (e.g. to add another city); the caller moves it if the input goes away.
      setQuery("");
      setOpen(false);
      setActive(-1);
      onPick(place);
      return;
    }
    const slug = makeCitySlug(place.name, place.latitude, place.longitude);
    setActiveCity({
      slug,
      name: place.name,
      subtitle: placeSubtitle(place) || undefined,
      latitude: place.latitude,
      longitude: place.longitude,
    });
    setQuery("");
    setOpen(false);
    setActive(-1);
    inputRef.current?.blur();
    router.push(`/city/${slug}`);
    onSelected?.();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setOpen(true);
        if (results.length) setActive((i) => (i + 1 >= results.length ? 0 : i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setOpen(true);
        if (results.length) setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
        break;
      case "Enter": {
        const pick = results[activeIndex] ?? results[0];
        if (pick) {
          e.preventDefault();
          select(pick);
        }
        break;
      }
      case "Escape":
        if (open) {
          e.preventDefault();
          setOpen(false);
          setActive(-1);
        } else if (query) {
          setQuery("");
        }
        break;
    }
  }

  const hero = variant === "hero";
  const status = !showPopup
    ? ""
    : loading
      ? "Searching…"
      : error
        ? "Search is unavailable."
        : results.length === 0
          ? "No places found."
          : `${results.length} place${results.length === 1 ? "" : "s"} found. Use up and down arrows to choose.`;

  return (
    <div className="relative w-full">
      <label htmlFor={`${id}-input`} className="sr-only">
        {label}
      </label>
      <div
        className={`flex items-center gap-2 rounded-xl border border-border bg-surface focus-within:border-[var(--focus)] ${hero ? "h-14 px-4 text-lg shadow-sm" : "h-10 px-3 text-sm"}`}
      >
        <SearchIcon size={hero ? 22 : 16} className="shrink-0 text-muted" />
        <input
          ref={inputRef}
          id={`${id}-input`}
          type="text"
          role="combobox"
          aria-expanded={showPopup}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeIndex >= 0 ? `${id}-opt-${activeIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={hero ? "Search any city…" : "Search city…"}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted focus-visible:outline-none"
        />
        {loading ? <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-muted border-t-transparent" aria-hidden /> : null}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {status}
      </p>

      <ul
        id={listId}
        role="listbox"
        aria-label="City suggestions"
        hidden={!showPopup}
        className="absolute left-0 right-0 z-40 mt-1 max-h-80 overflow-auto rounded-xl border border-border bg-surface p-1 shadow-lg"
      >
        {loading && results.length === 0 ? (
          <li role="presentation" className="px-3 py-2 text-sm text-muted">
            Searching…
          </li>
        ) : error ? (
          <li role="presentation" className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="text-danger">Search unavailable: {errorMessage(error)}</span>
            <button
              type="button"
              className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-surface-2"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void mutate()}
            >
              Retry
            </button>
          </li>
        ) : results.length === 0 ? (
          <li role="presentation" className="px-3 py-2 text-sm text-muted">
            No places match “{trimmed}”.
          </li>
        ) : (
          results.map((r, i) => (
            <li
              key={`${r.latitude},${r.longitude},${i}`}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              // Keep focus in the input while clicking an option.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => select(r)}
              onMouseEnter={() => setActive(i)}
              className={`cursor-pointer rounded-lg px-3 py-2 text-sm ${i === activeIndex ? "bg-surface-2" : ""}`}
            >
              <span className="font-medium">{r.name}</span>
              {placeSubtitle(r) ? <span className="text-muted">, {placeSubtitle(r)}</span> : null}
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
