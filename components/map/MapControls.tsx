"use client";

import { useState, type ReactNode } from "react";

import { CategorySwatch } from "@/components/CategoryBadge";
import { LocationIcon } from "@/components/icons";
import { EU_CATEGORIES, POLLUTANT_INFO, US_CATEGORIES, type AqiCategory } from "@/lib/aqi-categories";
import { timeAgo } from "@/lib/format";
import { LAYER_LABEL, MAP_LAYERS, type MapLayer } from "@/lib/map-layers";
import type { AqiScale } from "@/types/air";
import type { StationsResponse } from "@/types/api";

function rangeLabel(c: AqiCategory): string {
  return Number.isFinite(c.max) ? `${c.min}–${c.max}` : `${c.min}+`;
}

export function LayerSwitcher({ layer, onChange, compact = false }: { layer: MapLayer; onChange: (l: MapLayer) => void; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-label="Map layer" className={`flex gap-1 ${compact ? "overflow-x-auto [scrollbar-width:none]" : "flex-wrap"}`}>
      {MAP_LAYERS.map((l) => {
        const checked = l === layer;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-layer={l}
            onClick={() => onChange(l)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = MAP_LAYERS.indexOf(l);
              const next = MAP_LAYERS[(i + (e.key === "ArrowRight" ? 1 : MAP_LAYERS.length - 1)) % MAP_LAYERS.length];
              onChange(next);
              (e.currentTarget.parentElement?.querySelector(`[data-layer="${next}"]`) as HTMLButtonElement | null)?.focus();
            }}
            className={`shrink-0 rounded-lg border px-3 py-1.5 text-sm font-medium ${checked ? "border-text bg-text text-bg" : "border-border bg-surface text-text hover:bg-surface-2"}`}
          >
            {LAYER_LABEL[l]}
          </button>
        );
      })}
    </div>
  );
}

export function MapLegend({
  layer,
  scale,
  stations,
  stationsError,
  modelTime,
  fetchedAt,
}: {
  layer: MapLayer;
  scale: AqiScale;
  stations: StationsResponse | null;
  stationsError: string | null;
  modelTime: string | null;
  fetchedAt: string | null;
}) {
  const cats = scale === "us" ? US_CATEGORIES : EU_CATEGORIES;
  const scaleName = scale === "us" ? "US AQI (EPA)" : "European AQI (EEA)";
  const gradient = `linear-gradient(90deg, ${cats.map((c) => c.color).join(", ")})`;
  const stationSource =
    stations?.source === "waqi" ? "WAQI" : stations?.source === "openaq" ? "OpenAQ" : stationsError ? "unavailable" : "none";

  return (
    <section aria-label="Map legend" className="flex flex-col gap-2 text-xs">
      <p className="font-semibold text-text">
        {layer === "aqi" ? scaleName : `${POLLUTANT_INFO[layer].short} · colored by its ${scaleName} sub-index`}
      </p>
      <p className="text-muted">
        {layer === "aqi" ? "Badge = index value." : "Badge = concentration in µg/m³."}
      </p>
      <div className="h-2 w-full rounded-full" style={{ background: gradient }} aria-hidden />
      <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
        {cats.map((c) => (
          <li key={c.key} className="flex items-center gap-1.5">
            <CategorySwatch category={c} className="h-3.5 w-3.5" />
            <span className="truncate">
              {c.label} <span className="text-muted">{rangeLabel(c)}</span>
            </span>
          </li>
        ))}
      </ul>
      <ul className="flex flex-col gap-1 border-t border-border pt-2">
        <li className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-3.5 w-6 rounded-md border border-black/20 bg-surface-2" />
          Model grid point (Open-Meteo)
        </li>
        {stations && stations.source !== "none" ? (
          <li className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-4 w-4 rounded-full border-2 border-text bg-surface-2" />
            Ground station ({stationSource}, US AQI) · {stations.stations.length} shown
            {layer !== "aqi" && layer !== "pm2_5" ? " on AQI/PM2.5 layers" : ""}
          </li>
        ) : null}
      </ul>
      {stations?.note ? <p className="text-muted">{stations.note}</p> : null}
      {stationsError ? <p className="text-danger">Ground stations unavailable: {stationsError}</p> : null}
      <p className="text-muted">
        Data: Open-Meteo (CAMS) · Stations: {stationSource}
        {modelTime ? (
          <>
            {" "}
            · Model hour <time dateTime={modelTime}>{timeAgo(modelTime)}</time>
          </>
        ) : null}
        {fetchedAt ? (
          <>
            {" "}
            · Fetched from Open-Meteo <time dateTime={fetchedAt}>{timeAgo(fetchedAt)}</time>
          </>
        ) : null}
      </p>
    </section>
  );
}

export function HeatControls({
  visible,
  onVisible,
  opacity,
  onOpacity,
}: {
  visible: boolean;
  onVisible: (v: boolean) => void;
  opacity: number;
  onOpacity: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex cursor-pointer items-center justify-between gap-3 text-sm font-medium">
        Heatmap
        <input
          type="checkbox"
          role="switch"
          aria-checked={visible}
          checked={visible}
          onChange={(e) => onVisible(e.target.checked)}
          className="h-5 w-9 cursor-pointer accent-[var(--brand)]"
        />
      </label>
      <label className={`flex items-center gap-3 text-xs ${visible ? "" : "opacity-50"}`}>
        <span className="w-14 shrink-0 text-muted">Opacity</span>
        <input
          type="range"
          min={0.15}
          max={0.9}
          step={0.05}
          value={opacity}
          disabled={!visible}
          onChange={(e) => onOpacity(Number(e.target.value))}
          aria-label="Heatmap opacity"
          aria-valuetext={`${Math.round(opacity * 100)}%`}
          className="w-full accent-[var(--brand)]"
        />
        <span className="w-9 text-right tabular-nums">{Math.round(opacity * 100)}%</span>
      </label>
    </div>
  );
}

export function LocateMapButton({ onLocate, locating }: { onLocate: () => void; locating: boolean }) {
  return (
    <button
      type="button"
      onClick={onLocate}
      disabled={locating}
      aria-busy={locating}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2 disabled:opacity-70"
    >
      <LocationIcon size={16} className={locating ? "animate-pulse" : ""} />
      {locating ? "Locating…" : "Use my location"}
    </button>
  );
}

/**
 * Desktop: a floating card on the left. Mobile: a bottom sheet whose top row
 * (layer chips + Options button) is always visible and reachable one-handed.
 */
export function ControlsPanel({
  layerSwitcher,
  children,
}: {
  layerSwitcher: (compact: boolean) => ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <aside
      aria-label="Map controls"
      className="pointer-events-auto absolute inset-x-0 bottom-0 z-[1000] flex max-h-[70%] flex-col rounded-t-2xl border border-border bg-surface/95 shadow-2xl backdrop-blur md:inset-x-auto md:bottom-auto md:left-3 md:top-3 md:max-h-[calc(100%-1.5rem)] md:w-80 md:rounded-2xl"
    >
      <div className="flex items-center gap-2 p-2 md:hidden">
        <div className="min-w-0 flex-1">{layerSwitcher(true)}</div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="map-controls-more"
          className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-surface-2"
        >
          {open ? "Close" : "Options"}
        </button>
      </div>
      <div id="map-controls-more" className={`${open ? "flex" : "hidden"} flex-col gap-4 overflow-y-auto p-3 pt-1 md:flex md:pt-3`}>
        <div className="hidden md:block">{layerSwitcher(false)}</div>
        {children}
      </div>
    </aside>
  );
}
