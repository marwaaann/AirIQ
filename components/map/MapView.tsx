"use client";

import "leaflet/dist/leaflet.css";

import type L from "leaflet";
import { memo, useEffect, useMemo, useState } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap, useMapEvents, ZoomControl } from "react-leaflet";

import { HeatLayer, type HeatPoint } from "@/components/map/HeatLayer";
import { gridIcon, stationIcon } from "@/components/map/markers";
import { GridPopup, StationPopup } from "@/components/map/PointPopup";
import type { Viewport } from "@/hooks/useMapData";
import { useResolvedTheme } from "@/hooks/useResolvedTheme";
import { getUsCategory, POLLUTANT_INFO } from "@/lib/aqi-categories";
import { readCell, type MapLayer } from "@/lib/map-layers";
import type { AqiScale, GridCell, Station } from "@/types/air";

export interface FlyTarget {
  lat: number;
  lon: number;
  zoom: number;
  /** Changes on every request so flying to the same place twice still works. */
  nonce: number;
}

/**
 * Basemap: Esri World Light/Dark Gray Canvas (no key). CARTO's basemaps were
 * the first choice but now return an "API KEY REQUIRED" watermark tile.
 * The matching "Reference" layer (labels/boundaries) is drawn above the
 * heatmap so place names stay readable.
 */
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas";
const BASEMAP = {
  light: {
    base: `${ESRI}/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  },
  dark: {
    base: `${ESRI}/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`,
    labels: `${ESRI}/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`,
  },
} as const;
const LABELS_PANE = "airiq-labels";

const TILE_ATTRIBUTION =
  // Esri requires "Powered by Esri" plus the service's copyrightText (checked 2026-11-11).
  'Powered by <a href="https://www.esri.com/">Esri</a> · Basemap: Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community · Air data: <a href="https://open-meteo.com/">Open-Meteo</a> (CAMS) · <a href="/about">Sources</a>';

const WORLD_BOUNDS: L.LatLngBoundsExpression = [
  [-85, -180],
  [85, 180],
];

const TILE_BOUNDS: L.LatLngBoundsExpression = [
  [-85.0511, -179.9999],
  [85.0511, 179.9999],
];

/**
 * Stable position tuples per coordinate. react-leaflet compares `position` by
 * reference and calls setLatLng on change, which re-runs an open popup's
 * autoPan → moveend → state update → re-render: an infinite loop if every
 * render made new arrays.
 */
const positionCache = new Map<string, L.LatLngTuple>();
function stablePosition(lat: number, lon: number): L.LatLngTuple {
  const key = `${lat},${lon}`;
  let p = positionCache.get(key);
  if (!p) {
    p = [lat, lon];
    if (positionCache.size > 5000) positionCache.clear();
    positionCache.set(key, p);
  }
  return p;
}

const clampLat = (v: number) => Math.max(-85, Math.min(85, v));
const clampLon = (v: number) => Math.max(-180, Math.min(180, v));

function readViewport(map: L.Map): Viewport {
  const b = map.getBounds();
  return {
    south: clampLat(b.getSouth()),
    west: clampLon(b.getWest()),
    north: clampLat(b.getNorth()),
    east: clampLon(b.getEast()),
    zoom: Math.round(map.getZoom()),
  };
}

function ViewportEvents({ onViewport }: { onViewport: (v: Viewport, center: L.LatLng) => void }) {
  const map = useMapEvents({
    moveend: () => onViewport(readViewport(map), map.getCenter()),
  });
  useEffect(() => {
    onViewport(readViewport(map), map.getCenter());
  }, [map, onViewport]);
  return null;
}

/** True when the user asked the OS for less motion (read once; Leaflet options are fixed at creation). */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function FlyTo({ target }: { target: FlyTarget | null }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    // Jump instead of flying when reduced motion is requested.
    if (prefersReducedMotion()) map.setView([target.lat, target.lon], target.zoom, { animate: false });
    else map.flyTo([target.lat, target.lon], target.zoom, { duration: 1.2 });
  }, [map, target]);
  return null;
}

/**
 * Keyboard support for popups. Leaflet only handles Escape while the map
 * container itself has focus, and a popup opened from a focused marker sits
 * after every other marker in tab order. So: a popup opened from the keyboard
 * receives focus; Escape closes it from anywhere in the map; focus then
 * returns to the marker that opened it.
 */
function PopupKeyboard() {
  const map = useMap();
  useEffect(() => {
    let source: HTMLElement | null = null;
    const onOpen = (e: L.PopupEvent) => {
      const icon = (e.popup as L.Popup & { _source?: { getElement?: () => HTMLElement | undefined } })._source?.getElement?.() ?? null;
      source = icon;
      if (icon && document.activeElement === icon) {
        e.popup.getElement()?.querySelector<HTMLElement>("a[href], button, .leaflet-popup-close-button")?.focus();
      }
    };
    const onClose = (e: L.PopupEvent) => {
      const el = e.popup.getElement();
      const hadFocus = !!el && el.contains(document.activeElement);
      if (hadFocus && source?.isConnected) source.focus();
      source = null;
    };
    const container = map.getContainer();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || !source) return;
      const back = source;
      map.closePopup();
      if (back.isConnected) back.focus();
    };
    map.on("popupopen", onOpen);
    map.on("popupclose", onClose);
    container.addEventListener("keydown", onKey);
    return () => {
      map.off("popupopen", onOpen);
      map.off("popupclose", onClose);
      container.removeEventListener("keydown", onKey);
    };
  }, [map]);
  return null;
}

/** Pane for basemap labels: above the heatmap (350), below markers (600). */
function LabelsPane() {
  const map = useMap();
  if (!map.getPane(LABELS_PANE)) {
    const pane = map.createPane(LABELS_PANE);
    pane.style.zIndex = "450";
    pane.style.pointerEvents = "none";
  }
  return null;
}

/** Keeps Leaflet's size in sync when the container changes (mobile sheet, rotation). */
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

export interface MapViewProps {
  initial: { lat: number; lon: number; zoom: number };
  layer: MapLayer;
  scale: AqiScale;
  cells: GridCell[];
  step: number;
  stations: Station[];
  heatVisible: boolean;
  heatOpacity: number;
  flyTarget: FlyTarget | null;
  onViewport: (v: Viewport, center: L.LatLng) => void;
}

export default function MapView({
  initial,
  layer,
  scale,
  cells,
  step,
  stations,
  heatVisible,
  heatOpacity,
  flyTarget,
  onViewport,
}: MapViewProps) {
  const theme = useResolvedTheme();
  const tiles = BASEMAP[theme];
  // MapView only renders in the browser (loaded with ssr: false), so this is safe on first render.
  const [reduceMotion] = useState(prefersReducedMotion);

  const readings = useMemo(() => cells.map((c) => ({ cell: c, r: readCell(c, layer, scale) })), [cells, layer, scale]);
  const heatPoints: HeatPoint[] = useMemo(
    () =>
      readings
        .filter((x): x is typeof x & { r: { index: number } } => x.r.index !== null)
        .map((x) => ({ lat: x.cell.latitude, lon: x.cell.longitude, value: x.r.index })),
    [readings],
  );
  // Stations report a US AQI (overall or from PM2.5), so they are shown on the AQI and PM2.5 layers only.
  const showStations = layer === "aqi" || layer === "pm2_5";

  return (
    <MapContainer
      center={[initial.lat, initial.lon]}
      zoom={initial.zoom}
      minZoom={2}
      maxZoom={16}
      maxBounds={WORLD_BOUNDS}
      maxBoundsViscosity={1}
      worldCopyJump={false}
      zoomControl={false}
      className="airiq-map h-full w-full"
      keyboard
      zoomAnimation={!reduceMotion}
      fadeAnimation={!reduceMotion}
      markerZoomAnimation={!reduceMotion}
    >
      <LabelsPane />
      <PopupKeyboard />
      <TileLayer
        key={theme}
        url={tiles.base}
        attribution={TILE_ATTRIBUTION}
        maxNativeZoom={16}
        maxZoom={16}
        noWrap
        // Only request tiles inside the world; avoids 404s for x < 0 or x ≥ 2^z.
        bounds={TILE_BOUNDS}
      />
      <TileLayer
        key={`${theme}-labels`}
        url={tiles.labels}
        pane={LABELS_PANE}
        maxNativeZoom={16}
        maxZoom={16}
        noWrap
        bounds={TILE_BOUNDS}
      />
      <ZoomControl position="topright" />
      <InvalidateOnResize />
      <ViewportEvents onViewport={onViewport} />
      <FlyTo target={flyTarget} />
      <HeatLayer points={heatPoints} scale={scale} step={step} opacity={heatOpacity} visible={heatVisible} />

      <GridMarkers readings={readings} scale={scale} />
      {showStations ? <StationMarkers stations={stations} layer={layer} /> : null}
    </MapContainer>
  );
}

type Reading = { cell: GridCell; r: ReturnType<typeof readCell> };

/**
 * Memoized so popup children only change when the data does. react-leaflet
 * calls popup.update() (which auto-pans) whenever an open popup's children
 * change; re-rendering them on every map move would loop.
 */
const GridMarkers = memo(function GridMarkers({ readings, scale }: { readings: Reading[]; scale: AqiScale }) {
  return (
    <>
      {readings.map(({ cell, r }) => (
        <Marker
          key={`g${cell.latitude},${cell.longitude}`}
          position={stablePosition(cell.latitude, cell.longitude)}
          icon={gridIcon(r.label, r.category, `${r.spoken}${r.category ? `, ${r.category.label}` : ""} at grid point`)}
          title={`${r.spoken}${r.category ? `, ${r.category.label}` : ""}`}
          keyboard
          riseOnHover
        >
          <Popup maxWidth={280} autoPanPadding={[24, 24]}>
            <GridPopup cell={cell} scale={scale} />
          </Popup>
        </Marker>
      ))}
    </>
  );
});

const StationMarkers = memo(function StationMarkers({ stations, layer }: { stations: Station[]; layer: MapLayer }) {
  return (
    <>
      {stations.map((s) => {
        const cat = getUsCategory(s.aqi);
        const label = layer === "pm2_5" && s.pm25 !== null ? String(Math.round(s.pm25)) : String(s.aqi);
        const spoken =
          layer === "pm2_5" && s.pm25 !== null
            ? `Station ${s.name}: ${POLLUTANT_INFO.pm2_5.short} ${Math.round(s.pm25)} µg/m³`
            : `Station ${s.name}: US AQI ${s.aqi}, ${cat.label}`;
        return (
          <Marker
            key={s.id}
            position={stablePosition(s.latitude, s.longitude)}
            icon={stationIcon(label, cat, spoken)}
            title={spoken}
            keyboard
            riseOnHover
            zIndexOffset={1000}
          >
            <Popup maxWidth={280} autoPanPadding={[24, 24]}>
              <StationPopup station={s} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
});
