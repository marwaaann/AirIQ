"use client";

import { useSearchParams } from "next/navigation";
import { useCallback } from "react";

/**
 * A query-string parameter restricted to `allowed` values. Updates use
 * history.replaceState (Next.js keeps useSearchParams in sync), so switching
 * a tab or range never triggers a server round-trip or scroll jump.
 */
export function useUrlParam<T extends string>(name: string, allowed: readonly T[], fallback: T): [T, (v: T) => void] {
  const params = useSearchParams();
  const raw = params.get(name);
  const value = (allowed as readonly string[]).includes(raw ?? "") ? (raw as T) : fallback;
  const set = useCallback(
    (v: T) => {
      const next = new URLSearchParams(window.location.search);
      if (v === fallback) next.delete(name);
      else next.set(name, v);
      const qs = next.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    },
    [name, fallback],
  );
  return [value, set];
}
