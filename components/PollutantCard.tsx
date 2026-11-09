import { CategorySwatch } from "@/components/CategoryBadge";
import { Sparkline } from "@/components/Sparkline";
import { getCategory, POLLUTANT_INFO, type PollutantKey } from "@/lib/aqi-categories";
import { formatConcentration, formatRatio } from "@/lib/format";
import type { AqiScale } from "@/types/air";

interface PollutantCardProps {
  pollutant: PollutantKey;
  /** µg/m³ */
  value: number | null;
  /** Source-reported sub-index on the active scale (absent for EU CO). */
  subIndex: number | undefined;
  scale: AqiScale;
  dominant: boolean;
  /** Last 24 hourly values (µg/m³) for the sparkline. */
  recent: readonly (number | null)[];
}

export function PollutantCard({ pollutant, value, subIndex, scale, dominant, recent }: PollutantCardProps) {
  const info = POLLUTANT_INFO[pollutant];
  const category = subIndex !== undefined ? getCategory(subIndex, scale) : null;
  const ratio = value !== null ? value / info.who.value : null;
  const over = ratio !== null && ratio > 1;
  const finite = recent.filter((v): v is number => v !== null);
  const range = finite.length ? { min: Math.min(...finite), max: Math.max(...finite) } : null;
  const titleId = `pc-${pollutant}`;

  return (
    <article
      aria-labelledby={titleId}
      className={`relative flex flex-col gap-2 overflow-hidden rounded-2xl border bg-surface p-4 ${dominant ? "border-text/40 shadow-md" : "border-border"}`}
    >
      {/* Category strip (color + pattern) */}
      <div
        aria-hidden
        className={`absolute inset-x-0 top-0 h-1.5 ${category ? `aqi-pattern-${category.pattern}` : ""}`}
        style={{ backgroundColor: category?.color ?? "var(--border)" }}
      />
      <header className="flex items-start justify-between gap-2 pt-1">
        <div>
          <h3 id={titleId} className="text-base font-semibold">
            {info.short}
          </h3>
          <p className="text-xs text-muted">{info.name}</p>
        </div>
        {dominant ? (
          <span className="rounded-full bg-text px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-bg">
            Main pollutant
          </span>
        ) : null}
      </header>

      <p className="flex items-baseline gap-1">
        <span className="font-mono text-3xl font-bold tabular-nums">{formatConcentration(value)}</span>
        {value !== null ? <span className="text-sm text-muted">{info.unit}</span> : null}
      </p>

      <div className="flex items-center gap-2 text-sm">
        {category ? (
          <>
            <CategorySwatch category={category} />
            <span>
              <span className="font-medium">{category.label}</span>
              <span className="text-muted"> · index {Math.round(subIndex ?? 0)}</span>
            </span>
          </>
        ) : (
          <span className="text-muted">{scale === "eu" && pollutant === "carbon_monoxide" ? "Not part of the EU index" : "No index reported"}</span>
        )}
      </div>

      <div className="mt-auto space-y-1">
        <p className={`text-sm font-medium ${over ? "text-danger" : ""}`}>
          {ratio === null ? (
            "No reading"
          ) : over ? (
            <>
              <span aria-hidden>▲ </span>
              {formatRatio(ratio)}× the WHO limit
            </>
          ) : (
            <>
              <span aria-hidden>✓ </span>
              Within WHO limit
            </>
          )}
        </p>
        <p className="text-xs text-muted">
          WHO {info.who.averaging} guideline: {info.who.value.toLocaleString("en-US")} {info.unit}
        </p>
        {range ? (
          <div>
            <Sparkline values={recent} color="var(--muted)" />
            <p className="text-[11px] text-muted">
              Last 24 h: {formatConcentration(range.min)}–{formatConcentration(range.max)} {info.unit}
            </p>
          </div>
        ) : null}
      </div>
    </article>
  );
}
