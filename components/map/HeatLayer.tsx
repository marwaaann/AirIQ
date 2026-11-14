"use client";

import L from "leaflet";
import { useEffect, useRef } from "react";
import { useMap } from "react-leaflet";

import { rampColor } from "@/lib/color-ramp";
import { idw, type Sample } from "@/lib/idw";
import type { AqiScale } from "@/types/air";

export interface HeatPoint {
  lat: number;
  lon: number;
  /** Index value (AQI or sub-index) used for color. */
  value: number;
}

const PANE = "airiq-heat";
/** Interpolation resolution in screen pixels (upscaled with smoothing). */
const CELL_PX = 6;

/**
 * Canvas overlay that interpolates sample values (model grid points, ground
 * stations, or both; see lib/heat-blend.ts) with inverse-distance weighting
 * and colors them with the category ramp (beyond-index values get their own
 * colour). Redraws on move/zoom end;
 * hidden during zoom animations so it never shows a mis-scaled frame.
 */
class IdwHeatLayer extends L.Layer {
  private canvas: HTMLCanvasElement | null = null;
  private lmap: L.Map | null = null;
  private points: HeatPoint[] = [];
  private scale: AqiScale = "us";
  private step = 1;
  private opacity = 0.55;

  setData(points: HeatPoint[], scale: AqiScale, step: number) {
    this.points = points;
    this.scale = scale;
    this.step = step;
    this.redraw();
  }

  setOpacity(opacity: number) {
    this.opacity = opacity;
    if (this.canvas) this.canvas.style.opacity = String(opacity);
  }

  override onAdd(map: L.Map): this {
    this.lmap = map;
    if (!map.getPane(PANE)) {
      const pane = map.createPane(PANE);
      pane.style.zIndex = "350"; // above tiles (200), below markers/popups (600+)
      pane.style.pointerEvents = "none";
    }
    const canvas = L.DomUtil.create("canvas", "airiq-heat-canvas") as HTMLCanvasElement;
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.position = "absolute";
    canvas.style.opacity = String(this.opacity);
    map.getPane(PANE)?.appendChild(canvas);
    this.canvas = canvas;
    map.on("moveend zoomend resize viewreset", this.reset, this);
    map.on("zoomstart", this.hide, this);
    this.reset();
    return this;
  }

  override onRemove(map: L.Map): this {
    map.off("moveend zoomend resize viewreset", this.reset, this);
    map.off("zoomstart", this.hide, this);
    this.canvas?.remove();
    this.canvas = null;
    this.lmap = null;
    return this;
  }

  private hide() {
    if (this.canvas) this.canvas.style.visibility = "hidden";
  }

  private reset() {
    const map = this.lmap;
    const canvas = this.canvas;
    if (!map || !canvas) return;
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    L.DomUtil.setPosition(canvas, map.containerPointToLayerPoint([0, 0]));
    canvas.style.visibility = "visible";
    this.redraw();
  }

  private redraw() {
    const map = this.lmap;
    const canvas = this.canvas;
    if (!map || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (this.points.length === 0) return;

    const samples: Sample[] = this.points.map((p) => {
      const pt = map.latLngToContainerPoint([p.lat, p.lon]);
      return { x: pt.x, y: pt.y, v: p.value };
    });

    // Grid spacing in pixels, used for the influence radius and edge fade.
    const p0 = this.points[0];
    const a = map.latLngToContainerPoint([p0.lat, p0.lon]);
    const bx = map.latLngToContainerPoint([p0.lat, p0.lon + this.step]);
    const by = map.latLngToContainerPoint([Math.max(-85, Math.min(85, p0.lat + this.step)), p0.lon]);
    const spacing = Math.max(Math.abs(bx.x - a.x), Math.abs(by.y - a.y), CELL_PX * 2);
    const radius = spacing * 1.6;
    const solid = spacing * 0.75;

    const gw = Math.ceil(canvas.width / CELL_PX);
    const gh = Math.ceil(canvas.height / CELL_PX);
    // The map container can measure 0 px for a frame while the page lays out
    // (seen once in Phase 8's tour as an IndexSizeError); skip until it has a size.
    if (!(gw > 0 && gh > 0)) return;
    const off = document.createElement("canvas");
    off.width = gw;
    off.height = gh;
    const octx = off.getContext("2d");
    if (!octx) return;
    const img = octx.createImageData(gw, gh);
    const data = img.data;

    for (let j = 0; j < gh; j++) {
      const y = j * CELL_PX + CELL_PX / 2;
      for (let i = 0; i < gw; i++) {
        const r = idw(samples, i * CELL_PX + CELL_PX / 2, y, { radius });
        if (!r) continue;
        const fade = r.nearest <= solid ? 1 : Math.max(0, 1 - (r.nearest - solid) / (radius - solid));
        if (fade <= 0) continue;
        const [cr, cg, cb] = rampColor(r.value, this.scale);
        const k = (j * gw + i) * 4;
        data[k] = cr;
        data[k + 1] = cg;
        data[k + 2] = cb;
        data[k + 3] = Math.round(255 * fade);
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(off, 0, 0, gw, gh, 0, 0, gw * CELL_PX, gh * CELL_PX);
  }
}

export function HeatLayer({
  points,
  scale,
  step,
  opacity,
  visible,
}: {
  points: HeatPoint[];
  scale: AqiScale;
  step: number;
  opacity: number;
  visible: boolean;
}) {
  const map = useMap();
  const layerRef = useRef<IdwHeatLayer | null>(null);

  useEffect(() => {
    if (!visible) return;
    const layer = new IdwHeatLayer();
    layerRef.current = layer;
    layer.addTo(map);
    return () => {
      layer.remove();
      layerRef.current = null;
    };
  }, [map, visible]);

  useEffect(() => {
    layerRef.current?.setData(points, scale, step);
  }, [points, scale, step, visible]);

  useEffect(() => {
    layerRef.current?.setOpacity(opacity);
  }, [opacity, visible]);

  return null;
}
