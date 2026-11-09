"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { ABORTED_STATUS, apiFetch, ApiClientError, errorMessage } from "@/lib/fetcher";
import type { Bounds } from "@/lib/grid";
import type { GridResponse, StationsResponse } from "@/types/api";

export interface Viewport extends Bounds {
  zoom: number;
}

export function viewportQuery(v: Viewport): string {
  return new URLSearchParams({
    south: v.south.toFixed(4),
    west: v.west.toFixed(4),
    north: v.north.toFixed(4),
    east: v.east.toFixed(4),
    zoom: String(v.zoom),
  }).toString();
}

export interface MapDataState {
  grid: GridResponse | null;
  gridError: string | null;
  stations: StationsResponse | null;
  stationsError: string | null;
  /** Either request in flight. */
  loading: boolean;
  /** Grid request in flight (drives Retry for the grid error). */
  gridLoading: boolean;
  /** Query string of the grid currently shown (for tests/debugging). */
  shownQuery: string | null;
  /** Query string most recently requested. */
  requestedQuery: string | null;
}

const DEBOUNCE_MS = 500;

/**
 * Fetch grid + stations for the viewport, debounced 500 ms. Each new request
 * aborts the previous one, and a sequence number guarantees an older response
 * can never overwrite a newer one. Previous data stays visible while loading.
 */
export function useMapData(viewport: Viewport | null) {
  const [state, setState] = useState<MapDataState>({
    grid: null,
    gridError: null,
    stations: null,
    stationsError: null,
    loading: false,
    gridLoading: false,
    shownQuery: null,
    requestedQuery: null,
  });
  const [reloadToken, setReloadToken] = useState(0);
  const seq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const query = viewport ? viewportQuery(viewport) : null;

  useEffect(() => {
    if (!query) return;
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const mySeq = ++seq.current;
      const current = () => mySeq === seq.current && !ctrl.signal.aborted;
      setState((s) => ({ ...s, loading: true, gridLoading: true, requestedQuery: query }));

      const grid = apiFetch<GridResponse>(`/api/grid?${query}`, ctrl.signal).then(
        (g) => {
          if (current()) setState((s) => ({ ...s, grid: g, gridError: null, gridLoading: false, shownQuery: query }));
        },
        (err: unknown) => {
          if (!current() || (err instanceof ApiClientError && err.status === ABORTED_STATUS)) return;
          setState((s) => ({ ...s, gridError: errorMessage(err), gridLoading: false }));
        },
      );
      const stations = apiFetch<StationsResponse>(`/api/stations?${query}`, ctrl.signal).then(
        (st) => {
          if (current()) setState((s) => ({ ...s, stations: st, stationsError: null }));
        },
        (err: unknown) => {
          if (!current() || (err instanceof ApiClientError && err.status === ABORTED_STATUS)) return;
          setState((s) => ({ ...s, stationsError: errorMessage(err) }));
        },
      );
      void Promise.allSettled([grid, stations]).then(() => {
        if (current()) setState((s) => ({ ...s, loading: false }));
      });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, reloadToken]);

  // Abort anything in flight on unmount.
  useEffect(() => () => abortRef.current?.abort(), []);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);
  return { ...state, retry };
}
