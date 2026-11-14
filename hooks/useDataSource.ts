"use client";

import { useCallback } from "react";
import { z } from "@/lib/zod";

import { useViewOverride } from "@/hooks/useViewOverride";
import { DATA_SOURCE_MODES, type DataSourceMode } from "@/lib/headline-source";
import { createStoredValue, useStoredValue } from "@/lib/storage";

export const dataSourceStore = createStoredValue<DataSourceMode>("airiq:data-source", z.enum(DATA_SOURCE_MODES), "auto");

/**
 * Headline data source: Auto (stations first), Nearest station, or Model only.
 * Persisted app-wide; a shared link's ?source= shows that mode for the view
 * only, without saving it (like ?scale= and ?profile=).
 */
export function useDataSource(): [DataSourceMode, (m: DataSourceMode) => void] {
  const [stored, setStored] = useStoredValue(dataSourceStore);
  const view = useViewOverride();
  const set = useCallback(
    (m: DataSourceMode) => {
      setStored(m);
      view?.clear(["source"]);
    },
    [setStored, view],
  );
  return [view?.override.source ?? stored, set];
}
