"use client";

import { useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";

import { parseSharedPrefs, type SharedPrefs } from "@/lib/share";

export interface ViewOverride {
  /** ?scale= / ?profile= from the URL (null when absent or invalid). */
  override: SharedPrefs;
  /** Remove these parameters from the address bar (the view falls back to saved settings). */
  clear: (which: ReadonlyArray<"scale" | "profile">) => void;
}

const ViewOverrideContext = createContext<ViewOverride | null>(null);

/**
 * Makes ?scale= and ?profile= override the saved settings for the pages
 * inside it, without writing them anywhere. The values live in the URL, so a
 * reload keeps the shared view and a Share link reproduces it.
 */
export function ViewOverrideProvider({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const scale = params.get("scale");
  const profile = params.get("profile");
  const override = useMemo(() => parseSharedPrefs(new URLSearchParams({ ...(scale ? { scale } : {}), ...(profile ? { profile } : {}) })), [scale, profile]);
  const clear = useCallback((which: ReadonlyArray<"scale" | "profile">) => {
    const next = new URLSearchParams(window.location.search);
    for (const k of which) next.delete(k);
    const qs = next.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
  }, []);
  const value = useMemo(() => ({ override, clear }), [override, clear]);
  return <ViewOverrideContext.Provider value={value}>{children}</ViewOverrideContext.Provider>;
}

/** The shared-link override, or null outside a provider (then saved settings apply as usual). */
export function useViewOverride(): ViewOverride | null {
  return useContext(ViewOverrideContext);
}
