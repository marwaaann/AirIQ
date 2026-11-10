"use client";

import type L from "leaflet";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

import { CitySearch } from "@/components/CitySearch";
import { AlertIcon, RefreshIcon } from "@/components/icons";
import { ControlsPanel, HeatControls, LayerSwitcher, LocateMapButton, MapLegend } from "@/components/map/MapControls";
import MapView, { type FlyTarget } from "@/components/map/MapView";
import { AqiScaleToggle } from "@/components/AqiScaleToggle";
import { Skeleton } from "@/components/states";
import { StaleNotice } from "@/components/StaleNotice";
import { useAqiScale } from "@/hooks/useAqiScale";
import { useActiveCity } from "@/hooks/useCity";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useMapData, type Viewport } from "@/hooks/useMapData";
import { REVALIDATE_EVENT } from "@/hooks/useOnline";
import { combineStale, staleMetaOf } from "@/lib/stale";
import { isMapLayer, type MapLayer } from "@/lib/map-layers";
import { createStoredValue, useStoredValue } from "@/lib/storage";

const heatVisibleStore = createStoredValue<boolean>("airiq:map-heat", z.boolean(), true);
const heatOpacityStore = createStoredValue<number>("airiq:map-heat-opacity", z.number().min(0.15).max(0.9), 0.55);

const WORLD = { lat: 20, lon: 0, zoom: 2 };
const CITY_ZOOM = 9;

interface InitialView {
  lat: number;
  lon: number;
  zoom: number;
}

/** ?lat=&lon=&z=&layer= (validated; anything invalid is ignored). */
function readUrlState(): { view: InitialView | null; layer: MapLayer | null } {
  const p = new URLSearchParams(window.location.search);
  const lat = Number(p.get("lat"));
  const lon = Number(p.get("lon"));
  const z = Number(p.get("z"));
  const valid =
    p.has("lat") && p.has("lon") && Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 85 && Math.abs(lon) <= 180;
  const layerParam = p.get("layer");
  return {
    view: valid ? { lat, lon, zoom: Number.isFinite(z) && p.has("z") ? Math.min(16, Math.max(2, Math.round(z))) : CITY_ZOOM } : null,
    layer: isMapLayer(layerParam) ? layerParam : null,
  };
}

function writeUrlState(center: { lat: number; lng: number }, zoom: number, layer: MapLayer) {
  const p = new URLSearchParams({
    lat: center.lat.toFixed(4),
    lon: center.lng.toFixed(4),
    z: String(Math.round(zoom)),
    layer,
  });
  const next = `${window.location.pathname}?${p}`;
  if (next !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", next);
}

/** Client-only map screen (loaded with ssr: false from MapScreen). */
export default function MapClient() {
  const [scale] = useAqiScale();
  const [activeCity] = useActiveCity();
  const [heatVisible, setHeatVisible] = useStoredValue(heatVisibleStore);
  const [heatOpacity, setHeatOpacity] = useStoredValue(heatOpacityStore);
  const geo = useGeolocation();

  // Priority: shared URL → last viewed city → (async) granted geolocation → world.
  const [urlState] = useState(readUrlState);
  const [initial, setInitial] = useState<InitialView | null>(() =>
    urlState.view ?? (activeCity ? { lat: activeCity.latitude, lon: activeCity.longitude, zoom: CITY_ZOOM } : null),
  );
  const [layer, setLayer] = useState<MapLayer>(urlState.layer ?? "aqi");
  const [viewport, setViewport] = useState<Viewport | null>(null);
  const [center, setCenter] = useState<{ lat: number; lng: number; zoom: number } | null>(null);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    const toWorld = () => !cancelled && setInitial(WORLD);
    const perms = navigator.permissions?.query({ name: "geolocation" as PermissionName });
    if (!perms || !("geolocation" in navigator)) {
      queueMicrotask(toWorld);
      return () => {
        cancelled = true;
      };
    }
    perms
      .then((status) => {
        if (status.state !== "granted") return toWorld();
        navigator.geolocation.getCurrentPosition(
          (pos) => !cancelled && setInitial({ lat: pos.coords.latitude, lon: pos.coords.longitude, zoom: CITY_ZOOM }),
          toWorld,
          { timeout: 5000, maximumAge: 10 * 60_000 },
        );
      })
      .catch(toWorld);
    return () => {
      cancelled = true;
    };
  }, [initial]);

  const data = useMapData(viewport);
  // Reload the visible map when the connection comes back.
  const { retry: reloadMap } = data;
  useEffect(() => {
    window.addEventListener(REVALIDATE_EVENT, reloadMap);
    return () => window.removeEventListener(REVALIDATE_EVENT, reloadMap);
  }, [reloadMap]);

  // Only update state when the view really changed (moveend can fire without movement).
  const onViewport = useCallback((v: Viewport, c: L.LatLng) => {
    setViewport((prev) =>
      prev &&
      prev.zoom === v.zoom &&
      prev.south.toFixed(4) === v.south.toFixed(4) &&
      prev.west.toFixed(4) === v.west.toFixed(4) &&
      prev.north.toFixed(4) === v.north.toFixed(4) &&
      prev.east.toFixed(4) === v.east.toFixed(4)
        ? prev
        : v,
    );
    setCenter((prev) =>
      prev && prev.zoom === v.zoom && prev.lat.toFixed(4) === c.lat.toFixed(4) && prev.lng.toFixed(4) === c.lng.toFixed(4)
        ? prev
        : { lat: c.lat, lng: c.lng, zoom: v.zoom },
    );
  }, []);

  // Keep the URL shareable.
  useEffect(() => {
    if (center) writeUrlState(center, center.zoom, layer);
  }, [center, layer]);

  const flyTo = useCallback((lat: number, lon: number, zoom = CITY_ZOOM) => {
    setFlyTarget({ lat, lon, zoom, nonce: Date.now() });
  }, []);

  async function locate() {
    const c = await geo.locate();
    if (c) flyTo(c.latitude, c.longitude);
  }

  const cells = data.grid?.cells ?? [];
  const modelTime = cells[0]?.time ?? null;
  const showInitialSpinner = data.loading && !data.grid;

  return (
    <div
      className="relative h-full w-full"
      data-testid="map-root"
      data-loading={data.loading ? "true" : "false"}
      data-shown-query={data.shownQuery ?? ""}
      data-requested-query={data.requestedQuery ?? ""}
      data-cells={cells.length}
    >
      {initial ? (
        <MapView
          initial={initial}
          layer={layer}
          scale={scale}
          cells={cells}
          step={data.grid?.step ?? 1}
          stations={data.stations?.stations ?? []}
          heatVisible={heatVisible}
          heatOpacity={heatOpacity}
          flyTarget={flyTarget}
          onViewport={onViewport}
        />
      ) : (
        <Skeleton className="h-full w-full rounded-none" label="Finding a starting view" />
      )}

      {/* Mobile: search floats at the top; desktop: inside the panel. */}
      <div className="pointer-events-auto absolute left-2 right-14 top-2 z-[1000] md:hidden">
        <CitySearch onPick={(p) => flyTo(p.latitude, p.longitude)} label="Fly to a city" />
      </div>

      {/* Status: loading + errors (top centre on desktop, under the search on mobile). */}
      <div className="pointer-events-none absolute inset-x-0 top-14 z-[1000] flex flex-col items-center gap-2 px-2 md:left-[22rem] md:top-3">
        {data.loading ? (
          <p
            role="status"
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-border bg-surface/95 px-3 py-1 text-xs font-medium shadow"
          >
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-transparent" aria-hidden />
            {showInitialSpinner ? "Loading air quality…" : "Updating…"}
          </p>
        ) : null}
        <StaleNotice
          className="pointer-events-auto max-w-lg shadow-lg"
          meta={combineStale(staleMetaOf(data.grid), staleMetaOf(data.stations))}
          timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
          onRetry={data.retry}
          retrying={data.gridLoading}
        />
        {data.gridError ? (
          <div
            role="alert"
            className="pointer-events-auto flex max-w-lg items-start gap-3 rounded-xl border border-danger/50 bg-surface px-3 py-2 text-sm shadow-lg"
          >
            <AlertIcon size={18} className="mt-0.5 shrink-0 text-danger" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-danger">Couldn’t load map data</p>
              <p className="break-words text-xs text-muted">{data.gridError}</p>
              {data.grid ? <p className="text-xs text-muted">Showing the last successful view.</p> : null}
            </div>
            <button
              type="button"
              onClick={data.retry}
              disabled={data.gridLoading}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-2 py-1 text-xs font-medium hover:bg-surface-2 disabled:opacity-60"
            >
              <RefreshIcon size={12} className={data.gridLoading ? "animate-spin" : ""} /> {data.gridLoading ? "Retrying…" : "Retry"}
            </button>
          </div>
        ) : null}
        {!data.loading && !data.gridError && data.grid && cells.length === 0 ? (
          <p role="status" className="pointer-events-auto rounded-full border border-border bg-surface/95 px-3 py-1 text-xs shadow">
            No air-quality readings for this area.
          </p>
        ) : null}
      </div>

      <ControlsPanel layerSwitcher={(compact) => <LayerSwitcher layer={layer} onChange={setLayer} compact={compact} />}>
        <div className="hidden md:block">
          <CitySearch onPick={(p) => flyTo(p.latitude, p.longitude)} label="Fly to a city" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LocateMapButton onLocate={() => void locate()} locating={geo.status === "locating"} />
          <AqiScaleToggle />
        </div>
        {geo.message ? (
          <p role="alert" className="text-xs text-danger">
            {geo.message}
          </p>
        ) : null}
        <HeatControls visible={heatVisible} onVisible={setHeatVisible} opacity={heatOpacity} onOpacity={setHeatOpacity} />
        <MapLegend
          layer={layer}
          scale={scale}
          stations={data.stations}
          stationsError={data.stationsError}
          modelTime={modelTime}
          fetchedAt={data.grid?.fetchedAt ?? null}
        />
      </ControlsPanel>
    </div>
  );
}
