"use client";

import { useDataSource } from "@/hooks/useDataSource";
import { DATA_SOURCE_LABEL, DATA_SOURCE_MODES, type DataSourceMode } from "@/lib/headline-source";

const TITLE: Record<DataSourceMode, string> = {
  auto: "Median of fresh ground stations within 15 km when there are 3 or more, else the nearest station within 10 km, else the model",
  station: "The nearest fresh ground station within 15 km, else the model",
  model: "Always the Open-Meteo (CAMS) model",
};

/** "Data source: Auto / Nearest station / Model only", persisted app-wide (a shared link can override it for the view). */
export function DataSourceToggle() {
  const [mode, setMode] = useDataSource();
  return (
    <label className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-2 text-sm">
      <span className="text-muted">Data source</span>
      <select
        value={mode}
        onChange={(e) => setMode(e.target.value as DataSourceMode)}
        className="rounded-md bg-surface py-1 font-medium"
        data-testid="data-source"
        title={TITLE[mode]}
      >
        {DATA_SOURCE_MODES.map((m) => (
          <option key={m} value={m}>
            {DATA_SOURCE_LABEL[m]}
          </option>
        ))}
      </select>
    </label>
  );
}
