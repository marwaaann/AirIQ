"use client";

import { useAqiScale } from "@/hooks/useAqiScale";
import type { AqiScale } from "@/types/air";

const OPTIONS: { value: AqiScale; label: string; title: string }[] = [
  { value: "us", label: "US AQI", title: "US EPA Air Quality Index (0–500)" },
  { value: "eu", label: "EU AQI", title: "European Air Quality Index (EEA)" },
  { value: "in", label: "NAQI", title: "India National AQI (CPCB), computed by AirIQ from concentrations" },
];

/** Segmented control for the index scale; persisted and applied app-wide. */
export function AqiScaleToggle() {
  const [scale, setScale] = useAqiScale();
  return (
    <div role="radiogroup" aria-label="AQI scale" className="inline-flex rounded-lg border border-border bg-surface p-0.5 text-sm">
      {OPTIONS.map((o, i) => {
        const checked = scale === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            title={o.title}
            onClick={() => setScale(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = OPTIONS[(i + (e.key === "ArrowRight" ? 1 : OPTIONS.length - 1)) % OPTIONS.length].value;
                setScale(next);
                (e.currentTarget.parentElement?.querySelector(`[data-scale="${next}"]`) as HTMLButtonElement | null)?.focus();
              }
            }}
            tabIndex={checked ? 0 : -1}
            data-scale={o.value}
            className={`rounded-md px-2.5 py-1.5 font-medium transition-colors ${checked ? "bg-text text-bg" : "text-muted hover:text-text"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
