"use client";

import { useId } from "react";

import { CategoryBadge } from "@/components/CategoryBadge";
import { RefreshIcon } from "@/components/icons";
import { useNow } from "@/hooks/useNow";
import { EU_CATEGORIES, SCALE_MAX, US_CATEGORIES, type AqiCategory } from "@/lib/aqi-categories";
import { formatPlaceTime, timeAgo } from "@/lib/format";
import type { AqiScale } from "@/types/air";

const CX = 120;
const CY = 120;
const R = 96;
const STROKE = 22;
const GAP_DEG = 1.6;

function polar(angleDeg: number, r = R) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}

/** Arc from angle a0 to a1 (degrees, 180 = left, 0 = right), drawn clockwise over the top. */
function arcPath(a0: number, a1: number, r = R) {
  const p0 = polar(a0, r);
  const p1 = polar(a1, r);
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/** Position on the gauge (0..1). Bands are equal width for readability; value interpolates inside its band. */
export function gaugeFraction(value: number, categories: readonly AqiCategory[], scaleMax: number): number {
  const n = categories.length;
  const idx = Math.max(
    0,
    categories.findIndex((c) => value <= c.max),
  );
  const band = categories[idx] ?? categories[n - 1];
  const hi = Number.isFinite(band.max) ? band.max : scaleMax;
  const within = hi > band.min ? Math.min(1, Math.max(0, (value - band.min) / (hi - band.min))) : 1;
  return Math.min(1, (idx + within) / n);
}

function PatternDefs({ prefix }: { prefix: string }) {
  return (
    <defs>
      <pattern id={`${prefix}-dots`} width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="3" r="1.3" fill="rgba(0,0,0,0.4)" />
      </pattern>
      <pattern id={`${prefix}-lines`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1.6" height="6" fill="rgba(0,0,0,0.35)" />
      </pattern>
      <pattern id={`${prefix}-cross`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1.6" height="7" fill="rgba(255,255,255,0.55)" />
        <rect width="7" height="1.6" fill="rgba(255,255,255,0.55)" />
      </pattern>
      <pattern id={`${prefix}-grid`} width="6" height="6" patternUnits="userSpaceOnUse">
        <rect width="1.5" height="6" fill="rgba(255,255,255,0.5)" />
        <rect width="6" height="1.5" fill="rgba(255,255,255,0.5)" />
      </pattern>
      <pattern id={`${prefix}-solid-stripes`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
        <rect width="4" height="8" fill="rgba(255,255,255,0.4)" />
      </pattern>
    </defs>
  );
}

interface AqiGaugeProps {
  value: number | null;
  category: AqiCategory | null;
  scale: AqiScale;
  /** ISO time of the reading (from the API). */
  time: string;
  timezone: string;
  onRefresh?: () => void;
  refreshing?: boolean;
}

export function AqiGauge({ value, category, scale, time, timezone, onRefresh, refreshing = false }: AqiGaugeProps) {
  const rawId = useId();
  const prefix = `g${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const now = useNow(30_000);
  const categories = scale === "us" ? US_CATEGORIES : EU_CATEGORIES;
  const n = categories.length;
  const step = 180 / n;
  const frac = value !== null ? gaugeFraction(value, categories, SCALE_MAX[scale]) : null;
  const markerAngle = frac !== null ? 180 - frac * 180 : null;
  const marker = markerAngle !== null ? polar(markerAngle) : null;
  const scaleName = scale === "us" ? "US AQI" : "European AQI";

  return (
    <section aria-labelledby={`${prefix}-title`} className="flex flex-col items-center gap-3">
      <h2 id={`${prefix}-title`} className="sr-only">
        Current air quality
      </h2>
      <div className="relative w-full max-w-[22rem]">
        <svg
          viewBox="0 0 240 136"
          className="w-full"
          role="img"
          aria-label={
            value !== null && category
              ? `${scaleName} ${Math.round(value)}, ${category.label}`
              : `${scaleName} not available`
          }
        >
          <PatternDefs prefix={prefix} />
          {categories.map((c, i) => {
            const a0 = 180 - i * step - (i === 0 ? 0 : GAP_DEG / 2);
            const a1 = 180 - (i + 1) * step + (i === n - 1 ? 0 : GAP_DEG / 2);
            const d = arcPath(a0, a1);
            const isActive = category?.key === c.key;
            return (
              <g key={c.key} opacity={category && !isActive ? 0.5 : 1}>
                <path d={d} stroke={c.color} strokeWidth={STROKE} fill="none" />
                {c.pattern !== "none" ? (
                  <path d={d} stroke={`url(#${prefix}-${c.pattern})`} strokeWidth={STROKE} fill="none" />
                ) : null}
              </g>
            );
          })}
          {marker ? (
            <g>
              <circle cx={marker.x} cy={marker.y} r={STROKE / 2 + 4} fill="var(--surface)" stroke="var(--text)" strokeWidth="3" />
              <circle cx={marker.x} cy={marker.y} r={4} fill="var(--text)" />
            </g>
          ) : null}
        </svg>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center">
          <span className="font-mono text-6xl font-bold leading-none tabular-nums sm:text-7xl" aria-hidden>
            {value !== null ? Math.round(value) : "n/a"}
          </span>
          <span className="mt-1 text-xs font-medium uppercase tracking-wider text-muted" aria-hidden>
            {scaleName}
          </span>
        </div>
      </div>

      {category ? (
        <>
          <CategoryBadge category={category} />
          <p className="max-w-md text-center text-lg font-semibold">{category.verdict}</p>
          <p className="max-w-md text-center text-sm text-muted">{category.health}</p>
        </>
      ) : (
        <p className="text-sm text-muted">This source did not report a {scaleName} value for this hour.</p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted">
        <time dateTime={time} title={formatPlaceTime(time, timezone)}>
          Updated {timeAgo(time, now)}
        </time>
        <span aria-hidden>·</span>
        <span>Auto-refreshes every 10 min</span>
        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshing}
            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-text hover:bg-surface-2 disabled:opacity-60"
            aria-label="Refresh air quality now"
          >
            <RefreshIcon size={12} className={refreshing ? "animate-spin" : ""} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        ) : null}
      </div>
    </section>
  );
}
